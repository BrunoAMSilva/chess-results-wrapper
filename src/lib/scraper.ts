import * as cheerio from "cheerio";

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

const BASE_URL = "https://chess-results.com";

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
  const url = buildUrl(tournamentId, round, lang);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
  const html = await res.text();
  return parseHtml(html, round);
}

function parseHtml(html: string, round: number): TournamentData {
  const $ = cheerio.load(html);

  // Tournament name
  const name = $("h2").first().text().trim();

  // Round info line like "Round 1 on 2026/02/28 at 15:05"
  const roundLine = $("h3").last().text().trim();
  const dateMatch = roundLine.match(/(\d{4}\/\d{2}\/\d{2})/);
  const date = dateMatch ? dateMatch[1] : "";

  // Total rounds from tournament details
  const totalRoundsText = $("td.CR")
    .filter((_, el) => $(el).text().includes("Number of rounds"))
    .next()
    .text()
    .trim();
  const totalRounds = parseInt(totalRoundsText) || 5;

  // Location
  const location =
    $("td.CR a")
      .filter((_, el) =>
        ($(el).attr("href") || "").includes("google.com/maps"),
      )
      .text()
      .trim() || "";

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
    info: { name, round, totalRounds, date, location },
    pairings,
  };
}
