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
  /** Map from starting_number → national_id */
  nationalIds: Record<number, string>;
}

/**
 * Build Swiss-Manager compatible XML for referee result export.
 *
 * Key conventions:
 * - Individual tournaments: p.white/p.black are actual board White/Black.
 * - Team tournaments: p.white/p.black are home/away team players (NOT board colors).
 *   Actual board colors follow odd/even board rule: odd boards → home has White,
 *   even boards → away has White.
 * - Referee results are entered from left-player (home) perspective.
 * - "Result" Res is from actual White's perspective.
 * - "TeamComposition" Res is from the individual player's perspective.
 * - Player IDs use national_id when available, falling back to starting number.
 */
export function buildRefereeExportXml(params: XmlExportParams): string {
  const { round, teamPairings, allPairings, resultsMap, nationalIds } = params;

  function resolvePlayerId(startingNumber: number): string {
    return nationalIds[startingNumber] || String(startingNumber || 0);
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
  lines.push('<?xml version="1.0" encoding="utf-8"?>');

  // ── Team Compositions (team tournaments only) ──────────────────────────────

  if (teamPairings.length > 0) {
    lines.push('<TeamCompositions>');
    for (const tm of teamPairings) {
      const homeTeamId = resolveTeamId(tm.whiteTeam);
      const awayTeamId = resolveTeamId(tm.blackTeam);

      for (const b of tm.boards) {
        const res = resultsMap[b.table] ?? '';
        const smRes = mapResult(res);
        const boardNum = b.table % 100;

        // Determine actual board colors for this board.
        // In chess-results team tournaments, odd boards: home team has White;
        // even boards: away team has White.
        const homeHasWhite = boardNum % 2 === 1;
        const boardWhiteTeamId = homeHasWhite ? homeTeamId : awayTeamId;
        const boardBlackTeamId = homeHasWhite ? awayTeamId : homeTeamId;

        // Home team player entry (b.white = home team player).
        // smRes = referee result from home player's perspective = this player's perspective.
        lines.push(
          `<TeamComposition Round="${round}" PlayerId="${resolvePlayerId(b.white.number)}" Board="${boardNum}" Res="${smRes}"` +
            ` TeamUniqueId="${homeTeamId}" TeamUniqueId2="${awayTeamId}"` +
            ` TeamUniqueIdWhite="${boardWhiteTeamId}" TeamUniqueIdBlack="${boardBlackTeamId}"/>`,
        );

        // Away team player entry (b.black = away team player).
        // Result is inverted (away perspective).
        if (b.black) {
          lines.push(
            `<TeamComposition Round="${round}" PlayerId="${resolvePlayerId(b.black.number)}" Board="${boardNum}" Res="${invertResult(smRes)}"` +
              ` TeamUniqueId="${awayTeamId}" TeamUniqueId2="${homeTeamId}"` +
              ` TeamUniqueIdWhite="${boardWhiteTeamId}" TeamUniqueIdBlack="${boardBlackTeamId}"/>`,
          );
        }
      }
    }
    lines.push('</TeamCompositions>');
  }

  // ── Results ────────────────────────────────────────────────────────────────

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
        `<Result Round="${round}" PlayerWhiteId="${resolvePlayerId(actualWhiteNum)}" PlayerBlackId="${resolvePlayerId(actualBlackNum)}" Res="${whiteRes}" />`,
      );
    }
  } else {
    // Individual tournament: p.white/p.black are actual White/Black
    for (const p of allPairings) {
      const res = resultsMap[p.table] ?? '';
      const smRes = mapResult(res);
      lines.push(
        `<Result Round="${round}" PlayerWhiteId="${resolvePlayerId(p.white.number)}" PlayerBlackId="${resolvePlayerId(p.black?.number || 0)}" Res="${smRes}" />`,
      );
    }
  }

  lines.push('</Results>');

  return lines.join('\n');
}
