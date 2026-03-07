import { scrapePairings, scrapeStandings } from "../src/lib/scraper.ts";
import { upsertTournament, getTournament } from "../src/lib/db.ts";
import * as cheerio from "cheerio";
import { readFile, writeFile } from "node:fs/promises";
import type { LinkedTournament, TournamentInfo } from "../src/lib/types.ts";

const BASE_URL = "https://chess-results.com";

interface Args {
  fed: string;
  year: number;
  lang: number;
  maxTournaments: number;
  maxPages: number;
  withPairings: boolean;
  strictTitleYear: boolean;
  searchHtmlPath: string;
  importJsonPath: string;
  exportJsonPath: string;
}

interface TournamentSeed {
  id: string;
  title: string;
  linkedTournaments?: LinkedTournament[];
}

class SimpleCookieJar {
  private readonly jar = new Map<string, string>();

  updateFromResponse(res: Response): void {
    const setCookies = this.getSetCookieHeaders(res);
    for (const raw of setCookies) {
      const firstPart = raw.split(";")[0] || "";
      const eqIdx = firstPart.indexOf("=");
      if (eqIdx <= 0) continue;
      const name = firstPart.slice(0, eqIdx).trim();
      const value = firstPart.slice(eqIdx + 1).trim();
      if (name) {
        this.jar.set(name, value);
      }
    }
  }

  toHeader(): string {
    return Array.from(this.jar.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  private getSetCookieHeaders(res: Response): string[] {
    const headersObj = res.headers as unknown as {
      getSetCookie?: () => string[];
      raw?: () => Record<string, string[]>;
    };

    if (typeof headersObj.getSetCookie === "function") {
      return headersObj.getSetCookie();
    }

    if (typeof headersObj.raw === "function") {
      const raw = headersObj.raw();
      const values = raw["set-cookie"];
      if (Array.isArray(values)) return values;
    }

    const fallback = res.headers.get("set-cookie") || "";
    if (!fallback) return [];

    return fallback.split(/,(?=\s*[^;,\s]+=)/g).map((s) => s.trim()).filter(Boolean);
  }
}

function range(from: number, to: number): number[] {
  if (to < from) return [];
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    fed: "POR",
    year: 2026,
    lang: 10,
    maxTournaments: 0,
    maxPages: 120,
    withPairings: true,
    strictTitleYear: false,
    searchHtmlPath: "",
    importJsonPath: "",
    exportJsonPath: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === "--fed" && next) {
      args.fed = next.toUpperCase();
      i += 1;
      continue;
    }
    if (token === "--year" && next) {
      args.year = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (token === "--lang" && next) {
      args.lang = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (token === "--max" && next) {
      args.maxTournaments = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (token === "--max-pages" && next) {
      args.maxPages = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (token === "--no-pairings") {
      args.withPairings = false;
      continue;
    }
    if (token === "--strict-title-year") {
      args.strictTitleYear = true;
      continue;
    }
    if (token === "--search-html" && next) {
      args.searchHtmlPath = next;
      i += 1;
      continue;
    }
    if (token === "--import-json" && next) {
      args.importJsonPath = next;
      i += 1;
      continue;
    }
    if (token === "--export-json" && next) {
      args.exportJsonPath = next;
      i += 1;
      continue;
    }
  }

  return args;
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#8211;", "-")
    .replaceAll("&#8220;", '"')
    .replaceAll("&#8221;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ")
    .trim();
}

function extractTournamentSeeds(html: string): TournamentSeed[] {
  const seen = new Set<string>();
  const seeds: TournamentSeed[] = [];
  const re = /(?:https:\/\/chess-results\.com\/)?tnr(\d+)\.aspx\?lan=\d+">([^<]+)</g;

  let m = re.exec(html);
  while (m) {
    const id = m[1];
    if (!seen.has(id)) {
      seen.add(id);
      seeds.push({ id, title: decodeHtml(m[2]) });
    }
    m = re.exec(html);
  }

  return seeds;
}

function extractHiddenFields(html: string): Map<string, string> {
  const $ = cheerio.load(html);
  const fields = new Map<string, string>();

  $("input[type='hidden']").each((_, el) => {
    const name = ($(el).attr("name") || "").trim();
    const value = $(el).attr("value") || "";
    if (name) {
      fields.set(name, value);
    }
  });

  return fields;
}

function extractTransferPath(html: string): string | null {
  const m = html.match(/href="(Transfer\.aspx\?key5=TS[^\"]+)"/i);
  return m ? decodeHtml(m[1]) : null;
}

function titleLooksLikeYear(title: string, year: number): boolean {
  return title.includes(String(year)) || title.includes(`${year - 1}/${String(year).slice(2)}`);
}

function dateLooksLikeYear(dateText: string, year: number): boolean {
  if (!dateText) return false;
  return dateText.includes(String(year));
}

function isOldTournamentGate(html: string): boolean {
  return /LinkButton2|mais de 2 semanas|more than 2 weeks|mehr als 2 Wochen|m[aá]s de 2 semanas/i.test(html);
}

function collectRoundsFromHtml(html: string, into: Set<number>): void {
  const rdRegex = /[?&]rd=(\d+)/g;
  let m = rdRegex.exec(html);
  while (m) {
    const rd = Number.parseInt(m[1], 10);
    if (Number.isFinite(rd) && rd > 0) {
      into.add(rd);
    }
    m = rdRegex.exec(html);
  }

  // Round-robin pages can expose all rounds on one page without rd links.
  const roundHeaderRegexA = /(?:Round|Ronda|Runde|Tour)\s+(\d+)/gi;
  let h = roundHeaderRegexA.exec(html);
  while (h) {
    const rd = Number.parseInt(h[1], 10);
    if (Number.isFinite(rd) && rd > 0) into.add(rd);
    h = roundHeaderRegexA.exec(html);
  }

  const roundHeaderRegexB = /\b(\d+)\.?\s*(?:Round|Ronda|Runde|Tour)\b/gi;
  h = roundHeaderRegexB.exec(html);
  while (h) {
    const rd = Number.parseInt(h[1], 10);
    if (Number.isFinite(rd) && rd > 0) into.add(rd);
    h = roundHeaderRegexB.exec(html);
  }
}

async function fetchWithOldTournamentPostback(tid: string, lang: number): Promise<string | null> {
  const baseUrl = `https://s2.chess-results.com/tnr${tid}.aspx?lan=${lang}&turdet=YES&SNode=S0`;
  const pairingsUrl = `https://s2.chess-results.com/tnr${tid}.aspx?lan=${lang}&art=2&rd=1&turdet=YES`;
  const jar = new SimpleCookieJar();

  const getRes = await fetch(baseUrl);
  if (!getRes.ok) {
    return null;
  }
  jar.updateFromResponse(getRes);

  const gateHtml = await getRes.text();
  if (!isOldTournamentGate(gateHtml)) {
    return null;
  }

  const hidden = extractHiddenFields(gateHtml);
  const body = new URLSearchParams();
  for (const [k, v] of hidden.entries()) {
    body.set(k, v);
  }
  body.set("__EVENTTARGET", "ctl00$P1$LinkButton2");
  body.set("__EVENTARGUMENT", "");

  const postRes = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: jar.toHeader(),
      Referer: baseUrl,
    },
    body: body.toString(),
  });

  if (!postRes.ok) {
    return null;
  }
  jar.updateFromResponse(postRes);

  const unlockedRes = await fetch(pairingsUrl, {
    headers: {
      Cookie: jar.toHeader(),
      Referer: baseUrl,
    },
  });

  if (!unlockedRes.ok) {
    return null;
  }

  return unlockedRes.text();
}

async function discoverAvailableRounds(
  tid: string,
  lang: number,
  fallbackTotalRounds: number,
): Promise<number[]> {
  const primaryUrl = `${BASE_URL}/tnr${tid}.aspx?lan=${lang}&art=2&rd=1&turdet=YES`;
  const s2Url = `https://s2.chess-results.com/tnr${tid}.aspx?lan=${lang}&art=2&rd=1&turdet=YES`;

  try {
    const htmlPages: string[] = [];

    for (const candidateUrl of [primaryUrl, s2Url]) {
      const res = await fetch(candidateUrl);
      if (res.ok) {
        htmlPages.push(await res.text());
      }
    }

    const seen = new Set<number>();
    for (const html of htmlPages) {
      collectRoundsFromHtml(html, seen);
    }

    const shouldTryPostback = htmlPages.length === 0 || htmlPages.some((h) => isOldTournamentGate(h));
    if (shouldTryPostback) {
      const unlockedHtml = await fetchWithOldTournamentPostback(tid, lang);
      if (unlockedHtml) {
        collectRoundsFromHtml(unlockedHtml, seen);
      }
    }

    if (seen.size > 0) {
      return Array.from(seen).sort((a, b) => a - b);
    }
  } catch {
    // fall through to metadata fallback
  }

  return fallbackTotalRounds > 0 ? range(1, fallbackTotalRounds) : [];
}

async function discoverFromJsonFile(filePath: string): Promise<{ discovered: Map<string, string>; seeds: TournamentSeed[] }> {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as Array<{ id: string; title?: string; linkedTournaments?: LinkedTournament[] }>;
  const discovered = new Map<string, string>();
  const seeds: TournamentSeed[] = [];

  for (const item of parsed) {
    const id = String(item.id || "").trim();
    if (!id) continue;
    const title = String(item.title || "").trim();
    if (!discovered.has(id)) {
      discovered.set(id, title);
      seeds.push({ id, title, linkedTournaments: item.linkedTournaments });
    }
  }

  return { discovered, seeds };
}

async function discoverFederationTournaments(fed: string, maxPages: number): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const visited = new Set<string>();

  let pageUrl = `${BASE_URL}/fed.aspx?lan=1&fed=${encodeURIComponent(fed)}`;
  let page = 0;

  while (pageUrl && page < maxPages && !visited.has(pageUrl)) {
    visited.add(pageUrl);
    page += 1;
    console.log(`[discover] page ${page}: ${pageUrl}`);

    const res = await fetch(pageUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch federation page ${pageUrl}: HTTP ${res.status}`);
    }
    const html = await res.text();

    for (const seed of extractTournamentSeeds(html)) {
      if (!result.has(seed.id)) {
        result.set(seed.id, seed.title);
      }
    }

    const transfer = extractTransferPath(html);
    pageUrl = transfer ? `${BASE_URL}/${transfer}` : "";
  }

  return result;
}

async function discoverFromSearchHtmlFile(filePath: string): Promise<Map<string, string>> {
  const html = await readFile(filePath, "utf8");
  const result = new Map<string, string>();

  for (const seed of extractTournamentSeeds(html)) {
    if (!result.has(seed.id)) {
      result.set(seed.id, seed.title);
    }
  }

  return result;
}

async function discoverTurniersucheTournaments(args: Args): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const initialUrl = `${BASE_URL}/turniersuche.aspx?lan=${args.lang}`;
  const jar = new SimpleCookieJar();

  const getRes = await fetch(initialUrl);
  if (!getRes.ok) {
    throw new Error(`Failed to load search page: HTTP ${getRes.status}`);
  }
  jar.updateFromResponse(getRes);
  const searchUrl = getRes.url;

  const initialHtml = await getRes.text();
  const initialHidden = extractHiddenFields(initialHtml);

  const runSearchSubmit = async (hidden: Map<string, string>): Promise<Map<string, string>> => {
    const found = new Map<string, string>();
    const body = new URLSearchParams();
    for (const [k, v] of hidden.entries()) {
      body.set(k, v);
    }

    body.set("ctl00$P1$txt_tnr", "");
    body.set("ctl00$P1$txt_eventid", "");
    body.set("ctl00$P1$txt_bez", "");
    body.set("ctl00$P1$txt_veranstalter", "");
    body.set("ctl00$P1$txt_Hauptschiedsrichter", "");
    body.set("ctl00$P1$txt_Schiedsrichter", "");
    body.set("ctl00$P1$txt_ort", "");
    body.set("ctl00$P1$combo_art", "0");
    body.set("ctl00$P1$combo_sort", "1");
    body.set("ctl00$P1$combo_land", args.fed);
    body.set("ctl00$P1$combo_bdld", "-");
    body.set("ctl00$P1$combo_bedenkzeit", "0");
    body.set("ctl00$P1$combo_anzahl_zeilen", "5");
    body.set("ctl00$P1$txt_von_tag", `${args.year}-01-01`);
    body.set("ctl00$P1$txt_bis_tag", `${args.year}-12-31`);
    body.set("ctl00$P1$cb_suchen", "Procurar");

    const postRes = await fetch(searchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: jar.toHeader(),
        Referer: searchUrl,
      },
      body: body.toString(),
    });

    if (!postRes.ok) {
      throw new Error(`Turniersuche request failed: HTTP ${postRes.status}`);
    }

    jar.updateFromResponse(postRes);
    const html = await postRes.text();
    for (const seed of extractTournamentSeeds(html)) {
      if (!found.has(seed.id)) {
        found.set(seed.id, seed.title);
      }
    }

    return found;
  };

  let found = await runSearchSubmit(initialHidden);
  if (found.size > 0) {
    return found;
  }

  const postbackBody = new URLSearchParams();
  for (const [k, v] of initialHidden.entries()) {
    postbackBody.set(k, v);
  }
  postbackBody.set("__EVENTTARGET", "ctl00$P1$combo_land");
  postbackBody.set("__EVENTARGUMENT", "");
  postbackBody.set("ctl00$P1$combo_land", args.fed);
  postbackBody.set("ctl00$P1$combo_art", "0");
  postbackBody.set("ctl00$P1$combo_sort", "1");
  postbackBody.set("ctl00$P1$combo_bdld", "-");
  postbackBody.set("ctl00$P1$combo_bedenkzeit", "0");
  postbackBody.set("ctl00$P1$combo_anzahl_zeilen", "5");
  postbackBody.set("ctl00$P1$txt_von_tag", `${args.year}-01-01`);
  postbackBody.set("ctl00$P1$txt_bis_tag", `${args.year}-12-31`);

  const postbackRes = await fetch(searchUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: jar.toHeader(),
      Referer: searchUrl,
    },
    body: postbackBody.toString(),
  });

  if (!postbackRes.ok) {
    throw new Error(`Turniersuche postback failed: HTTP ${postbackRes.status}`);
  }

  jar.updateFromResponse(postbackRes);
  const postbackHtml = await postbackRes.text();
  const refreshedHidden = extractHiddenFields(postbackHtml);

  found = await runSearchSubmit(refreshedHidden);
  for (const [id, title] of found.entries()) {
    result.set(id, title);
  }

  return result;
}

async function discoverTurniersucheTournamentsBrowser(args: Args): Promise<Map<string, string>> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(`${BASE_URL}/turniersuche.aspx?lan=${args.lang}`, { waitUntil: "domcontentloaded" });

    await page.selectOption("#P1_combo_art", "0");
    await page.selectOption("#P1_combo_sort", "1");
    await page.selectOption("#P1_combo_land", args.fed);
    await page.waitForLoadState("domcontentloaded");

    await page.selectOption("#P1_combo_bdld", "-");
    await page.selectOption("#P1_combo_bedenkzeit", "0");
    await page.selectOption("#P1_combo_anzahl_zeilen", "5");

    // Keep discovery broad (not only ended events and not only games-with-PGN).
    try { await page.uncheck("#P1_cbox_zuEnde"); } catch { /* optional control */ }
    try { await page.uncheck("#P1_cbox_partien_vorhanden"); } catch { /* optional control */ }

    await page.fill("#P1_txt_von_tag", `${args.year}-01-01`);
    await page.fill("#P1_txt_bis_tag", `${args.year}-12-31`);

    await Promise.all([
      page.waitForLoadState("domcontentloaded"),
      page.click("#P1_cb_suchen"),
    ]);

    const html = await page.content();
    const result = new Map<string, string>();
    for (const seed of extractTournamentSeeds(html)) {
      if (!result.has(seed.id)) {
        result.set(seed.id, seed.title);
      }
    }

    return result;
  } finally {
    await browser.close();
  }
}

async function importTournament(tid: string, title: string, args: Args): Promise<{ imported: boolean; rounds: number }> {
  const standings = await scrapeStandings(tid, args.lang);
  const dateText = standings.info.date || "";
  const titleYear = titleLooksLikeYear(title, args.year);
  const dateYear = dateLooksLikeYear(dateText, args.year);
  const trustSeedList = Boolean(args.importJsonPath);

  if (!trustSeedList && !dateYear && !titleYear) {
    return { imported: false, rounds: 0 };
  }

  let roundsImported = 0;
  if (args.withPairings) {
    const rounds = await discoverAvailableRounds(tid, args.lang, standings.info.totalRounds || 0);
    if (rounds.length > 0) {
      for (const round of rounds) {
        try {
          await scrapePairings(tid, round, args.lang);
          roundsImported += 1;
        } catch {
          // best effort per round
        }
      }
    }
  }

  return { imported: true, rounds: roundsImported };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[start] fed=${args.fed} year=${args.year} lang=${args.lang} withPairings=${args.withPairings}`);

  let discovered = new Map<string, string>();
  let jsonSeeds: TournamentSeed[] = [];

  if (args.importJsonPath) {
    try {
      const result = await discoverFromJsonFile(args.importJsonPath);
      discovered = result.discovered;
      jsonSeeds = result.seeds;
      console.log(`[discover] import-json found: ${discovered.size}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[discover] import-json failed (${message})`);
    }
  }

  if (args.searchHtmlPath) {
    try {
      discovered = await discoverFromSearchHtmlFile(args.searchHtmlPath);
      console.log(`[discover] search-html found: ${discovered.size}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[discover] search-html failed (${message})`);
    }
  }

  if (discovered.size === 0) {
    try {
      discovered = await discoverTurniersucheTournaments(args);
      console.log(`[discover] turniersuche found: ${discovered.size}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[discover] turniersuche failed (${message}), trying browser fallback`);
    }
  }

  if (discovered.size === 0) {
    try {
      discovered = await discoverTurniersucheTournamentsBrowser(args);
      console.log(`[discover] turniersuche(browser) found: ${discovered.size}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[discover] turniersuche(browser) failed (${message}), falling back to federation pages`);
    }
  }

  if (discovered.size === 0) {
    discovered = await discoverFederationTournaments(args.fed, args.maxPages);
  }

  console.log(`[discover] total unique tournaments found: ${discovered.size}`);

  if (args.exportJsonPath) {
    const payload = Array.from(discovered.entries()).map(([id, title]) => ({ id, title }));
    await writeFile(args.exportJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`[discover] export-json written: ${args.exportJsonPath}`);
  }

  let candidates = Array.from(discovered.entries()).map(([id, title]) => ({ id, title }));

  if (args.strictTitleYear) {
    candidates = candidates.filter((c) => titleLooksLikeYear(c.title, args.year));
    console.log(`[filter] strict title-year enabled: ${candidates.length} candidates`);
  } else {
    const yearish = candidates.filter((c) => titleLooksLikeYear(c.title, args.year));
    if (yearish.length > 0) {
      candidates = yearish;
      console.log(`[filter] selected year-like titles: ${candidates.length} candidates`);
    }
  }

  if (args.maxTournaments > 0) {
    candidates = candidates.slice(0, args.maxTournaments);
    console.log(`[filter] max tournaments applied: ${candidates.length}`);
  }

  let importedCount = 0;
  let skippedByDate = 0;
  let failed = 0;
  let roundsImported = 0;

  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i];
    const label = `[${i + 1}/${candidates.length}] tnr${c.id}`;

    try {
      const result = await importTournament(c.id, c.title, args);
      if (result.imported) {
        importedCount += 1;
        roundsImported += result.rounds;
        console.log(`${label} imported (${c.title})`);
      } else {
        skippedByDate += 1;
        console.log(`${label} skipped by date (${c.title})`);
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`${label} failed: ${message}`);
    }
  }

  console.log("\n[done]");
  console.log(`discovered=${discovered.size}`);
  console.log(`candidates=${candidates.length}`);
  console.log(`imported=${importedCount}`);
  console.log(`skippedByDate=${skippedByDate}`);
  console.log(`failed=${failed}`);
  console.log(`pairingRoundsImported=${roundsImported}`);

  // Apply linked tournaments from JSON seeds (for tournaments not linked on chess-results.com)
  const seedsWithLinks = jsonSeeds.filter((s) => s.linkedTournaments && s.linkedTournaments.length > 0);
  if (seedsWithLinks.length > 0) {
    console.log(`\n[links] applying linked tournaments for ${seedsWithLinks.length} entries`);
    for (const seed of seedsWithLinks) {
      try {
        const existing = getTournament(seed.id);
        if (!existing) {
          console.log(`[links] tnr${seed.id} not in DB, skipping`);
          continue;
        }
        upsertTournament({
          name: existing.name,
          round: 0,
          totalRounds: existing.total_rounds,
          date: existing.date,
          location: existing.location,
          type: existing.type as TournamentInfo['type'],
          linkedTournaments: seed.linkedTournaments,
          currentLabel: seed.title,
        }, seed.id);
        console.log(`[links] tnr${seed.id} linked to ${seed.linkedTournaments!.map((t) => t.id).join(', ')}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[links] tnr${seed.id} failed: ${message}`);
      }
    }
  }
}

main().catch((error) => {
  console.error("[fatal]", error instanceof Error ? error.message : error);
  process.exit(1);
});
