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

  const url = `${BASE_URL}/tnr${tournamentId}.aspx?lan=${lang}&art=4&turdet=YES`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch standings: HTTP ${res.status} for tournament ${tournamentId}`);
  const html = await res.text();

  try {
    const data = parseStandingsHtml(html);
    setCache(cacheKey, data, CACHE_TTL);
    return data;
  } catch (e) {
    throw new Error(`Failed to parse standings for tournament ${tournamentId}: ${e instanceof Error ? e.message : e}`);
  }
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
  const info = parseTournamentInfo($);

  // Parse pairings table
  const pairings: Pairing[] = [];
  $("table.CRs1 tr.CRng1, table.CRs1 tr.CRng2").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 10) return;

    const tableNum = parseInt($(cells[0]).text().trim());
    const whiteNum = parseInt($(cells[1]).text().trim());
    const whiteName =
      $(cells[3]).find("a").text().trim() || $(cells[3]).text().trim();
    const result = $(cells[6]).text().trim();

    const blackName =
      $(cells[9]).find("a").text().trim() || $(cells[9]).text().trim();
    const blackNum = parseInt($(cells[11]).text().trim());

    const isUnpaired =
      blackName === "bye" ||
      blackName.includes("não emparceirado") ||
      blackName.includes("not paired") ||
      !blackName;

    pairings.push({
      table: tableNum,
      white: { name: whiteName, number: whiteNum },
      black: isUnpaired ? null : { name: blackName, number: blackNum },
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
  const info = parseTournamentInfo($);

  // Find column indices
  let ptsIdx = -1;
  let tb1Idx = -1;
  let tb2Idx = -1;
  let tb3Idx = -1;
  let nameIdx = 2; // Default
  let fedIdx = 4; // Default

  // Inspect headers. The row with th usually is CRng1b or CRng1
  const headerRow = $("table.CRs1 tr").filter((_, row) => $(row).find("th").length > 0).first();
  headerRow.find("th").each((i, el) => {
    const text = $(el).text().trim();
    if (text === "Pts." || text === "Pts") ptsIdx = i;
    if (text.includes("TB1") || text.includes("Desp1")) tb1Idx = i;
    if (text.includes("TB2") || text.includes("Desp2")) tb2Idx = i;
    if (text.includes("TB3") || text.includes("Desp3")) tb3Idx = i;
    if (text === "Name" || text === "Nome") nameIdx = i; // Might differ
    if (text === "FED") fedIdx = i;
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
