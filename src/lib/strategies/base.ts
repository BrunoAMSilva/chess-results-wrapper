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
      const text = $(el).text();
      return (
        text.includes('Number of rounds') ||
        text.includes('Número de rondas') ||
        text.includes('Rundenanzahl') ||
        text.includes('Nombre de rondes')
      );
    })
    .next()
    .text()
    .trim();
  let totalRounds = parseInt(totalRoundsText) || 0;

  // Fallback 1: derive totalRounds from rd= links on the page
  if (totalRounds === 0) {
    let maxRd = 0;
    $('a[href*="rd="]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const rdMatch = href.match(/[?&]rd=(\d+)/);
      if (rdMatch) {
        const rd = parseInt(rdMatch[1], 10);
        if (rd > maxRd) maxRd = rd;
      }
    });
    totalRounds = maxRd;
  }

  // Fallback 2: count round separator rows (round-robin pages show all rounds
  // on one page with "N. Round" / "N. Ronda" / "N. Runde" headers)
  if (totalRounds === 0) {
    let maxRd = 0;
    $('table.CRs1 tr').each((_, row) => {
      const text = $(row).text().trim();
      const m = text.match(/^(\d+)\.\s*(?:Ronda|Round|Runde|Tour)\b/i);
      if (m) {
        const rd = parseInt(m[1], 10);
        if (rd > maxRd) maxRd = rd;
      }
    });
    totalRounds = maxRd;
  }

  // Fallback 3: "after N rounds" text (e.g. "após 5 rondas", "after 9 rounds")
  if (totalRounds === 0) {
    const pageText = $.text();
    const m = pageText.match(/(?:após|after|nach)\s+(\d+)\s+(?:rondas|rounds|Runden)/i);
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

  return { name, totalRounds, date, location, linkedTournaments, currentLabel };
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
    'Turnierauswahl',
    'Selección de torneo',
    'Sélection du tournoi',
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
  let nameIdx = 2;
  let fedIdx = 4;
  let rtgIdx = -1;
  let clubIdx = -1;
  let sexIdx = -1;
  let snoIdx = -1;

  const headerRow = $('table.CRs1 tr')
    .filter((_, row) => $(row).find('th').length > 0)
    .first();

  headerRow.find('th, td').each((i, el) => {
    const text = $(el).text().trim();
    if (text === 'Pts.' || text === 'Pts') ptsIdx = i;
    if (text.includes('TB1') || text.includes('Desp1')) tb1Idx = i;
    if (text.includes('TB2') || text.includes('Desp2')) tb2Idx = i;
    if (text.includes('TB3') || text.includes('Desp3')) tb3Idx = i;
    if (text === 'Name' || text === 'Nome' || text === 'Nombre') nameIdx = i;
    if (text === 'FED') fedIdx = i;
    if (text === 'Rtg' || text === 'RtgI' || text === 'Elo') rtgIdx = i;
    if (text === 'Club/City' || text.includes('Clube') || text === 'Verein/Ort') clubIdx = i;
    if (text.toLowerCase() === 'sex' || text.toLowerCase() === 'sexo') sexIdx = i;
    if (text === 'SNo' || text === 'NrI') snoIdx = i;
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

    let points = '';
    if (ptsIdx !== -1 && cells[ptsIdx]) {
      points = $(cells[ptsIdx]).text().trim();
    }

    const tb1 = tb1Idx !== -1 && cells[tb1Idx] ? $(cells[tb1Idx]).text().trim() : '';
    const tb2 = tb2Idx !== -1 && cells[tb2Idx] ? $(cells[tb2Idx]).text().trim() : '';
    const tb3 = tb3Idx !== -1 && cells[tb3Idx] ? $(cells[tb3Idx]).text().trim() : '';

    standings.push({
      rank,
      startingNumber: sno,
      name,
      fed,
      rating,
      club,
      points,
      sex,
      tieBreak1: tb1,
      tieBreak2: tb2,
      tieBreak3: tb3,
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
    if (text === 'Bo.') boIdx = i;
    if (text === 'White' || text === 'Brancas' || text === 'Blancas' || text === 'Weiß' || text === 'Blancs') whiteIdx = i;
    if (text === 'Black' || text === 'Negras' || text === 'Schwarz' || text === 'Noirs') blackIdx = i;
    if (text === 'Result' || text === 'Resultado' || text === 'Resultat' || text === 'Ergebnis' || text === 'Résultat') resultIdx = i;
    if (text === 'No.' && whiteIdx === -1) whiteNoIdx = i;
    if (text === 'No.' && blackIdx !== -1) blackNoIdx = i;
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
    if (text === 'No.' || text === 'Nr.') noIdx = i;
    if (text === 'Team') {
      if (teamFound === 0) homeTeamIdx = i;
      else awayTeamIdx = i;
      teamFound++;
    }
    if (text === 'Res.' || text === 'Result' || text === 'Resultado') {
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
  $('table.CRs1 tr').each((_, row) => {
    const text = $(row).text();
    if (text.includes('Team')) {
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
