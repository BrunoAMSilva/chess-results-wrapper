import type * as cheerio from 'cheerio';
import {
  type TournamentStrategy,
  checkForErrors,
  parseStandingsTable,
  deriveWomenStandings,
  parseTeamPairings,
  parseTeamBoardPairings,
  parseTeamStandings,
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
 * Art=3 shows board-level pairings with individual player matchups
 * grouped under team match headers.
 *
 * Art=1 shows team-composition standings with per-team player breakdowns.
 * Art=4 shows individual player rankings with a Team column.
 *
 * Team Swiss shows one round at a time (round selector in the URL).
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
      pairings: [],
      teamPairings: teamPairings.length > 0 ? teamPairings : undefined,
    };
  }

  parseBoardPairings(
    $: cheerio.CheerioAPI,
    round: number,
    info: Omit<TournamentInfo, 'round' | 'type'>,
  ): TournamentData {
    checkForErrors($, $.html());

    const teamPairings = parseTeamBoardPairings($, round);

    // Extract individual board pairings from all team matches
    const pairings = teamPairings.flatMap(tp => tp.boards);

    return {
      info: { ...info, round, type: this.type },
      pairings,
      teamPairings: teamPairings.length > 0 ? teamPairings : undefined,
    };
  }

  parseStandings(
    $: cheerio.CheerioAPI,
    info: Omit<TournamentInfo, 'round' | 'type'>,
  ): StandingsData {
    checkForErrors($, $.html());

    // Try team-composition format first (art=1 for team tournaments)
    const teamStandings = parseTeamStandings($);

    if (teamStandings.length > 0) {
      // Extract individual standings from team composition
      const standings = teamStandings.flatMap(team =>
        team.players.map((p, i) => ({
          rank: i + 1,
          startingNumber: p.board,
          title: '',
          name: p.name,
          fed: p.fed,
          rating: p.rating,
          club: team.name,
          points: p.points,
          sex: '' as const,
          fideId: p.fideId,
          tieBreak1: '',
          tieBreak2: '',
          tieBreak3: '',
          tieBreak4: '',
          tieBreak5: '',
          tieBreak6: '',
        }))
      );

      return {
        info: { ...info, round: 0, type: this.type },
        standings,
        womenStandings: [],
        teamStandings,
      };
    }

    // Fallback to standard standings table (art=4 individual rankings)
    const { standings, hasSexColumn } = parseStandingsTable($);
    const womenStandings = hasSexColumn ? deriveWomenStandings(standings) : [];

    return {
      info: { ...info, round: 0, type: this.type },
      standings,
      womenStandings,
    };
  }
}
