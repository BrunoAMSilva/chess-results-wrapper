import type { Pairing, TeamPairing } from './types';

const RESULT_MAP: Record<string, string> = {
  '1-0': '1-0',
  '0-1': '0-1',
  '½-½': '1/2',
  '+:-': '1-0F',
  '-:+': '0-1F',
  '-:-': '0-0F',
};

function invertResult(res: string): string {
  if (res === '1-0') return '0-1';
  if (res === '0-1') return '1-0';
  if (res === '1-0F') return '0-1F';
  if (res === '0-1F') return '1-0F';
  return res; // 1/2, 0-0F stay the same
}

export function mapResult(raw: string): string {
  return RESULT_MAP[raw] ?? '';
}

export { invertResult };

export interface XmlExportParams {
  round: number;
  teamPairings: TeamPairing[];
  allPairings: Pairing[];
  /** Referee results keyed by table number (raw format like "1-0", "½-½", etc.) */
  resultsMap: Record<number, string>;
  /**
   * Which Swiss-Manager import format to produce.
   * - `'results'` (default): `<Results>` root — for "Import Player-Results"
   * - `'team-compositions'`: `<TeamCompositions>` root — for "Import Teamcompositions"
   */
  format?: 'results' | 'team-compositions';
}

/**
 * Build Swiss-Manager compatible XML for referee result export.
 *
 * Produces a single valid XML document matching one of the Swiss-Manager
 * import formats (see {@link XmlExportParams.format}).
 *
 * Key conventions:
 * - Individual tournaments: p.white/p.black are actual board White/Black.
 * - Team tournaments: p.white/p.black are home/away team players (NOT board colors).
 *   Actual board colors follow odd/even board rule: odd boards → home has White,
 *   even boards → away has White.
 * - Referee results are entered from left-player (home) perspective.
 * - "Result" Res is from actual White's perspective.
 * - Player identification uses Starting Rank Number (SNo), which is the
 *   sequential number Swiss-Manager assigns and publishes to chess-results.com.
 *   This is the most reliable identifier since it originates from Swiss-Manager.
 */
export function buildRefereeExportXml(params: XmlExportParams): string {
  const { round, teamPairings, allPairings, resultsMap, format = 'results' } = params;

  function playerSNo(startingNumber: number): string {
    return String(startingNumber || 0);
  }

  // Build stable team name → ID mapping (deterministic from sorted names)
  const teamIdMap = new Map<string, number>();
  if (teamPairings.length > 0) {
    const teamNames = new Set<string>();
    for (const tm of teamPairings) {
      teamNames.add(tm.whiteTeam);
      teamNames.add(tm.blackTeam);
    }
    const sorted = [...teamNames].sort();
    sorted.forEach((name, i) => teamIdMap.set(name, i + 1));
  }
  function resolveTeamId(teamName: string): number {
    return teamIdMap.get(teamName) || 0;
  }

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');

  if (format === 'team-compositions') {
    // ── Team Compositions ──────────────────────────────────────────────────
    lines.push('<TeamCompositions>');
    for (const tm of teamPairings) {
      const homeTeamId = resolveTeamId(tm.whiteTeam);
      const awayTeamId = resolveTeamId(tm.blackTeam);

      for (const b of tm.boards) {
        const boardNum = b.table % 100;

        // Home team player entry (b.white = home team player).
        lines.push(
          `<TeamComposition Round="${round}" TeamUniqueId="${homeTeamId}" Board="${boardNum}" PlayerSNo="${playerSNo(b.white.number)}"/>`,
        );

        // Away team player entry (b.black = away team player).
        if (b.black) {
          lines.push(
            `<TeamComposition Round="${round}" TeamUniqueId="${awayTeamId}" Board="${boardNum}" PlayerSNo="${playerSNo(b.black.number)}"/>`,
          );
        }
      }
    }
    lines.push('</TeamCompositions>');
  } else {
    // ── Results (default) ────────────────────────────────────────────────────
    lines.push('<Results>');

    if (teamPairings.length > 0) {
      // Team tournament: b.white/b.black are home/away — resolve actual board colors.
      for (const p of allPairings) {
        const res = resultsMap[p.table] ?? '';
        const smRes = mapResult(res);
        const boardNum = p.table % 100;
        const homeHasWhite = boardNum % 2 === 1;

        // Determine actual White/Black player numbers
        const actualWhiteNum = homeHasWhite ? p.white.number : (p.black?.number || 0);
        const actualBlackNum = homeHasWhite ? (p.black?.number || 0) : p.white.number;

        // smRes is from home perspective; convert to actual White's perspective
        const whiteRes = homeHasWhite ? smRes : invertResult(smRes);

        lines.push(
          `<Result Round="${round}" PlayerWhiteSNo="${playerSNo(actualWhiteNum)}" PlayerBlackSNo="${playerSNo(actualBlackNum)}" Res="${whiteRes}" />`,
        );
      }
    } else {
      // Individual tournament: p.white/p.black are actual White/Black
      for (const p of allPairings) {
        const res = resultsMap[p.table] ?? '';
        const smRes = mapResult(res);
        lines.push(
          `<Result Round="${round}" PlayerWhiteSNo="${playerSNo(p.white.number)}" PlayerBlackSNo="${playerSNo(p.black?.number || 0)}" Res="${smRes}" />`,
        );
      }
    }

    lines.push('</Results>');
  }

  return lines.join('\n');
}
