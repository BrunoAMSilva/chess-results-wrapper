import type * as cheerio from 'cheerio';
import {
  type TournamentStrategy,
  checkForErrors,
  parseStandingsTable,
  deriveWomenStandings,
  parseTeamPairings,
} from './base';
import { TournamentType } from '../types';
import type {
  TournamentInfo,
  TournamentData,
  StandingsData,
} from '../types';

/**
 * Strategy for Team Round-Robin tournaments.
 *
 * On chess-results.com, art=2 for team round-robin tournaments shows
 * team-level pairings in the same format as team Swiss:
 *   No. | Team | Team | Res. | : | Res.
 *
 * Like team Swiss, art=2 shows one round at a time (despite individual
 * round-robin showing all rounds on one page). The difference is in the
 * scheduling system (all-play-all vs Swiss pairings), which is only
 * visible in the tournament metadata.
 */
export class TeamRoundRobinStrategy implements TournamentStrategy {
  readonly type = TournamentType.TeamRoundRobin;

  parsePairings(
    $: cheerio.CheerioAPI,
    round: number,
    info: Omit<TournamentInfo, 'round' | 'type'>,
  ): TournamentData {
    checkForErrors($, $.html());

    const teamPairings = parseTeamPairings($);

    return {
      info: { ...info, round, type: this.type },
      pairings: [], // Individual board pairings not available on art=2 for team events
      teamPairings: teamPairings.length > 0 ? teamPairings : undefined,
    };
  }

  parseStandings(
    $: cheerio.CheerioAPI,
    info: Omit<TournamentInfo, 'round' | 'type'>,
  ): StandingsData {
    checkForErrors($, $.html());

    const { standings, hasSexColumn } = parseStandingsTable($);
    const womenStandings = hasSexColumn ? deriveWomenStandings(standings) : [];

    return {
      info: { ...info, round: 0, type: this.type },
      standings,
      womenStandings,
    };
  }
}
