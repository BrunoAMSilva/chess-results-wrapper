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

const S2_BASE_URL = 'https://s2.chess-results.com';

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
  return /LinkButton2|mais de 2 semanas|more than 2 weeks|mehr als 2 Wochen|m[aá]s de 2 semanas/i.test(html);
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

async function fetchTournamentHtml(url: string, tournamentId: string, lang: number): Promise<string> {
  const primaryRes = await fetch(url);
  if (!primaryRes.ok) {
    throw new Error(`Failed to fetch tournament page: HTTP ${primaryRes.status} for tournament ${tournamentId}`);
  }

  const primaryHtml = await primaryRes.text();
  if (!isOldTournamentGate(primaryHtml)) {
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

  const gateUrl = `${S2_BASE_URL}/tnr${tournamentId}.aspx?lan=${lang}&turdet=YES&SNode=S0`;
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
  body.set('__EVENTTARGET', 'ctl00$P1$LinkButton2');
  body.set('__EVENTARGUMENT', '');

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

function buildUrl(tournamentId: string, round: number, lang = 1): string {
  return `${BASE_URL}/tnr${tournamentId}.aspx?lan=${lang}&art=2&rd=${round}&turdet=YES`;
}

export async function scrapePairings(
  tournamentId: string,
  round: number,
  lang = 1,
): Promise<TournamentData> {
  const cacheKey = `pairings:v2:${tournamentId}:${round}:${lang}`;
  const cached = getCache<TournamentData>(cacheKey);
  if (cached) return cached;

  const url = buildUrl(tournamentId, round, lang);
  const html = await fetchTournamentHtml(url, tournamentId, lang);

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
  const cacheKey = `standings:v2:${tournamentId}:${lang}`;
  const cached = getCache<StandingsData>(cacheKey);
  if (cached) return cached;

  let result: StandingsData | null = null;
  let usedArt = 0;

  // Try crosstable first (art=4), fall back to standard list (art=1)
  for (const art of [4, 1]) {
    const url = `${BASE_URL}/tnr${tournamentId}.aspx?lan=${lang}&art=${art}&turdet=YES`;
    const html = await fetchTournamentHtml(url, tournamentId, lang);

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
      const html = await fetchTournamentHtml(url, tournamentId, lang);
      const fallback = parseStandingsHtml(html);
      if (fallback.womenStandings.length > 0) {
        result = { ...result, womenStandings: fallback.womenStandings };
      }
    } catch (_) { /* best-effort: women's standings are optional */ }
  }

  // Some tournaments expose women standings separately; mark those players as F
  // when the main standings entry is missing sex.
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

  setCache(cacheKey, enrichedResult, CACHE_TTL);

  // Persist to database (best-effort)
  try {
    persistStandings(tournamentId, enrichedResult.info, enrichedResult.standings);
  } catch (_) { /* DB write is non-critical */ }

  return enrichedResult;
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
