import * as cheerio from 'cheerio';
import { getCache, setCache } from './cache';
import { BASE_URL, CACHE_TTL } from './constants';
import { getStrategyFromHtml, parseTournamentMeta, parsePlayerCard } from './strategies';
import {
  persistStandings,
  persistPairings,
  persistPlayerCard,
  getTournament,
  getPairingsFromDb,
  getStandingsFromDb,
} from './db';

// Re-export types from the shared types module for backward compatibility
export type {
  Pairing,
  PlayerRef,
  TournamentInfo,
  TournamentData,
  StandingsData,
  Standing,
  TeamPairing,
  TeamStanding,
  TeamPlayerEntry,
  LinkedTournament,
  Sex,
} from './types';
import type { TournamentData, StandingsData } from './types';
import { TournamentType } from './types';

const S2_BASE_URL = 'https://s2.chess-results.com';

// Always scrape chess-results.com in English for consistent column headers
// and reduced overhead. User's UI language is separate from scraping language.
const SCRAPE_LANG = 1;

class SimpleCookieJar {
  private readonly jar = new Map<string, string>();

  updateFromResponse(res: Response): void {
    const headersObj = res.headers as unknown as {
      getSetCookie?: () => string[];
      raw?: () => Record<string, string[]>;
    };

    let setCookies: string[] = [];
    if (typeof headersObj.getSetCookie === 'function') {
      setCookies = headersObj.getSetCookie();
    } else if (typeof headersObj.raw === 'function') {
      setCookies = headersObj.raw()['set-cookie'] || [];
    } else {
      const fallback = res.headers.get('set-cookie') || '';
      if (fallback) {
        setCookies = fallback.split(/,(?=\s*[^;,\s]+=)/g).map((s) => s.trim());
      }
    }

    for (const raw of setCookies) {
      const firstPart = raw.split(';')[0] || '';
      const eqIdx = firstPart.indexOf('=');
      if (eqIdx <= 0) continue;
      const name = firstPart.slice(0, eqIdx).trim();
      const value = firstPart.slice(eqIdx + 1).trim();
      if (name) {
        this.jar.set(name, value);
      }
    }
  }

  toHeader(): string {
    return Array.from(this.jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

function isOldTournamentGate(html: string): boolean {
  const hasGateText = /LinkButton2|mais de 2 semanas|more than 2 weeks|mehr als 2 Wochen|m[aá]s de 2 semanas/i.test(html);
  if (!hasGateText) return false;
  // Some old tournament pages show the gate warning banner but still contain
  // actual data (CRs1 table with results).  Only treat it as a real gate when
  // the page lacks tournament data.
  const hasData = /class="CRs1"/.test(html);
  return !hasData;
}

function extractHiddenFields(html: string): Map<string, string> {
  const $ = cheerio.load(html);
  const fields = new Map<string, string>();

  $('input[type="hidden"]').each((_, el) => {
    const name = ($(el).attr('name') || '').trim();
    const value = $(el).attr('value') || '';
    if (name) {
      fields.set(name, value);
    }
  });

  return fields;
}

async function fetchTournamentHtml(url: string, tournamentId: string): Promise<string> {
  const primaryRes = await fetch(url);
  if (!primaryRes.ok) {
    throw new Error(`Failed to fetch tournament page: HTTP ${primaryRes.status} for tournament ${tournamentId}`);
  }

  const primaryHtml = await primaryRes.text();
  // After redirects (chess-results.com → s2/s3), use the final URL for POSTs
  // so the ViewState matches the server that generated it.
  const resolvedUrl = primaryRes.url || url;
  if (!isOldTournamentGate(primaryHtml)) {
    // Page has data but tournament details (linked tournaments, etc.) may be
    // collapsed behind a "Show tournament details" button.  Try to expand them.
    if (/cb_alleDetails/.test(primaryHtml) && !/class="CRnowrap"/.test(primaryHtml)) {
      try {
        const jar = new SimpleCookieJar();
        jar.updateFromResponse(primaryRes);
        const body = new URLSearchParams();
        for (const [k, v] of extractHiddenFields(primaryHtml).entries()) {
          body.set(k, v);
        }
        body.set('cb_alleDetails', 'Show tournament details');
        const expandRes = await fetch(resolvedUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Cookie: jar.toHeader(),
            Referer: resolvedUrl,
          },
          body: body.toString(),
        });
        if (expandRes.ok) {
          const expandedHtml = await expandRes.text();
          // Accept if the expanded HTML gained metadata (CRnowrap) or
          // tournament selection links — different servers vary in markup.
          if (/class="CRnowrap"|Tournament selection|Selec[çc][ãa]o|Selecci[oó]n|Sélection|Auswahl/i.test(expandedHtml)) {
            return expandedHtml;
          }
        }
      } catch (_) { /* expansion is best-effort */ }
    }
    return primaryHtml;
  }

  const s2Url = url.replace(BASE_URL, S2_BASE_URL);
  const s2Get = await fetch(s2Url);
  if (s2Get.ok) {
    const s2Html = await s2Get.text();
    if (!isOldTournamentGate(s2Html)) {
      return s2Html;
    }
  }

  const gateUrl = `${S2_BASE_URL}/tnr${tournamentId}.aspx?lan=${SCRAPE_LANG}&turdet=YES&SNode=S0`;
  const jar = new SimpleCookieJar();

  const gateGet = await fetch(gateUrl);
  if (!gateGet.ok) {
    return primaryHtml;
  }

  jar.updateFromResponse(gateGet);
  const gateHtml = await gateGet.text();
  if (!isOldTournamentGate(gateHtml)) {
    return gateHtml;
  }

  const body = new URLSearchParams();
  for (const [k, v] of extractHiddenFields(gateHtml).entries()) {
    body.set(k, v);
  }

  // Detect the gate bypass target dynamically from the page.
  // ASP.NET link buttons use __doPostBack('target',''); regular submit buttons
  // use their name=value pair with empty __EVENTTARGET.
  const $gate = cheerio.load(gateHtml);
  const submitBtn = $gate('input[type="submit"]').first();
  const postbackMatch = gateHtml.match(/__doPostBack\('([^']+)'/);

  if (submitBtn.length > 0 && submitBtn.attr('name')) {
    // Regular submit button — include its name/value, leave __EVENTTARGET empty
    body.set('__EVENTTARGET', '');
    body.set('__EVENTARGUMENT', '');
    body.set(submitBtn.attr('name')!, submitBtn.attr('value') || '');
  } else if (postbackMatch) {
    // Link button — set __EVENTTARGET to the postback target
    body.set('__EVENTTARGET', postbackMatch[1]);
    body.set('__EVENTARGUMENT', '');
  } else {
    // Fallback
    body.set('__EVENTTARGET', '');
    body.set('__EVENTARGUMENT', '');
  }

  const postRes = await fetch(gateUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: jar.toHeader(),
      Referer: gateUrl,
    },
    body: body.toString(),
  });
  if (!postRes.ok) {
    return primaryHtml;
  }

  jar.updateFromResponse(postRes);

  const unlockedRes = await fetch(s2Url, {
    headers: {
      Cookie: jar.toHeader(),
      Referer: gateUrl,
    },
  });
  if (!unlockedRes.ok) {
    return primaryHtml;
  }

  return unlockedRes.text();
}

function buildUrl(tournamentId: string, round: number): string {
  return `${BASE_URL}/tnr${tournamentId}.aspx?lan=${SCRAPE_LANG}&art=2&rd=${round}&turdet=YES`;
}

function buildBoardPairingsUrl(tournamentId: string, round: number): string {
  return `${BASE_URL}/tnr${tournamentId}.aspx?lan=${SCRAPE_LANG}&art=3&rd=${round}&turdet=YES`;
}

// ─── Freshness helpers ────────────────────────────────────────────────────────

/**
 * Check if a tournament date is yesterday or earlier.
 * Date format from chess-results: "YYYY/MM/DD" or "YYYY/MM/DD to YYYY/MM/DD".
 */
function isTournamentFinished(dateStr: string): boolean {
  if (!dateStr) return false;
  // Use the end date if a range is present (e.g. "2024/02/11 to 2024/02/18")
  const parts = dateStr.split(/\s+to\s+/i);
  const endDate = parts[parts.length - 1].trim();
  const match = endDate.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (!match) return false;
  const tournamentEnd = new Date(`${match[1]}-${match[2]}-${match[3]}T23:59:59`);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(23, 59, 59, 999);
  return tournamentEnd <= yesterday;
}

/**
 * Fetch a lightweight page from chess-results.com and extract the "Last update" timestamp.
 */
async function fetchRemoteLastUpdated(
  tournamentId: string,
): Promise<string | undefined> {
  try {
    const url = `${BASE_URL}/tnr${tournamentId}.aspx?lan=${SCRAPE_LANG}&turdet=YES`;
    const html = await fetchTournamentHtml(url, tournamentId);
    const $ = cheerio.load(html);
    const meta = parseTournamentMeta($);
    return meta.lastUpdated;
  } catch (_) {
    return undefined;
  }
}

/**
 * Enrich parsed data with DB fallback for metadata that may be stripped
 * from archive pages (totalRounds, linkedTournaments, etc.).
 */
function enrichFromDb(
  info: TournamentData['info'] | StandingsData['info'],
  tournamentId: string,
): void {
  try {
    const dbTournament = getTournament(tournamentId);
    if (!dbTournament) return;
    if (info.totalRounds === 0 && dbTournament.total_rounds > 0) {
      info.totalRounds = dbTournament.total_rounds;
    }
    if (!info.linkedTournaments?.length && dbTournament.linked_tournaments) {
      try {
        const stored = JSON.parse(dbTournament.linked_tournaments);
        if (Array.isArray(stored) && stored.length > 0) {
          info.linkedTournaments = stored;
          if (!info.currentLabel) {
            info.currentLabel = dbTournament.event_label || undefined;
          }
        }
      } catch (_) { /* malformed JSON is non-critical */ }
    }
  } catch (_) { /* DB read is non-critical */ }
}

// ─── Full tournament scrape ───────────────────────────────────────────────────

/**
 * Scrape all rounds of pairings + standings for a tournament.
 * Used when a tournament is new or its data is stale.
 */
export async function scrapeFullTournament(
  tournamentId: string,
): Promise<void> {
  // First, determine totalRounds from a pairings page
  const firstUrl = buildUrl(tournamentId, 1);
  const firstHtml = await fetchTournamentHtml(firstUrl, tournamentId);
  const firstData = parseHtml(firstHtml, 1);
  enrichFromDb(firstData.info, tournamentId);

  const totalRounds = firstData.info.totalRounds;
  const isTeam = firstData.info.type === TournamentType.TeamSwiss ||
                 firstData.info.type === TournamentType.TeamRoundRobin;

  // For team tournaments, also fetch board-level pairings (art=3) for round 1
  if (isTeam) {
    try {
      const boardUrl = buildBoardPairingsUrl(tournamentId, 1);
      const boardHtml = await fetchTournamentHtml(boardUrl, tournamentId);
      const boardData = parseBoardPairingsHtml(boardHtml, 1);
      if (boardData.teamPairings && boardData.teamPairings.length > 0) {
        firstData.teamPairings = boardData.teamPairings;
        firstData.pairings = boardData.pairings;
      }
    } catch (_) { /* board pairings are best-effort */ }
  }

  // Persist round 1
  try { persistPairings(tournamentId, firstData.info, 1, firstData.pairings, firstData.teamPairings); } catch (_) {}

  // Scrape remaining rounds
  for (let rd = 2; rd <= totalRounds; rd++) {
    try {
      const url = buildUrl(tournamentId, rd);
      const html = await fetchTournamentHtml(url, tournamentId);
      const data = parseHtml(html, rd);

      // For team tournaments, also fetch board-level pairings (art=3)
      if (isTeam) {
        try {
          const boardUrl = buildBoardPairingsUrl(tournamentId, rd);
          const boardHtml = await fetchTournamentHtml(boardUrl, tournamentId);
          const boardData = parseBoardPairingsHtml(boardHtml, rd);
          if (boardData.teamPairings && boardData.teamPairings.length > 0) {
            data.teamPairings = boardData.teamPairings;
            data.pairings = boardData.pairings;
          }
        } catch (_) { /* board pairings are best-effort */ }
      }

      persistPairings(tournamentId, data.info, rd, data.pairings, data.teamPairings);
    } catch (_) { /* individual round failures are non-critical */ }
  }

  // Scrape standings
  try {
    const standingsData = await scrapeStandingsFromRemote(tournamentId);
    persistStandings(tournamentId, standingsData.info, standingsData.standings, standingsData.womenStandings);

    // Scrape player cards (art=9) for extended player data
    await scrapePlayerCards(tournamentId, standingsData.standings);
  } catch (_) { /* standings are non-critical during full scrape */ }
}

import type { Standing } from './types';

/**
 * Scrape art=9 player card pages for all players in a tournament.
 * Extracts birth year, national ID, performance rating, rating change, national rating.
 */
async function scrapePlayerCards(
  tournamentId: string,
  standings: Standing[],
): Promise<void> {
  for (const s of standings) {
    if (!s.startingNumber) continue;
    try {
      const url = `${BASE_URL}/tnr${tournamentId}.aspx?lan=${SCRAPE_LANG}&art=9&turdet=YES&snr=${s.startingNumber}`;
      const html = await fetchTournamentHtml(url, tournamentId);
      const $ = cheerio.load(html);
      const card = parsePlayerCard($);
      if (card.name) {
        persistPlayerCard(tournamentId, card);
      }
    } catch (_) { /* individual player card failures are non-critical */ }
  }
}

// ─── Core scrape from remote (no DB check) ────────────────────────────────────

async function scrapePairingsFromRemote(
  tournamentId: string,
  round: number,
): Promise<TournamentData> {
  const url = buildUrl(tournamentId, round);
  const html = await fetchTournamentHtml(url, tournamentId);

  try {
    const data = parseHtml(html, round);
    enrichFromDb(data.info, tournamentId);

    const isTeam = data.info.type === TournamentType.TeamSwiss ||
                   data.info.type === TournamentType.TeamRoundRobin;

    // For team tournaments, also fetch board-level pairings (art=3)
    if (isTeam) {
      try {
        const boardUrl = buildBoardPairingsUrl(tournamentId, round);
        const boardHtml = await fetchTournamentHtml(boardUrl, tournamentId);
        const boardData = parseBoardPairingsHtml(boardHtml, round);
        enrichFromDb(boardData.info, tournamentId);

        // Merge: use board-level data for pairings, keep team-level data
        if (boardData.teamPairings && boardData.teamPairings.length > 0) {
          data.teamPairings = boardData.teamPairings;
          data.pairings = boardData.pairings;
        }
      } catch (_) { /* board pairings are best-effort */ }
    }

    // Persist to database (best-effort)
    try { persistPairings(tournamentId, data.info, round, data.pairings, data.teamPairings); } catch (_) {}

    return data;
  } catch (e) {
    throw new Error(`Failed to parse pairings for tournament ${tournamentId}, round ${round}: ${e instanceof Error ? e.message : e}`);
  }
}

async function scrapeStandingsFromRemote(
  tournamentId: string,
): Promise<StandingsData> {
  let result: StandingsData | null = null;
  let usedArt = 0;

  // Try crosstable first (art=4), fall back to standard list (art=1)
  for (const art of [4, 1]) {
    const url = `${BASE_URL}/tnr${tournamentId}.aspx?lan=${SCRAPE_LANG}&art=${art}&turdet=YES`;
    const html = await fetchTournamentHtml(url, tournamentId);

    try {
      const data = parseStandingsHtml(html);
      if (data.standings.length > 0 || art === 1) {
        result = data;
        usedArt = art;
        break;
      }
    } catch (e) {
      if (art === 1) {
        throw new Error(`Failed to parse standings for tournament ${tournamentId}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  if (!result) {
    throw new Error(`No standings found for tournament ${tournamentId}`);
  }

  // Crosstables (art=4) lack the sex column, team standings, and sometimes startingNumbers.
  // If we used art=4, fetch art=1 to supplement missing data.
  if (usedArt !== 1 && result.standings.length > 0) {
    const isTeam = result.info.type === TournamentType.TeamSwiss ||
                   result.info.type === TournamentType.TeamRoundRobin;
    const missingSnr = result.standings.some(s => !s.startingNumber);
    const needsFallback = result.womenStandings.length === 0 || missingSnr || (isTeam && !result.teamStandings?.length);

    if (needsFallback) {
      try {
        const url = `${BASE_URL}/tnr${tournamentId}.aspx?lan=${SCRAPE_LANG}&art=1&turdet=YES`;
        const html = await fetchTournamentHtml(url, tournamentId);
        const fallback = parseStandingsHtml(html);
        if (fallback.womenStandings.length > 0) {
          result = { ...result, womenStandings: fallback.womenStandings };
        }
        if (isTeam && fallback.teamStandings && fallback.teamStandings.length > 0) {
          result = { ...result, teamStandings: fallback.teamStandings };
        }
        // Merge startingNumbers from art=1 when art=4 lacks them
        if (missingSnr && fallback.standings.length > 0) {
          const snrByName = new Map(fallback.standings.map(s => [s.name, s.startingNumber]));
          result = {
            ...result,
            standings: result.standings.map(s =>
              !s.startingNumber && snrByName.has(s.name)
                ? { ...s, startingNumber: snrByName.get(s.name)! }
                : s
            ),
          };
        }
      } catch (_) { /* best-effort: supplementary data is optional */ }
    }
  }

  // Enrich sex data from women standings
  const womenNames = new Set(result.womenStandings.map((s) => s.name));
  const enrichedStandings = result.standings.map((s) => (
    womenNames.has(s.name) && !s.sex
      ? { ...s, sex: 'F' as const }
      : s
  ));

  const enrichedResult: StandingsData = {
    ...result,
    standings: enrichedStandings,
  };

  enrichFromDb(enrichedResult.info, tournamentId);

  return enrichedResult;
}

// ─── Freshness cache ──────────────────────────────────────────────────────────

/** Short-lived in-memory cache to avoid redundant remote freshness checks. */
const freshnessCache = new Map<string, { status: 'fresh' | 'scraped' | 'live'; timestamp: number }>();
const FRESHNESS_CACHE_TTL = 60_000; // 1 minute

// ─── Centralized tournament data management ───────────────────────────────────

/**
 * Ensure a tournament's data is fresh in the database.
 * Single entry point for all tournament data freshness decisions.
 *
 * Decision tree:
 * 1. Tournament NOT in DB → full scrape (all rounds, standings, player cards)
 * 2. Tournament in DB, ended ≥ 1 day ago:
 *    a. Remote lastUpdated ≤ DB → 'fresh' (serve from DB)
 *    b. Remote lastUpdated > DB → full scrape → 'scraped'
 * 3. Tournament in DB, still live → 'live' (caller scrapes specific data)
 */
export async function ensureTournamentData(
  tournamentId: string,
): Promise<'fresh' | 'scraped' | 'live'> {
  const cached = freshnessCache.get(tournamentId);
  if (cached && Date.now() - cached.timestamp < FRESHNESS_CACHE_TTL) {
    return cached.status;
  }

  const dbTournament = getTournament(tournamentId);

  if (!dbTournament) {
    try {
      await scrapeFullTournament(tournamentId);
      freshnessCache.set(tournamentId, { status: 'scraped', timestamp: Date.now() });
      return 'scraped';
    } catch (_) {
      return 'live'; // Full scrape failed — caller should try single-page scrape
    }
  }

  if (!isTournamentFinished(dbTournament.date)) {
    freshnessCache.set(tournamentId, { status: 'live', timestamp: Date.now() });
    return 'live';
  }

  // Finished tournament — check remote freshness
  const remoteLastUpdated = await fetchRemoteLastUpdated(tournamentId);

  if (remoteLastUpdated && dbTournament.last_updated && remoteLastUpdated <= dbTournament.last_updated) {
    freshnessCache.set(tournamentId, { status: 'fresh', timestamp: Date.now() });
    return 'fresh';
  }

  if (remoteLastUpdated && (!dbTournament.last_updated || remoteLastUpdated > dbTournament.last_updated)) {
    try {
      await scrapeFullTournament(tournamentId);
      freshnessCache.set(tournamentId, { status: 'scraped', timestamp: Date.now() });
      return 'scraped';
    } catch (_) {
      freshnessCache.set(tournamentId, { status: 'fresh', timestamp: Date.now() });
      return 'fresh'; // Full scrape failed — serve stale DB data
    }
  }

  // Couldn't determine remote freshness — serve from DB
  freshnessCache.set(tournamentId, { status: 'fresh', timestamp: Date.now() });
  return 'fresh';
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function scrapePairings(
  tournamentId: string,
  round: number,
): Promise<TournamentData> {
  // Check SQLite cache first (avoids ensureTournamentData overhead for repeat visits)
  const cacheKey = `pairings:v1:${tournamentId}:${round}`;
  const cached = getCache<TournamentData>(cacheKey);
  if (cached) return cached;

  const status = await ensureTournamentData(tournamentId);

  if (status !== 'live') {
    const fromDb = getPairingsFromDb(tournamentId, round);
    if (fromDb) {
      // For team tournaments, ensure we have team pairings data.
      // If the DB was populated before team persistence was added, fall through to remote.
      const isTeam = fromDb.info.type === TournamentType.TeamSwiss ||
                     fromDb.info.type === TournamentType.TeamRoundRobin;
      if (!isTeam || (fromDb.teamPairings && fromDb.teamPairings.length > 0)) {
        setCache(cacheKey, fromDb, CACHE_TTL);
        return fromDb;
      }
    }
  }

  const result = await scrapePairingsFromRemote(tournamentId, round);
  // Cache live tournament data with a shorter TTL
  setCache(cacheKey, result, status === 'live' ? 60 : CACHE_TTL);
  return result;
}

export async function scrapeStandings(
  tournamentId: string,
): Promise<StandingsData> {
  const cacheKey = `standings:v3:${tournamentId}`;
  const cached = getCache<StandingsData>(cacheKey);
  if (cached) return cached;

  const status = await ensureTournamentData(tournamentId);

  if (status !== 'live') {
    const fromDb = getStandingsFromDb(tournamentId);
    if (fromDb) {
      setCache(cacheKey, fromDb, CACHE_TTL);
      return fromDb;
    }
  }

  const result = await scrapeStandingsFromRemote(tournamentId);
  setCache(cacheKey, result, CACHE_TTL);

  try {
    persistStandings(tournamentId, result.info, result.standings, result.womenStandings);
  } catch (_) { /* DB write is non-critical */ }

  return result;
}

/**
 * Ensure player card data (national IDs, birth year, etc.) is populated.
 * Scrapes art=9 pages for all players that are missing national_id.
 * Called before XML export to guarantee player IDs are available.
 */
export async function ensurePlayerCards(
  tournamentId: string,
): Promise<void> {
  const { getPlayerNationalIds } = await import('./db');
  const existingIds = getPlayerNationalIds(tournamentId);

  // If some players already have national IDs, assume cards were scraped
  if (Object.keys(existingIds).length > 0) return;

  // Otherwise, scrape standings to get player list, then fetch cards
  try {
    const standingsData = await scrapeStandingsFromRemote(tournamentId);
    if (standingsData.standings.length > 0) {
      await scrapePlayerCards(tournamentId, standingsData.standings);
    }
  } catch (_) { /* best-effort */ }
}

// ─── Parsing functions (delegate to strategy) ─────────────────────────────────

/**
 * Parse pairings HTML — auto-detects tournament type and delegates to strategy.
 * Exported for direct use in tests.
 */
export function parseHtml(html: string, round: number): TournamentData {
  const $ = cheerio.load(html);
  const strategy = getStrategyFromHtml($);
  const meta = parseTournamentMeta($);
  return strategy.parsePairings($, round, meta);
}

/**
 * Parse board-level pairings HTML (art=3) for team tournaments.
 * Falls back to standard parsePairings if the strategy doesn't support board pairings.
 */
export function parseBoardPairingsHtml(html: string, round: number): TournamentData {
  const $ = cheerio.load(html);
  const strategy = getStrategyFromHtml($);
  const meta = parseTournamentMeta($);
  if (strategy.parseBoardPairings) {
    return strategy.parseBoardPairings($, round, meta);
  }
  return strategy.parsePairings($, round, meta);
}

/**
 * Parse standings HTML — auto-detects tournament type and delegates to strategy.
 * Exported for direct use in tests.
 */
export function parseStandingsHtml(html: string): StandingsData {
  const $ = cheerio.load(html);
  const strategy = getStrategyFromHtml($);
  const meta = parseTournamentMeta($);
  return strategy.parseStandings($, meta);
}
