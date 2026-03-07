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
  // on one page with "Round N" headers)
  if (totalRounds === 0) {
    let maxRd = 0;
    $('table.CRs1 tr').each((_, row) => {
      const text = $(row).text().trim();
      const m = text.match(/^(?:Round|Ronda|Runde|Ronde)\s+(\d+)\b/i) ||
                text.match(/^(\d+)\.\s*(?:Round|Ronda|Runde|Ronde)\b/i);
      if (m) {
        const rd = parseInt(m[1], 10);
        if (rd > maxRd) maxRd = rd;
      }
    });
    totalRounds = maxRd;
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
