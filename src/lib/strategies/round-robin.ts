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
 * Strategy for Round-Robin individual tournaments.
 *
 * Pairings: All rounds appear on a single page, separated by CRg1b/CRng1b
 *           rows (e.g. "Round 3 on 2026/02/28"). We filter to the requested round.
 * Standings: Cross-table format (art=4) or fallback to standard list (art=1).
 */
export class RoundRobinStrategy implements TournamentStrategy {
  readonly type = TournamentType.RoundRobin;

  private extractRoundNumber(text: string): number | null {
    const m = text.match(/(?:Round|Ronda|Runde|Ronde)\s+(\d+)/i) ||
              text.match(/(\d+)\.\s*(?:Round|Ronda|Runde|Ronde)\b/i);
    return m ? parseInt(m[1]) : null;
  }

  parsePairings(
    $: cheerio.CheerioAPI,
    round: number,
    info: Omit<TournamentInfo, 'round' | 'type'>,
  ): TournamentData {
    checkForErrors($, $.html());

    const cols = detectPairingColumns($);
    const pairings: Pairing[] = [];
    let currentRound = round; // default: assume all rows belong to the requested round

    $('table.CRs1 tr').each((_, row) => {
      const $row = $(row);

      // Detect round separator rows
      if ($row.hasClass('CRg1b') || $row.hasClass('CRng1b')) {
        const text = $row.text().trim();
        const extractedRound = this.extractRoundNumber(text);
        if (extractedRound !== null) {
          currentRound = extractedRound;
        }
        return;
      }

      // Only include pairings from the requested round
      if (currentRound !== round) return;

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

      const blackNameLower = blackName.toLowerCase();
      const isBye = blackNameLower === 'bye' || blackNameLower.includes('spielfrei');
      const isNotPaired =
        blackNameLower.includes('não emparceirado') ||
        blackNameLower.includes('not paired');
      const isUnpaired = isBye || isNotPaired || !blackName;

      pairings.push({
        table: tableNum,
        white: { name: whiteName, number: whiteNum },
        black: isUnpaired ? null : { name: blackName, number: isNaN(blackNum) ? 0 : blackNum },
        unpairedLabel: isUnpaired ? (blackName || 'BYE') : undefined,
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
