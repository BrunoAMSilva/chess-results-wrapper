import * as cheerio from "cheerio";
import { getCache, setCache } from "./cache";
import { BASE_URL, CACHE_TTL } from "./constants";

export interface Pairing {
  table: number;
  white: { name: string; number: number };
  black: { name: string; number: number } | null;
  result: string;
}

export interface TournamentInfo {
  name: string;
  round: number;
  totalRounds: number;
  date: string;
  location: string;
}

export interface TournamentData {
  info: TournamentInfo;
  pairings: Pairing[];
}

export interface Standing {
  rank: number;
  name: string;
  fed: string;
  rating: string;
  club: string;
  points: string;
  tieBreak1: string;
  tieBreak2: string;
  tieBreak3: string;
}

export interface StandingsData {
  info: TournamentInfo;
  standings: Standing[];
}

function buildUrl(
  tournamentId: string,
  round: number,
  lang = 1,
): string {
  return `${BASE_URL}/tnr${tournamentId}.aspx?lan=${lang}&art=2&rd=${round}&turdet=YES`;
}

export async function scrapePairings(
  tournamentId: string,
  round: number,
  lang = 1,
): Promise<TournamentData> {
  const cacheKey = `pairings:${tournamentId}:${round}:${lang}`;
  const cached = getCache<TournamentData>(cacheKey);
  if (cached) return cached;

  const url = buildUrl(tournamentId, round, lang);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch pairings: HTTP ${res.status} for tournament ${tournamentId}`);
  const html = await res.text();

  try {
    const data = parseHtml(html, round);
    setCache(cacheKey, data, CACHE_TTL);
    return data;
  } catch (e) {
    throw new Error(`Failed to parse pairings for tournament ${tournamentId}, round ${round}: ${e instanceof Error ? e.message : e}`);
  }
}

export async function scrapeStandings(
  tournamentId: string,
  lang = 1,
): Promise<StandingsData> {
  const cacheKey = `standings:${tournamentId}:${lang}`;
  const cached = getCache<StandingsData>(cacheKey);
  if (cached) return cached;

  // Try crosstable first (art=4), fall back to standard list (art=1)
  for (const art of [4, 1]) {
    const url = `${BASE_URL}/tnr${tournamentId}.aspx?lan=${lang}&art=${art}&turdet=YES`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch standings: HTTP ${res.status} for tournament ${tournamentId}`);
    const html = await res.text();

    try {
      const data = parseStandingsHtml(html);
      if (data.standings.length > 0 || art === 1) {
        setCache(cacheKey, data, CACHE_TTL);
        return data;
      }
    } catch (e) {
      if (art === 1) {
        throw new Error(`Failed to parse standings for tournament ${tournamentId}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  // Should not reach here, but just in case
  throw new Error(`No standings found for tournament ${tournamentId}`);
}

function parseTournamentInfo($: cheerio.CheerioAPI): Omit<TournamentInfo, 'round'> {
  const name = $("h2").first().text().trim();

  const roundLine = $("h3").last().text().trim();
  const dateMatch = roundLine.match(/(\d{4}\/\d{2}\/\d{2})/);
  const date = dateMatch ? dateMatch[1] : "";

  const totalRoundsText = $("td.CR")
    .filter((_, el) => {
      const text = $(el).text();
      return text.includes("Number of rounds") || text.includes("Número de rondas") || text.includes("Rundenanzahl");
    })
    .next()
    .text()
    .trim();
  const totalRounds = parseInt(totalRoundsText) || 5;

  const location =
    $("td.CR a")
      .filter((_, el) =>
        ($(el).attr("href") || "").includes("google.com/maps"),
      )
      .text()
      .trim() || "";

  return { name, totalRounds, date, location };
}

export function parseHtml(html: string, round: number): TournamentData {
  const $ = cheerio.load(html);

  // Check for error pages (e.g. "Record not found")
  if ($(".error").length > 0 || html.includes("Record not found")) {
    throw new Error("Tournament not found");
  }

  const info = parseTournamentInfo($);

  // Detect column indices from the header row
  let whiteIdx = -1;
  let blackIdx = -1;
  let resultIdx = -1;
  let boIdx = 0;
  let whiteNoIdx = 1;
  let blackNoIdx = -1;

  const headerRow = $("table.CRs1 tr").filter((_, row) => $(row).find("th").length > 3).first();
  headerRow.find("th, td").each((i, el) => {
    const text = $(el).text().trim();
    if (text === "Bo.") boIdx = i;
    if (text === "White" || text === "Brancas" || text === "Blancas" || text === "Weiß") whiteIdx = i;
    if (text === "Black" || text === "Negras" || text === "Schwarz") blackIdx = i;
    if (text === "Result" || text === "Resultado" || text === "Resultat" || text === "Ergebnis") resultIdx = i;
    if (text === "No." && whiteIdx === -1) whiteNoIdx = i;
    if (text === "No." && blackIdx !== -1) blackNoIdx = i;
  });

  // Parse pairings table — track current round for round-robin tournaments
  // where all rounds appear on one page separated by CRg1b rows ("Round N ...")
  const pairings: Pairing[] = [];
  let currentRound = round; // default: assume all rows belong to the requested round
  const isRoundRobin = $("table.CRs1 tr.CRg1b").length > 0;

  $("table.CRs1 tr").each((_, row) => {
    const $row = $(row);

    // Detect round separator rows (class CRg1b, e.g. "Round 3 on 2026/02/28")
    if ($row.hasClass("CRg1b")) {
      const text = $row.text().trim();
      const roundMatch = text.match(/(?:Round|Ronda|Runde)\s+(\d+)/i);
      if (roundMatch) {
        currentRound = parseInt(roundMatch[1]);
      }
      return;
    }

    // Skip non-data rows
    if (!$row.hasClass("CRng1") && !$row.hasClass("CRng2")) return;
    // In round-robin, only include pairings from the requested round
    if (isRoundRobin && currentRound !== round) return;

    const cells = $row.find("td");
    if (cells.length < 6) return;

    const tableNum = parseInt($(cells[boIdx]).text().trim());
    if (isNaN(tableNum)) return;

    const whiteNum = parseInt($(cells[whiteNoIdx]).text().trim());
    const whiteName = whiteIdx !== -1
      ? ($(cells[whiteIdx]).find("a").text().trim() || $(cells[whiteIdx]).text().trim())
      : "";
    const result = resultIdx !== -1 ? $(cells[resultIdx]).text().trim() : "";

    const blackName = blackIdx !== -1
      ? ($(cells[blackIdx]).find("a").text().trim() || $(cells[blackIdx]).text().trim())
      : "";
    const blackNum = blackNoIdx !== -1 ? parseInt($(cells[blackNoIdx]).text().trim()) : NaN;

    const isUnpaired =
      blackName === "bye" ||
      blackName.includes("não emparceirado") ||
      blackName.includes("not paired") ||
      blackName.includes("spielfrei") ||
      !blackName;

    pairings.push({
      table: tableNum,
      white: { name: whiteName, number: whiteNum },
      black: isUnpaired ? null : { name: blackName, number: isNaN(blackNum) ? 0 : blackNum },
      result,
    });
  });

  return {
    info: { ...info, round },
    pairings,
  };
}

export function parseStandingsHtml(html: string): StandingsData {
  const $ = cheerio.load(html);

  // Check for error pages (e.g. "Record not found")
  if ($(".error").length > 0 || html.includes("Record not found")) {
    throw new Error("Tournament not found");
  }

  const info = parseTournamentInfo($);

  // Find column indices
  let ptsIdx = -1;
  let tb1Idx = -1;
  let tb2Idx = -1;
  let tb3Idx = -1;
  let nameIdx = 2; // Default
  let fedIdx = 4; // Default
  let rtgIdx = -1;
  let clubIdx = -1;

  // Inspect headers. The row with th usually is CRng1b or CRng1
  // Scan all children (th + td) to handle crosstable format where round columns are <td>
  const headerRow = $("table.CRs1 tr").filter((_, row) => $(row).find("th").length > 0).first();
  headerRow.find("th, td").each((i, el) => {
    const text = $(el).text().trim();
    if (text === "Pts." || text === "Pts") ptsIdx = i;
    if (text.includes("TB1") || text.includes("Desp1")) tb1Idx = i;
    if (text.includes("TB2") || text.includes("Desp2")) tb2Idx = i;
    if (text.includes("TB3") || text.includes("Desp3")) tb3Idx = i;
    if (text === "Name" || text === "Nome") nameIdx = i;
    if (text === "FED") fedIdx = i;
    if (text === "Rtg" || text === "Elo") rtgIdx = i;
    if (text === "Club/City" || text.includes("Clube") || text === "Verein/Ort") clubIdx = i;
  });

  const standings: Standing[] = [];
  $("table.CRs1 tr").each((_, row) => {
    const $row = $(row);
    // Skip header rows
    if ($row.find("th").length > 0 || $row.hasClass("CRng1b")) return;

    const cells = $row.find("td");
    // Need enough cells.
    if (cells.length < 5) return;

    const rankText = $(cells[0]).text().trim();
    const rank = parseInt(rankText);
    if (isNaN(rank)) return;

    const name = $(cells[nameIdx]).text().trim();
    const fed = fedIdx !== -1 && cells[fedIdx] ? $(cells[fedIdx]).text().trim() : "";
    const rating = rtgIdx !== -1 && cells[rtgIdx] ? $(cells[rtgIdx]).text().trim() : "";
    const club = clubIdx !== -1 && cells[clubIdx] ? $(cells[clubIdx]).text().trim() : "";
    
    let points = "";
    if (ptsIdx !== -1 && cells[ptsIdx]) {
      points = $(cells[ptsIdx]).text().trim();
    } 

    const tb1 = tb1Idx !== -1 && cells[tb1Idx] ? $(cells[tb1Idx]).text().trim() : "";
    const tb2 = tb2Idx !== -1 && cells[tb2Idx] ? $(cells[tb2Idx]).text().trim() : "";
    const tb3 = tb3Idx !== -1 && cells[tb3Idx] ? $(cells[tb3Idx]).text().trim() : "";

    standings.push({
      rank,
      name,
      fed,
      rating,
      club,
      points,
      tieBreak1: tb1,
      tieBreak2: tb2,
      tieBreak3: tb3,
    });
  });

  return {
    info: { ...info, round: 0 },
    standings,
  };
}
