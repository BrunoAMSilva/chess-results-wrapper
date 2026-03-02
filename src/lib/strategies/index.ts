import type * as cheerio from 'cheerio';
import type { TournamentStrategy } from './base';
import { TournamentType } from '../types';
import { SwissStrategy } from './swiss';
import { RoundRobinStrategy } from './round-robin';
import { TeamSwissStrategy } from './team-swiss';
import { TeamRoundRobinStrategy } from './team-round-robin';
import { isTeamPairingsPage } from './base';

const strategies: Record<TournamentType, TournamentStrategy> = {
  [TournamentType.Swiss]: new SwissStrategy(),
  [TournamentType.RoundRobin]: new RoundRobinStrategy(),
  [TournamentType.TeamSwiss]: new TeamSwissStrategy(),
  [TournamentType.TeamRoundRobin]: new TeamRoundRobinStrategy(),
};

/**
 * Detect tournament type from the HTML page.
 *
 * chess-results.com indicates the tournament system in a `td.CR` cell
 * whose text contains "Tournament type" / "Tipo de torneio" / etc.
 * The next sibling cell contains the value.
 *
 * Additionally, round-robin tournaments display all rounds on a single
 * pairings page with CRg1b separator rows like "Round N on …".
 *
 * Team tournaments show "Team" column headers instead of "White"/"Black"
 * and may have "Team" or equivalent in the tournament type metadata.
 */
export function detectTournamentType($: cheerio.CheerioAPI): TournamentType {
  // 1. Check the tournament details metadata for explicit system info
  let systemText = '';
  $('td.CR').each((_, el) => {
    const text = $(el).text().trim();
    const isSystemLabel =
      text.includes('Tournament type') ||
      text.includes('Tipo de torneio') ||
      text.includes('Turniersystem') ||
      text.includes('Tipo de torneo') ||
      text.includes('Type de tournoi');
    if (isSystemLabel) {
      systemText = $(el).next().text().trim().toLowerCase();
    }
  });

  const isTeam =
    systemText.includes('team') ||
    systemText.includes('mannschaft') ||
    systemText.includes('equipa') ||
    systemText.includes('equipo');

  const isRoundRobin =
    systemText.includes('round robin') ||
    systemText.includes('round-robin') ||
    systemText.includes('liga') ||
    systemText.includes('berger') ||
    systemText.includes('all-play-all');

  if (isTeam && isRoundRobin) return TournamentType.TeamRoundRobin;
  if (isTeam) return TournamentType.TeamSwiss;
  if (isRoundRobin) return TournamentType.RoundRobin;

  // 2. HTML heuristic: check for "Team" column headers (team tournaments)
  const hasTeamColumns = isTeamPairingsPage($);

  // 3. Heuristic: if pairings page has round separator rows, it's round-robin
  const hasRoundSeparators =
    $('table.CRs1 tr.CRg1b, table.CRs1 tr.CRng1b').length > 0;

  if (hasRoundSeparators) {
    // Check if any separator row looks like a team match (contains " - ")
    // vs a round header (contains "Round N")
    let hasTeamHeaders = false;
    let hasRoundHeaders = false;

    $('table.CRs1 tr.CRg1b, table.CRs1 tr.CRng1b').each((_, row) => {
      const text = $(row).text().trim();
      if (/(?:Round|Ronda|Runde|Tour)\s+\d+/i.test(text)) {
        hasRoundHeaders = true;
      } else if (text.includes(' - ')) {
        hasTeamHeaders = true;
      }
    });

    // Team tournaments with round separators on art=2
    if (hasTeamColumns) {
      // Art=2 for team tournaments always shows one round at a time,
      // so we can't distinguish Team Swiss from Team Round Robin by
      // round separators alone. Default to TeamSwiss; metadata overrides above.
      return TournamentType.TeamSwiss;
    }

    if (hasTeamHeaders && hasRoundHeaders) return TournamentType.TeamRoundRobin;
    if (hasTeamHeaders) return TournamentType.TeamSwiss;
    if (hasRoundHeaders) return TournamentType.RoundRobin;
  }

  // Team tournament without round separators
  if (hasTeamColumns) return TournamentType.TeamSwiss;

  // Default to Swiss
  return TournamentType.Swiss;
}

/** Get the strategy instance for a given tournament type. */
export function getStrategy(type: TournamentType): TournamentStrategy {
  return strategies[type];
}

/** Detect type from HTML and return the appropriate strategy. */
export function getStrategyFromHtml($: cheerio.CheerioAPI): TournamentStrategy {
  const type = detectTournamentType($);
  return getStrategy(type);
}

export { type TournamentStrategy } from './base';
export { parseTournamentMeta, checkForErrors } from './base';
