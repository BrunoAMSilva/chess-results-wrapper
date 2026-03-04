import * as cheerio from 'cheerio';
import { getCache, setCache } from './cache';
import { BASE_URL, CACHE_TTL } from './constants';
import { getStrategyFromHtml, parseTournamentMeta } from './strategies';
import { persistStandings, persistPairings } from './db';

// Re-export types from the shared types module for backward compatibility
export type {
  Pairing,
  PlayerRef,
  TournamentInfo,
  TournamentData,
  StandingsData,
  Standing,
  TeamPairing,
  LinkedTournament,
  Sex,
} from './types';
import type { TournamentData, StandingsData } from './types';

function buildUrl(tournamentId: string, round: number, lang = 1): string {
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

    // Persist to database (best-effort)
    try {
      persistPairings(tournamentId, data.info, round, data.pairings);
    } catch (_) { /* DB write is non-critical */ }

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

  let result: StandingsData | null = null;
  let usedArt = 0;

  // Try crosstable first (art=4), fall back to standard list (art=1)
  for (const art of [4, 1]) {
    const url = `${BASE_URL}/tnr${tournamentId}.aspx?lan=${lang}&art=${art}&turdet=YES`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch standings: HTTP ${res.status} for tournament ${tournamentId}`);
    const html = await res.text();

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

  // Crosstables (art=4) lack the sex column. If we used art=4 and got no
  // women's standings, try the standard list (art=1) for the sex data.
  if (usedArt !== 1 && result.standings.length > 0 && result.womenStandings.length === 0) {
    try {
      const url = `${BASE_URL}/tnr${tournamentId}.aspx?lan=${lang}&art=1&turdet=YES`;
      const res = await fetch(url);
      if (res.ok) {
        const html = await res.text();
        const fallback = parseStandingsHtml(html);
        if (fallback.womenStandings.length > 0) {
          result = { ...result, womenStandings: fallback.womenStandings };
        }
      }
    } catch (_) { /* best-effort: women's standings are optional */ }
  }

  setCache(cacheKey, result, CACHE_TTL);

  // Persist to database (best-effort)
  try {
    persistStandings(tournamentId, result.info, result.standings);
  } catch (_) { /* DB write is non-critical */ }

  return result;
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
 * Parse standings HTML — auto-detects tournament type and delegates to strategy.
 * Exported for direct use in tests.
 */
export function parseStandingsHtml(html: string): StandingsData {
  const $ = cheerio.load(html);
  const strategy = getStrategyFromHtml($);
  const meta = parseTournamentMeta($);
  return strategy.parseStandings($, meta);
}
