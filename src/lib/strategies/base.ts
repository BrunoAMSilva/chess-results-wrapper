import type * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type {
  TournamentInfo,
  TournamentType,
  LinkedTournament,
  Standing,
  TournamentData,
  StandingsData,
  Sex,
  PlayerCardData,
} from '../types';

/**
 * Abstract base for tournament-type–specific parsing logic.
 *
 * chess-results.com supports four tournament systems:
 *   - Swiss-System (individual)
 *   - Round Robin (individual)
 *   - Team Swiss-System
 *   - Team Round Robin
 *
 * Each system renders pairings and standings with slightly different HTML
 * structures. Concrete strategies encapsulate those differences.
 */
export interface TournamentStrategy {
  readonly type: TournamentType;

  /** Parse pairings HTML for a specific round. */
  parsePairings($: cheerio.CheerioAPI, round: number, info: Omit<TournamentInfo, 'round' | 'type'>): TournamentData;

  /** Parse standings HTML. */
  parseStandings($: cheerio.CheerioAPI, info: Omit<TournamentInfo, 'round' | 'type'>): StandingsData;

  /**
   * Parse board-level pairings from art=3 page (team tournaments only).
   * Returns TeamPairing[] with individual board matchups populated.
   * Default implementation returns undefined (non-team strategies).
   */
  parseBoardPairings?($: cheerio.CheerioAPI, round: number, info: Omit<TournamentInfo, 'round' | 'type'>): TournamentData;
}

// ─── Shared helpers used by all strategies ────────────────────────────────────

/**
 * Extract tournament metadata from the page header area.
 * This logic is identical across all tournament types.
 */
export function parseTournamentMeta($: cheerio.CheerioAPI): Omit<TournamentInfo, 'round' | 'type'> {
  const name = $('h2').first().text().trim();

  const roundLine = $('h3').last().text().trim();
  const dateMatch = roundLine.match(/(\d{4}\/\d{2}\/\d{2})/);
  const date = dateMatch ? dateMatch[1] : '';

  const totalRoundsText = $('td.CR')
    .filter((_, el) => {
      const t = $(el).text().trim();
      return t.includes('Number of rounds') ||
             t.includes('Número de rondas') ||
             t.includes('Número de jornadas') ||
             t.includes('Nombre de rondes') ||
             t.includes('Anzahl der Runden');
    })
    .next()
    .text()
    .trim();
  let totalRounds = parseInt(totalRoundsText) || 0;

  // Compute max rd= from links on the page (represents actually-available rounds)
  let maxRdFromLinks = 0;
  $('a[href*="rd="]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const rdMatch = href.match(/[?&]rd=(\d+)/);
    if (rdMatch) {
      const rd = parseInt(rdMatch[1], 10);
      if (rd > maxRdFromLinks) maxRdFromLinks = rd;
    }
  });

  // Count round separator rows (round-robin pages show all rounds on one page
  // with "Round N" headers). Computed early so it can inform the capping step.
  let maxRdFromSeparators = 0;
  $('table.CRs1 tr').each((_, row) => {
    const text = $(row).text().trim();
    const m = text.match(/^(?:Round|Ronda|Runde|Ronde)\s+(\d+)\b/i) ||
              text.match(/^(\d+)\.\s*(?:Round|Ronda|Runde|Ronde)\b/i);
    if (m) {
      const rd = parseInt(m[1], 10);
      if (rd > maxRdFromSeparators) maxRdFromSeparators = rd;
    }
  });

  // Best evidence of how many rounds are actually available on this page:
  // rd= navigation links (Swiss) or inline round separators (Round Robin).
  const maxAvailableRound = Math.max(maxRdFromLinks, maxRdFromSeparators);

  // Fallback 1: derive totalRounds from available round evidence
  if (totalRounds === 0) {
    totalRounds = maxAvailableRound;
  }

  // Cap totalRounds to actually available rounds — the metadata "Number of
  // rounds" represents planned rounds which may exceed played rounds.
  if (maxAvailableRound > 0 && maxAvailableRound < totalRounds) {
    totalRounds = maxAvailableRound;
  }

  // Fallback 3: "after N rounds" text (e.g. "after 9 rounds")
  if (totalRounds === 0) {
    const pageText = $.text();
    const m = pageText.match(/(?:after|após|nach|après|después de)\s+(\d+)\s+(?:rounds|rondas|Runden|rondes|jornadas)/i);
    if (m) {
      totalRounds = parseInt(m[1], 10) || 0;
    }
  }

  const location =
    $('td.CR a')
      .filter((_, el) => ($(el).attr('href') || '').includes('google.com/maps'))
      .text()
      .trim() || '';

  const { linkedTournaments, currentLabel } = parseLinkedTournaments($);

  const lastUpdated = parseLastUpdated($);

  return { name, totalRounds, date, location, linkedTournaments, currentLabel, lastUpdated };
}

/**
 * Parse "Last update DD.MM.YYYY HH:MM:SS" from the CRsmall paragraph.
 * Returns an ISO-format timestamp string, or undefined if not found.
 */
function parseLastUpdated($: cheerio.CheerioAPI): string | undefined {
  const smallText = $('p.CRsmall').text();
  const match = smallText.match(
    /(?:Last update|Última (?:Actual|Atual)iza[çc][ãa]o|Última actualización|Letzte Aktualisierung|Dernière actualisation)\s*(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2}:\d{2})/i,
  );
  if (!match) return undefined;
  const [day, month, year] = match[1].split('.');
  return `${year}-${month}-${day}T${match[2]}`;
}

/**
 * Parse the "Tournament selection" row to extract all tournaments
 * belonging to the same event.
 * The current tournament appears as bold/italic text; linked ones as <a> links.
 */
function parseLinkedTournaments($: cheerio.CheerioAPI): {
  linkedTournaments?: LinkedTournament[];
  currentLabel?: string;
} {
  const selectionLabels = [
    'Tournament selection',
    'Selecção de torneio',
    'Seleção de torneio',
    'Selección de torneo',
    'Sélection du tournoi',
    'Turnierauswahl',
  ];

  let selectionCell: cheerio.Cheerio<Element> | null = null;

  $('td.CRnowrap').each((_, el) => {
    const text = $(el).text().trim();
    if (selectionLabels.some((label) => text === label)) {
      selectionCell = $(el).next('td.CR');
    }
  });

  if (!selectionCell) return {};

  // Current tournament's short label is in <i><b>...</b></i>
  const currentLabel = $(selectionCell!).find('i > b').first().text().trim() || undefined;

  const tournaments: LinkedTournament[] = [];

  $(selectionCell!).find('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/tnr(\d+)\.aspx/);
    if (match) {
      tournaments.push({ id: match[1], name: $(el).text().trim() });
    }
  });

  return {
    linkedTournaments: tournaments.length > 0 ? tournaments : undefined,
    currentLabel,
  };
}

/** Check if the HTML page contains an error message. */
export function checkForErrors($: cheerio.CheerioAPI, html: string): void {
  if ($('.error').length > 0 || html.includes('Record not found')) {
    throw new Error('Tournament not found');
  }
}

/** Detect column index by matching header text against known translations. */
export function findColumnIndex(
  headerRow: cheerio.Cheerio<Element>,
  $: cheerio.CheerioAPI,
  ...labels: string[]
): number {
  let idx = -1;
  headerRow.find('th, td').each((i, el) => {
    const text = $(el).text().trim();
    if (labels.some((l) => text === l || text.includes(l))) {
      idx = i;
    }
  });
  return idx;
}

/** Parse the sex value from a cell. */
export function parseSex(text: string): Sex {
  const t = text.trim().toLowerCase();
  if (t === 'w' || t === 'f') return 'F';
  if (t === 'm') return 'M';
  return '';
}

/**
 * Build standard standings from the CRs1 table.
 * Handles both individual and crosstable formats.
 * Returns raw standings + whether a sex column was detected.
 */
export function parseStandingsTable(
  $: cheerio.CheerioAPI,
): { standings: Standing[]; hasSexColumn: boolean } {
  // Find column indices
  let ptsIdx = -1;
  let tb1Idx = -1;
  let tb2Idx = -1;
  let tb3Idx = -1;
  let tb4Idx = -1;
  let tb5Idx = -1;
  let tb6Idx = -1;
  let nameIdx = 2;
  let fedIdx = 4;
  let rtgIdx = -1;
  let clubIdx = -1;
  let sexIdx = -1;
  let snoIdx = -1;
  let fideIdIdx = -1;

  const headerRow = $('table.CRs1 tr')
    .filter((_, row) => $(row).find('th').length > 0)
    .first();

  headerRow.find('th, td').each((i, el) => {
    const text = $(el).text().trim();
    if (text === 'Pts.' || text === 'Pts') ptsIdx = i;
    if (text.includes('TB1') || text.includes('Desp1')) tb1Idx = i;
    if (text.includes('TB2') || text.includes('Desp2')) tb2Idx = i;
    if (text.includes('TB3') || text.includes('Desp3')) tb3Idx = i;
    if (text.includes('TB4') || text.includes('Desp4')) tb4Idx = i;
    if (text.includes('TB5') || text.includes('Desp5')) tb5Idx = i;
    if (text.includes('TB6') || text.includes('Desp6')) tb6Idx = i;
    if (text === 'Name' || text === 'Nome' || text === 'Nombre') nameIdx = i;
    if (text === 'FED') fedIdx = i;
    if (text === 'Rtg' || text === 'RtgI' || text === 'Elo') rtgIdx = i;
    if (text === 'Club/City' || text.includes('Clube') || text === 'Verein/Ort') clubIdx = i;
    if (text.toLowerCase() === 'sex' || text.toLowerCase() === 'sexo') sexIdx = i;
    if (text === 'SNo' || text === 'NrI') snoIdx = i;
    if (text === 'FideID' || text === 'FIDE-ID' || text === 'Id FIDE') fideIdIdx = i;
  });

  const hasSexColumn = sexIdx !== -1;
  const standings: Standing[] = [];

  $('table.CRs1 tr').each((_, row) => {
    const $row = $(row);
    if ($row.find('th').length > 0 || $row.hasClass('CRng1b')) return;

    const cells = $row.find('td');
    if (cells.length < 5) return;

    const rankText = $(cells[0]).text().trim();
    const rank = parseInt(rankText);
    if (isNaN(rank)) return;

    const name = $(cells[nameIdx]).text().trim();
    const fed = fedIdx !== -1 && cells[fedIdx] ? $(cells[fedIdx]).text().trim() : '';
    const rating = rtgIdx !== -1 && cells[rtgIdx] ? $(cells[rtgIdx]).text().trim() : '';
    const club = clubIdx !== -1 && cells[clubIdx] ? $(cells[clubIdx]).text().trim() : '';
    const sex = sexIdx !== -1 && cells[sexIdx] ? parseSex($(cells[sexIdx]).text()) : '';
    const sno = snoIdx !== -1 && cells[snoIdx] ? parseInt($(cells[snoIdx]).text().trim()) || 0 : 0;

    // Extract FIDE ID from explicit column or from player name link
    let fideId = '';
    if (fideIdIdx !== -1 && cells[fideIdIdx]) {
      fideId = $(cells[fideIdIdx]).text().trim();
    }
    if (!fideId && cells[nameIdx]) {
      const nameLink = $(cells[nameIdx]).find('a[href*="art=9"]').attr('href') || '';
      // Also try FIDE profile links in adjacent cells
      const fideLink = $(cells[nameIdx]).find('a[href*="fide.com/profile"]').attr('href') || '';
      if (fideLink) {
        const fideMatch = fideLink.match(/profile\/?(\d+)/);
        if (fideMatch) fideId = fideMatch[1];
      }
    }

    let points = '';
    if (ptsIdx !== -1 && cells[ptsIdx]) {
      points = $(cells[ptsIdx]).text().trim();
    }

    const tb1 = tb1Idx !== -1 && cells[tb1Idx] ? $(cells[tb1Idx]).text().trim() : '';
    const tb2 = tb2Idx !== -1 && cells[tb2Idx] ? $(cells[tb2Idx]).text().trim() : '';
    const tb3 = tb3Idx !== -1 && cells[tb3Idx] ? $(cells[tb3Idx]).text().trim() : '';
    const tb4 = tb4Idx !== -1 && cells[tb4Idx] ? $(cells[tb4Idx]).text().trim() : '';
    const tb5 = tb5Idx !== -1 && cells[tb5Idx] ? $(cells[tb5Idx]).text().trim() : '';
    const tb6 = tb6Idx !== -1 && cells[tb6Idx] ? $(cells[tb6Idx]).text().trim() : '';

    standings.push({
      rank,
      startingNumber: sno,
      name,
      fed,
      rating,
      club,
      points,
      sex,
      fideId,
      tieBreak1: tb1,
      tieBreak2: tb2,
      tieBreak3: tb3,
      tieBreak4: tb4,
      tieBreak5: tb5,
      tieBreak6: tb6,
    });
  });

  return { standings, hasSexColumn };
}

/**
 * Derive women's standings from a full standings list.
 * Re-ranks only players whose sex is 'F', preserving their relative order.
 */
export function deriveWomenStandings(standings: Standing[]): Standing[] {
  return standings
    .filter((s) => s.sex === 'F')
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

/**
 * Parse pairings columns from the CRs1 header row.
 * Returns the indices needed to extract board, white, black, and result data.
 */
export interface PairingColumnIndices {
  boIdx: number;
  whiteIdx: number;
  blackIdx: number;
  resultIdx: number;
  whiteNoIdx: number;
  blackNoIdx: number;
}

export function detectPairingColumns($: cheerio.CheerioAPI): PairingColumnIndices {
  let whiteIdx = -1;
  let blackIdx = -1;
  let resultIdx = -1;
  let boIdx = 0;
  let whiteNoIdx = 1;
  let blackNoIdx = -1;

  const headerRow = $('table.CRs1 tr')
    .filter((_, row) => $(row).find('th').length > 3)
    .first();

  headerRow.find('th, td').each((i, el) => {
    const text = $(el).text().trim();
    if (text === 'Bo.' || text === 'Tab.') boIdx = i;
    if (text === 'White' || text === 'Brancas' || text === 'Blancas' || text === 'Blancs' || text === 'Weiß') whiteIdx = i;
    if (text === 'Black' || text === 'Pretas' || text === 'Negras' || text === 'Noirs' || text === 'Schwarz') blackIdx = i;
    if (text === 'Result' || text === 'Resultado' || text === 'Résultat' || text === 'Ergebnis') resultIdx = i;
    if ((text === 'No.' || text === 'Nº.') && whiteIdx === -1) whiteNoIdx = i;
    if ((text === 'No.' || text === 'Nº.') && blackIdx !== -1) blackNoIdx = i;
  });

  return { boIdx, whiteIdx, blackIdx, resultIdx, whiteNoIdx, blackNoIdx };
}

// ─── Team pairings helpers ────────────────────────────────────────────────────

/**
 * Detect team pairings columns from the CRs1 header row.
 * Team pairings use "No. | Team | Team | Res. | : | Res." format.
 */
export interface TeamPairingColumnIndices {
  noIdx: number;
  homeTeamIdx: number;
  awayTeamIdx: number;
  homeResIdx: number;
  awayResIdx: number;
}

export function detectTeamPairingColumns($: cheerio.CheerioAPI): TeamPairingColumnIndices {
  let noIdx = 0;
  let homeTeamIdx = 1;
  let awayTeamIdx = 2;
  let homeResIdx = 3;
  let awayResIdx = -1;

  const headerRow = $('table.CRs1 tr')
    .filter((_, row) => {
      const text = $(row).text();
      return $(row).find('th, td').length > 3 && text.includes('Team');
    })
    .first();

  let teamFound = 0;
  let resFound = 0;

  headerRow.find('th, td').each((i, el) => {
    const text = $(el).text().trim();
    if (text === 'No.' || text === 'Nr.' || text === 'Nº.') noIdx = i;
    if (text === 'Team' || text === 'Equipa' || text === 'Equipo' || text === 'Équipe' || text === 'Mannschaft') {
      if (teamFound === 0) homeTeamIdx = i;
      else awayTeamIdx = i;
      teamFound++;
    }
    if (text === 'Res.' || text === 'Result' || text === 'Resultado' || text === 'Résultat' || text === 'Ergebnis') {
      if (resFound === 0) homeResIdx = i;
      else awayResIdx = i;
      resFound++;
    }
  });

  return { noIdx, homeTeamIdx, awayTeamIdx, homeResIdx, awayResIdx };
}

/**
 * Check if the pairings page uses team columns (Team | Team | Res.)
 * instead of individual columns (White | Black | Result).
 */
export function isTeamPairingsPage($: cheerio.CheerioAPI): boolean {
  let hasTeamCol = false;
  const teamLabels = ['Team', 'Equipa', 'Equipo', 'Équipe', 'Mannschaft'];
  $('table.CRs1 tr').each((_, row) => {
    const text = $(row).text();
    if (teamLabels.some((label) => text.includes(label))) {
      hasTeamCol = true;
      return false; // break
    }
  });
  return hasTeamCol;
}

import type { TeamPairing } from '../types';

/**
 * Parse team-level pairings from the "No. | Team | Team | Res. | : | Res." table format.
 * Each data row represents a team match result (not an individual board).
 */
export function parseTeamPairings(
  $: cheerio.CheerioAPI,
): TeamPairing[] {
  const cols = detectTeamPairingColumns($);
  const teamPairings: TeamPairing[] = [];

  $('table.CRs1 tr').each((_, row) => {
    const $row = $(row);

    // Skip separator and header rows
    if ($row.hasClass('CRg1b') || $row.hasClass('CRng1b')) return;

    const isDataRow =
      $row.hasClass('CRng1') || $row.hasClass('CRng2') ||
      $row.hasClass('CRg1') || $row.hasClass('CRg2');
    if (!isDataRow) return;

    const cells = $row.find('td');
    if (cells.length < 4) return;

    const tableNum = parseInt($(cells[cols.noIdx]).text().trim());
    if (isNaN(tableNum)) return;

    const homeTeam = $(cells[cols.homeTeamIdx]).text().trim();
    const awayTeam = $(cells[cols.awayTeamIdx]).text().trim();
    const homeRes = $(cells[cols.homeResIdx]).text().trim();
    const awayRes = cols.awayResIdx !== -1 ? $(cells[cols.awayResIdx]).text().trim() : '';

    // Combine result as "homeRes : awayRes"
    const result = awayRes ? `${homeRes}:${awayRes}` : homeRes;

    const isUnpaired =
      awayTeam === 'bye' ||
      awayTeam.includes('spielfrei') ||
      awayTeam.includes('not paired') ||
      !awayTeam;

    teamPairings.push({
      table: tableNum,
      whiteTeam: homeTeam,
      blackTeam: isUnpaired ? 'bye' : awayTeam,
      boards: [], // Individual board data not available on art=2
      result,
    });
  });

  return teamPairings;
}

// ─── Board Pairings (art=3) ───────────────────────────────────────────────────

import type { TeamStanding } from '../types';

/** Extract chess-results starting number (snr) from a player link's href. */
function extractSnr(link: cheerio.Cheerio<Element> | null): number {
  if (!link || link.length === 0) return 0;
  const href = link.attr('href') || '';
  const m = href.match(/[?&]snr=(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Parse board-level pairings from art=3 page.
 *
 * Art=3 layout for team tournaments:
 *   - Round separator (CRg1b td): "Round 1 on 2026/01/03 at 15:00"
 *   - Match header (CRng1b th): Bo. | homeNo | homeTeam | Rtg | - | awayNo | awayTeam | Rtg | score
 *   - Board data rows (CRng1/CRng2): boardNo | _ | homeName | _ | homeName | homeRtg | - | _ | awayName | _ | awayName | awayRtg | result
 *
 * Returns TeamPairing[] with populated boards[] arrays.
 */
export function parseTeamBoardPairings(
  $: cheerio.CheerioAPI,
  round: number,
): TeamPairing[] {
  const teamPairings: TeamPairing[] = [];
  let currentRound = round; // default to requested round
  let currentMatch: TeamPairing | null = null;

  $('table.CRs1 tr').each((_, row) => {
    const $row = $(row);

    // Round separator row (CRg1b td, no th cells)
    if ($row.hasClass('CRg1b') && $row.find('th').length === 0) {
      const text = $row.text().trim();
      const roundMatch = text.match(/(?:Round|Ronda|Runde|Ronde)\s+(\d+)/i);
      if (roundMatch) {
        currentRound = parseInt(roundMatch[1], 10);
      }
      return;
    }

    // Match header row (CRng1b with th cells defining teams)
    // Format: Bo. | homeNo | homeTeam | Rtg | - | awayNo | awayTeam | Rtg | score
    if ($row.hasClass('CRng1b') && $row.find('th').length > 3) {
      if (currentRound !== round) return;

      // Save previous match
      if (currentMatch) {
        teamPairings.push(currentMatch);
      }

      const ths = $row.find('th');
      const firstTh = $(ths[0]).text().trim();

      // Skip repeated column headers (Bo. | Name | Rtg | ...)
      if (firstTh === 'Bo.' || firstTh === 'Tab.') {
        // This is a column header, not a match header — check if it has team names
        // Match headers have the pattern: Bo. | number | TeamName | Rtg | - | number | TeamName | Rtg | score
        const secondTh = $(ths[1]).text().trim();
        if (!/^\d+$/.test(secondTh)) {
          // Not a match header, just a repeated column header
          return;
        }
      }

      // Parse match header: th[1]=homeNo, th[2]=homeTeam, th[5]=awayNo, th[6]=awayTeam, th[8]=score
      const homeTeam = ths.length > 2 ? $(ths[2]).text().trim() : '';
      const awayTeam = ths.length > 6 ? $(ths[6]).text().trim() : '';
      const score = ths.length > 8 ? $(ths[8]).text().trim() : '';
      const tableNum = ths.length > 1 ? parseInt($(ths[1]).text().trim()) || 0 : 0;

      const isUnpaired = !awayTeam || awayTeam.toLowerCase() === 'bye' ||
        awayTeam.toLowerCase().includes('spielfrei');

      currentMatch = {
        table: tableNum,
        whiteTeam: homeTeam,
        blackTeam: isUnpaired ? 'bye' : awayTeam,
        boards: [],
        result: score,
      };
      return;
    }

    // Board data rows
    if (currentRound !== round || !currentMatch) return;

    const isDataRow =
      $row.hasClass('CRng1') || $row.hasClass('CRng2') ||
      $row.hasClass('CRg1') || $row.hasClass('CRg2');
    if (!isDataRow) return;

    const cells = $row.find('td');
    if (cells.length < 6) return;

    // Board number format: "matchNo.boardNo" (e.g., "1.1", "1.2")
    const boardText = $(cells[0]).text().trim();
    const boardMatch = boardText.match(/\d+\.(\d+)/);
    const boardNum = boardMatch ? parseInt(boardMatch[1]) : parseInt(boardText) || 0;
    if (boardNum === 0) return;

    // Home player: cells[2] or cells[4] has name, cells[5] has rating
    const homeLink = cells.length > 4
      ? ($(cells[4]).find('a').first() || $(cells[2]).find('a').first())
      : $(cells[2]).find('a').first();
    const homeName = cells.length > 4
      ? ($(cells[4]).find('a').text().trim() || $(cells[4]).text().trim() ||
         $(cells[2]).find('a').text().trim() || $(cells[2]).text().trim())
      : $(cells[2]).text().trim();
    const homeNumber = extractSnr(homeLink);

    // Away player: cells[8] or cells[10] has name, cells[11] has rating
    const awayLink = cells.length > 10
      ? ($(cells[10]).find('a').first() || $(cells[8]).find('a').first())
      : cells.length > 8
        ? $(cells[8]).find('a').first()
        : null;
    const awayName = cells.length > 10
      ? ($(cells[10]).find('a').text().trim() || $(cells[10]).text().trim() ||
         $(cells[8]).find('a').text().trim() || $(cells[8]).text().trim())
      : cells.length > 8
        ? $(cells[8]).text().trim()
        : '';
    const awayNumber = awayLink ? extractSnr(awayLink) : 0;

    const result = cells.length > 12 ? $(cells[12]).text().trim() :
                   cells.length > 11 ? $(cells[11]).text().trim() : '';

    const awayNameLower = awayName.toLowerCase();
    const isBye = awayNameLower === 'bye' || awayNameLower.includes('spielfrei') ||
      awayNameLower.includes('livre') || !awayName;

    // Use unique table number: matchTable * 100 + boardNum to avoid collisions
    const uniqueTable = currentMatch.table * 100 + boardNum;

    currentMatch.boards.push({
      table: uniqueTable,
      white: { name: homeName, number: homeNumber },
      black: isBye ? null : { name: awayName, number: awayNumber },
      unpairedLabel: isBye ? (awayName || 'BYE') : undefined,
      result,
    });
  });

  // Don't forget the last match
  if (currentMatch) {
    teamPairings.push(currentMatch);
  }

  return teamPairings;
}

// ─── Team Standings (art=1 for team tournaments) ──────────────────────────────

/**
 * Parse team-composition standings from art=1 team tournament pages.
 *
 * Art=1 layout:
 *   - Team header separator (CRg1b td): "1. TEAM NAME (RtgAvg:1896, Captain: Name / TB1: 12 / TB2: 0)"
 *   - Column header (CRng1b th): Bo. | | Name | Rtg | FED | FideID | 1 | 2 | ... | Pts. | Games | RtgAvg
 *   - Player data rows (CRng1/CRng2): board | | name | rtg | fed | fideId | rd1 | rd2 | ... | pts | games | rtgAvg
 */
export function parseTeamStandings(
  $: cheerio.CheerioAPI,
): TeamStanding[] {
  const teams: TeamStanding[] = [];
  let currentTeam: TeamStanding | null = null;

  // Column indices for player rows (set from each team's header)
  let nameIdx = 2;
  let rtgIdx = 3;
  let fedIdx = 4;
  let fideIdIdx = 5;
  let ptsIdx = -1;
  let gamesIdx = -1;
  let rtgAvgIdx = -1;

  $('table.CRs1 tr').each((_, row) => {
    const $row = $(row);

    // Team header separator: "1. TEAM NAME (RtgAvg:..., Captain:... / TB1: ... / TB2: ...)"
    if (($row.hasClass('CRg1b') || $row.hasClass('CRng1b')) && $row.find('th').length === 0) {
      const text = $row.text().trim();

      // Parse: "N. TEAM NAME (RtgAvg:NNNN, Captain: ... / TB1: N / TB2: N)"
      const teamMatch = text.match(/^\s*(\d+)\.\s+(.+?)(?:\s*\((.+)\))?$/);
      if (teamMatch) {
        // Save previous team
        if (currentTeam) teams.push(currentTeam);

        const rank = parseInt(teamMatch[1]);
        const name = teamMatch[2].trim();
        const meta = teamMatch[3] || '';

        const rtgAvgMatch = meta.match(/RtgAvg:\s*(\d+)/);
        const captainMatch = meta.match(/Captain:\s*([^/]+)/);
        const tb1Match = meta.match(/TB1:\s*([\d.,]+)/);
        const tb2Match = meta.match(/TB2:\s*([\d.,]+)/);

        currentTeam = {
          rank,
          name,
          ratingAvg: rtgAvgMatch ? parseInt(rtgAvgMatch[1]) : 0,
          captain: captainMatch ? captainMatch[1].trim() : '',
          tieBreak1: tb1Match ? tb1Match[1] : '',
          tieBreak2: tb2Match ? tb2Match[1] : '',
          players: [],
        };
      }
      return;
    }

    // Column header row for each team (CRng1b with th)
    if ($row.hasClass('CRng1b') && $row.find('th').length > 0) {
      // Re-detect column indices
      $row.find('th').each((i, th) => {
        const text = $(th).text().trim();
        if (text === 'Name' || text === 'Nome' || text === 'Nombre' || text === 'Nom') nameIdx = i;
        if (text === 'Rtg' || text === 'RtgI' || text === 'Elo') rtgIdx = i;
        if (text === 'FED' || text === 'Fed') fedIdx = i;
        if (text === 'FideID' || text === 'FIDE-ID' || text === 'Id FIDE') fideIdIdx = i;
        if (text === 'Pts.' || text === 'Pts') ptsIdx = i;
        if (text === 'Games' || text === 'Jogos' || text === 'Partidas' || text === 'Parties') gamesIdx = i;
        if (text === 'RtgAvg' || text === 'EloAvg') rtgAvgIdx = i;
      });
      return;
    }

    // Player data rows within a team
    if (!currentTeam) return;

    const isDataRow =
      $row.hasClass('CRng1') || $row.hasClass('CRng2') ||
      $row.hasClass('CRg1') || $row.hasClass('CRg2');
    if (!isDataRow) return;

    const cells = $row.find('td');
    if (cells.length < 4) return;

    const boardText = $(cells[0]).text().trim();
    const board = parseInt(boardText) || 0;
    if (board === 0) return;

    const name = nameIdx < cells.length ? $(cells[nameIdx]).text().trim() : '';
    const rating = rtgIdx < cells.length ? $(cells[rtgIdx]).text().trim() : '';
    const fed = fedIdx < cells.length ? $(cells[fedIdx]).text().trim() : '';
    const fideId = fideIdIdx < cells.length ? $(cells[fideIdIdx]).text().trim() : '';
    const points = ptsIdx !== -1 && ptsIdx < cells.length ? $(cells[ptsIdx]).text().trim() : '';
    const games = gamesIdx !== -1 && gamesIdx < cells.length ? $(cells[gamesIdx]).text().trim() : '';
    const ratingAvg = rtgAvgIdx !== -1 && rtgAvgIdx < cells.length ? $(cells[rtgAvgIdx]).text().trim() : '';

    currentTeam.players.push({
      board,
      name,
      rating,
      fed,
      fideId,
      points,
      games,
      ratingAvg,
    });
  });

  // Save the last team
  if (currentTeam) teams.push(currentTeam);

  return teams;
}

// ─── Player Card (art=9) ──────────────────────────────────────────────────────

/** Multi-language label map for art=9 player card key-value rows. */
const PLAYER_CARD_LABELS: Record<string, keyof PlayerCardData> = {
  // Name
  'name': 'name', 'nome': 'name', 'nombre': 'name', 'nom': 'name',
  // Starting rank
  'starting rank': 'startingNumber', 'ranking inicial': 'startingNumber',
  'startrang': 'startingNumber', 'rang initial': 'startingNumber',
  // Rating (FIDE international)
  'rating': 'rating', 'elo': 'rating',
  'rating international': 'rating', 'elo internacional': 'rating',
  'elo intnational': 'rating', 'elo fide': 'rating', 'classement elo': 'rating',
  // Rating national
  'rating national': 'nationalRating', 'elo nacional': 'nationalRating',
  'elo national': 'nationalRating',
  // Performance rating
  'performance rating': 'performanceRating', 'performance': 'performanceRating',
  'eloperformance': 'performanceRating', 'performance elo': 'performanceRating',
  // FIDE rtg +/-
  'fide rtg +/-': 'ratingChange', 'fide elo +/-': 'ratingChange',
  'elo fide +/-': 'ratingChange',
  // Points
  'points': 'points', 'pontos': 'points', 'puntos': 'points', 'punkte': 'points',
  // Rank
  'rank': 'rank', 'lugar': 'rank', 'puesto': 'rank', 'rang': 'rank',
  // Federation
  'federation': 'federation', 'federação': 'federation',
  'federación': 'federation', 'föderation': 'federation',
  'fédération': 'federation',
  // Club/City
  'club/city': 'club', 'clube/cidade': 'club', 'club/ciudad': 'club',
  'verein/ort': 'club', 'club/ville': 'club',
  // Ident-Number
  'ident-number': 'nationalId', 'número nacional': 'nationalId',
  'código nacional': 'nationalId', 'ident-nummer': 'nationalId',
  'ident-numéro': 'nationalId',
  // Fide-ID
  'fide-id': 'fideId', 'número fide': 'fideId', 'código fide': 'fideId',
  'id fide': 'fideId', 'fideid': 'fideId',
  // Year of birth
  'year of birth': 'birthYear', 'ano de nascimento': 'birthYear',
  'fecha de nacimiento': 'birthYear', 'geburtsjahr': 'birthYear',
  'année naissance': 'birthYear',
};

/**
 * Parse a player card page (art=9) into structured data.
 * The info table is the first `table.CRs1` with 2-column key-value rows.
 */
export function parsePlayerCard($: cheerio.CheerioAPI): PlayerCardData {
  const card: PlayerCardData = {
    name: '',
    federation: '',
    fideId: '',
    club: '',
    birthYear: null,
    nationalId: '',
    rating: null,
    nationalRating: null,
    performanceRating: null,
    ratingChange: '',
    startingNumber: 0,
    rank: 0,
    points: '',
  };

  // The first CRs1 table contains key-value rows
  $('table.CRs1').first().find('tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) return;

    const label = $(cells[0]).text().trim().toLowerCase();
    const value = $(cells[1]).text().trim();
    const field = PLAYER_CARD_LABELS[label];
    if (!field) return;

    switch (field) {
      case 'name':
        card.name = value;
        break;
      case 'startingNumber':
        card.startingNumber = parseInt(value) || 0;
        break;
      case 'rating':
        card.rating = parseInt(value) || null;
        break;
      case 'nationalRating':
        card.nationalRating = parseInt(value) || null;
        break;
      case 'performanceRating':
        card.performanceRating = parseInt(value) || null;
        break;
      case 'ratingChange':
        card.ratingChange = value;
        break;
      case 'points':
        card.points = value;
        break;
      case 'rank':
        card.rank = parseInt(value) || 0;
        break;
      case 'federation':
        card.federation = value;
        break;
      case 'club':
        card.club = value;
        break;
      case 'nationalId':
        card.nationalId = value === '0' ? '' : value;
        break;
      case 'fideId':
        card.fideId = value === '0' ? '' : value;
        break;
      case 'birthYear':
        card.birthYear = parseInt(value) || null;
        break;
    }
  });

  return card;
}
