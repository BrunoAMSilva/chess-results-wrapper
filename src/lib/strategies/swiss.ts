import type * as cheerio from 'cheerio';
import {
  type TournamentStrategy,
  checkForErrors,
  parseStandingsTable,
  deriveWomenStandings,
  detectPairingColumns,
} from './base';
import { TournamentType } from '../types';
import type {
  TournamentInfo,
  TournamentData,
  StandingsData,
  Pairing,
} from '../types';

/**
 * Strategy for Swiss-System individual tournaments.
 *
 * Pairings: One page per round, each row is a single board.
 * Standings: Standard ranking list with Pts and tie-break columns.
 */
export class SwissStrategy implements TournamentStrategy {
  readonly type = TournamentType.Swiss;

  parsePairings(
    $: cheerio.CheerioAPI,
    round: number,
    info: Omit<TournamentInfo, 'round' | 'type'>,
  ): TournamentData {
    checkForErrors($, $.html());

    const cols = detectPairingColumns($);
    const pairings: Pairing[] = [];

    $('table.CRs1 tr').each((_, row) => {
      const $row = $(row);

      const isDataRow =
        $row.hasClass('CRng1') || $row.hasClass('CRng2') ||
        $row.hasClass('CRg1') || $row.hasClass('CRg2');
      if (!isDataRow) return;

      const cells = $row.find('td');
      if (cells.length < 6) return;

      const tableNum = parseInt($(cells[cols.boIdx]).text().trim());
      if (isNaN(tableNum)) return;

      const whiteNum = parseInt($(cells[cols.whiteNoIdx]).text().trim());
      const whiteName =
        cols.whiteIdx !== -1
          ? $(cells[cols.whiteIdx]).find('a').text().trim() || $(cells[cols.whiteIdx]).text().trim()
          : '';
      const result =
        cols.resultIdx !== -1 ? $(cells[cols.resultIdx]).text().trim() : '';

      const blackName =
        cols.blackIdx !== -1
          ? $(cells[cols.blackIdx]).find('a').text().trim() || $(cells[cols.blackIdx]).text().trim()
          : '';
      const blackNum =
        cols.blackNoIdx !== -1
          ? parseInt($(cells[cols.blackNoIdx]).text().trim())
          : NaN;

      const isUnpaired =
        blackName === 'bye' ||
        blackName.includes('não emparceirado') ||
        blackName.includes('not paired') ||
        blackName.includes('spielfrei') ||
        !blackName;

      pairings.push({
        table: tableNum,
        white: { name: whiteName, number: whiteNum },
        black: isUnpaired ? null : { name: blackName, number: isNaN(blackNum) ? 0 : blackNum },
        result,
      });
    });

    return {
      info: { ...info, round, type: this.type },
      pairings,
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
