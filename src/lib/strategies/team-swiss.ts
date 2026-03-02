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
 * Strategy for Team Swiss-System tournaments.
 *
 * On chess-results.com, art=2 for team tournaments shows team-level pairings
 * in the format: No. | Team | Team | Res. | : | Res.
 * Each data row represents a team match (not individual boards).
 *
 * Team Swiss shows one round at a time (round selector in the URL).
 * There is typically a single "Round N" separator row followed by the
 * team column header, then team match data rows.
 */
export class TeamSwissStrategy implements TournamentStrategy {
  readonly type = TournamentType.TeamSwiss;

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

    // Team standings use the same table format but with team names
    const { standings, hasSexColumn } = parseStandingsTable($);
    const womenStandings = hasSexColumn ? deriveWomenStandings(standings) : [];

    return {
      info: { ...info, round: 0, type: this.type },
      standings,
      womenStandings,
    };
  }
}
