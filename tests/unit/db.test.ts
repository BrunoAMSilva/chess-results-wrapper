import { describe, it, expect, beforeEach } from 'vitest';
import db, {
  upsertTournament,
  getTournament,
  upsertPlayer,
  linkPlayerToTournament,
  upsertResult,
  getResults,
  upsertStanding,
  getStandings,
  persistStandings,
  persistPairings,
  persistPlayerCard,
  searchTournaments,
  getPlayerById,
  findPlayerByIdentity,
  getPlayerTournamentHistory,
  getPlayerResultRows,
} from '../../src/lib/db';
import { TournamentType } from '../../src/lib/types';
import type { TournamentInfo, Standing, Pairing } from '../../src/lib/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clearAllTables(): void {
  db.exec('DELETE FROM results');
  db.exec('DELETE FROM standings');
  db.exec('DELETE FROM tournament_players');
  db.exec('DELETE FROM players');
  db.exec('DELETE FROM tournaments');
  db.exec('DELETE FROM cache');
}

function makeTournamentInfo(overrides: Partial<TournamentInfo> = {}): TournamentInfo {
  return {
    name: 'Test Tournament 2026',
    round: 1,
    totalRounds: 9,
    date: '2026/03/01',
    location: 'Lisbon, Portugal',
    type: TournamentType.Swiss,
    linkedTournaments: undefined,
    currentLabel: undefined,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tournament CRUD
// ═══════════════════════════════════════════════════════════════════════════════

describe('Database - Tournaments', () => {
  beforeEach(clearAllTables);

  it('should insert a new tournament', () => {
    const info = makeTournamentInfo();
    upsertTournament(info, 'T001');

    const row = getTournament('T001');
    expect(row).toBeDefined();
    expect(row!.id).toBe('T001');
    expect(row!.name).toBe('Test Tournament 2026');
    expect(row!.type).toBe(TournamentType.Swiss);
    expect(row!.total_rounds).toBe(9);
    expect(row!.date).toBe('2026/03/01');
    expect(row!.location).toBe('Lisbon, Portugal');
  });

  it('should update an existing tournament on conflict', () => {
    upsertTournament(makeTournamentInfo({ name: 'Original' }), 'T001');
    upsertTournament(makeTournamentInfo({ name: 'Updated' }), 'T001');

    const row = getTournament('T001');
    expect(row!.name).toBe('Updated');
  });

  it('should preserve non-empty fields when updating with empty values', () => {
    upsertTournament(makeTournamentInfo({
      date: '2026/03/01',
      location: 'Porto',
      totalRounds: 9,
    }), 'T001');

    // Update with empty date/location — should keep original
    upsertTournament(makeTournamentInfo({
      date: '',
      location: '',
      totalRounds: 0,
    }), 'T001');

    const row = getTournament('T001');
    expect(row!.date).toBe('2026/03/01');
    expect(row!.location).toBe('Porto');
    expect(row!.total_rounds).toBe(9);
  });

  it('should store and retrieve linked tournaments as JSON', () => {
    const linked = [
      { id: '100', name: 'Federados' },
      { id: '200', name: 'Não Federados' },
    ];
    upsertTournament(makeTournamentInfo({
      linkedTournaments: linked,
      currentLabel: 'Federados',
    }), 'T001');

    const row = getTournament('T001');
    expect(row!.event_label).toBe('Federados');

    const parsed = JSON.parse(row!.linked_tournaments);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe('100');
    expect(parsed[0].name).toBe('Federados');
    expect(parsed[1].id).toBe('200');
    expect(parsed[1].name).toBe('Não Federados');
  });

  it('should preserve linked tournaments when updating with empty array', () => {
    const linked = [{ id: '100', name: 'Group A' }];
    upsertTournament(makeTournamentInfo({ linkedTournaments: linked }), 'T001');

    // Update without linked tournaments
    upsertTournament(makeTournamentInfo({ linkedTournaments: undefined }), 'T001');

    const row = getTournament('T001');
    const parsed = JSON.parse(row!.linked_tournaments);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('100');
  });

  it('should preserve event_label when updating with empty label', () => {
    upsertTournament(makeTournamentInfo({ currentLabel: 'Open A' }), 'T001');
    upsertTournament(makeTournamentInfo({ currentLabel: undefined }), 'T001');

    const row = getTournament('T001');
    expect(row!.event_label).toBe('Open A');
  });

  it('should search tournaments by name', () => {
    upsertTournament(makeTournamentInfo({ name: 'Portuguese Championship 2026' }), 'T001');
    upsertTournament(makeTournamentInfo({ name: 'Spanish Open 2026' }), 'T002');
    upsertTournament(makeTournamentInfo({ name: 'Portuguese Open 2026' }), 'T003');

    const results = searchTournaments('Portuguese');
    expect(results).toHaveLength(2);
    expect(results.map(r => r.id).sort()).toEqual(['T001', 'T003']);
  });

  it('should return undefined for non-existent tournament', () => {
    expect(getTournament('NONEXISTENT')).toBeUndefined();
  });

  it('should filter self-references from linked_tournaments', () => {
    const linked = [
      { id: 'T001', name: 'Self' },
      { id: 'T002', name: 'Other' },
    ];
    upsertTournament(makeTournamentInfo({ linkedTournaments: linked }), 'T001');

    const row = getTournament('T001');
    const parsed = JSON.parse(row!.linked_tournaments);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('T002');
  });

  it('should propagate links bidirectionally', () => {
    // Create T002 first so it exists
    upsertTournament(makeTournamentInfo({ name: 'Tournament B' }), 'T002');

    // Upsert T001 with link to T002
    const linked = [{ id: 'T002', name: 'Group B' }];
    upsertTournament(makeTournamentInfo({
      name: 'Tournament A',
      linkedTournaments: linked,
      currentLabel: 'Group A',
    }), 'T001');

    // T002 should now link back to T001
    const t2 = getTournament('T002');
    const t2Links = JSON.parse(t2!.linked_tournaments);
    expect(t2Links.some((l: any) => l.id === 'T001')).toBe(true);
  });

  it('should propagate event_label to linked tournaments missing one', () => {
    // Create T002 without event_label
    upsertTournament(makeTournamentInfo({ name: 'Tournament B', currentLabel: undefined }), 'T002');
    expect(getTournament('T002')!.event_label).toBe('');

    // Upsert T001 linking to T002 with name "Federados"
    upsertTournament(makeTournamentInfo({
      linkedTournaments: [{ id: 'T002', name: 'Federados' }],
      currentLabel: 'Group A',
    }), 'T001');

    // T002 should now have event_label = 'Federados'
    expect(getTournament('T002')!.event_label).toBe('Federados');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Player CRUD
// ═══════════════════════════════════════════════════════════════════════════════

describe('Database - Players', () => {
  beforeEach(clearAllTables);

  it('should insert a new player and return its ID', () => {
    const id = upsertPlayer('Silva, Bruno', 'POR', 'M', 'Chess Club Lisbon', 1800);
    expect(id).toBeGreaterThan(0);

    const player = getPlayerById(id);
    expect(player).toBeDefined();
    expect(player!.name).toBe('Silva, Bruno');
    expect(player!.federation).toBe('POR');
    expect(player!.sex).toBe('M');
    expect(player!.club).toBe('Chess Club Lisbon');
    expect(player!.rating).toBe(1800);
  });

  it('should return existing player ID on duplicate (name + federation)', () => {
    const id1 = upsertPlayer('Silva, Bruno', 'POR');
    const id2 = upsertPlayer('Silva, Bruno', 'POR');
    expect(id1).toBe(id2);
  });

  it('should update player fields on upsert without overwriting non-empty with empty', () => {
    const id = upsertPlayer('Silva, Bruno', 'POR', 'M', 'Club A', 1800);

    // Upsert with empty sex/club — should keep originals
    upsertPlayer('Silva, Bruno', 'POR', '', '', null);

    const player = getPlayerById(id);
    expect(player!.sex).toBe('M');
    expect(player!.club).toBe('Club A');
    expect(player!.rating).toBe(1800);
  });

  it('should match by FIDE ID when available', () => {
    const id1 = upsertPlayer('Smith, John', 'USA', 'M', '', 2000, '12345678');
    const id2 = upsertPlayer('Smith, John', 'USA', '', '', null, '12345678');
    expect(id1).toBe(id2);
  });

  it('should update player via FIDE ID even with different federation', () => {
    const id = upsertPlayer('Van der Berg, Anna', 'NED', 'F', '', 2100, '99887766');

    // Same FIDE ID but different detail: should update, not create new row
    const id2 = upsertPlayer('Van der Berg, Anna', 'NED', '', 'New Club', 2150, '99887766');
    expect(id2).toBe(id);

    const player = getPlayerById(id);
    expect(player!.club).toBe('New Club');
    expect(player!.rating).toBe(2150);
  });

  it('should adopt placeholder player when federation becomes known', () => {
    // Pairings page creates player without federation
    const idPlaceholder = upsertPlayer('Santos, Maria', '');

    // Standings page later provides federation
    const idWithFed = upsertPlayer('Santos, Maria', 'POR', 'F', 'Club B', 1500);

    expect(idWithFed).toBe(idPlaceholder);

    const player = getPlayerById(idWithFed);
    expect(player!.federation).toBe('POR');
    expect(player!.sex).toBe('F');
  });

  it('should reuse unique player by name when federation is empty', () => {
    const id1 = upsertPlayer('Unique Player', 'GER', 'M');

    // Pairing page doesn't know federation
    const id2 = upsertPlayer('Unique Player', '');
    expect(id2).toBe(id1);
  });

  it('should create separate players for different federations', () => {
    const id1 = upsertPlayer('Common Name', 'POR');
    const id2 = upsertPlayer('Common Name', 'ESP');
    expect(id1).not.toBe(id2);
  });

  it('should handle empty name gracefully', () => {
    // Edge case: some pairings have empty player names for BYEs
    // The system should still handle this without crashing
    const id = upsertPlayer('', '');
    expect(id).toBeGreaterThan(0);
  });

  it('should trim whitespace from all fields', () => {
    const id = upsertPlayer('  Silva, Bruno  ', '  POR  ', 'M', '  Club  ', 1800, '  12345  ');
    const player = getPlayerById(id);
    expect(player!.name).toBe('Silva, Bruno');
    expect(player!.federation).toBe('POR');
    expect(player!.club).toBe('Club');
    expect(player!.fide_id).toBe('12345');
  });

  it('should find player by identity preferring richer rows', () => {
    // Create placeholder
    upsertPlayer('Test Player', '');
    // Create richer record
    upsertPlayer('Test Player', 'POR', 'M', 'Club', 1800);

    const found = findPlayerByIdentity('Test Player');
    expect(found).toBeDefined();
    expect(found!.federation).toBe('POR');
  });

  it('should find player by exact name + federation', () => {
    upsertPlayer('Ambiguous Name', 'POR');
    upsertPlayer('Ambiguous Name', 'ESP');

    const found = findPlayerByIdentity('Ambiguous Name', 'ESP');
    expect(found).toBeDefined();
    expect(found!.federation).toBe('ESP');
  });

  it('should return undefined for non-existent player', () => {
    expect(findPlayerByIdentity('Nobody')).toBeUndefined();
    expect(getPlayerById(99999)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tournament-Player Linking
// ═══════════════════════════════════════════════════════════════════════════════

describe('Database - Tournament-Player Links', () => {
  beforeEach(clearAllTables);

  it('should link a player to a tournament', () => {
    upsertTournament(makeTournamentInfo(), 'T001');
    const playerId = upsertPlayer('Player A', 'POR');
    linkPlayerToTournament('T001', playerId, 1, 1500, 'Club X');

    const history = getPlayerTournamentHistory(playerId);
    expect(history).toHaveLength(1);
    expect(history[0].tournament_id).toBe('T001');
    expect(history[0].starting_number).toBe(1);
    expect(history[0].tournament_rating).toBe(1500);
    expect(history[0].tournament_club).toBe('Club X');
  });

  it('should update link on conflict (same tournament + player)', () => {
    upsertTournament(makeTournamentInfo(), 'T001');
    const playerId = upsertPlayer('Player A', 'POR');

    linkPlayerToTournament('T001', playerId, 1, 1500, 'Club X');
    linkPlayerToTournament('T001', playerId, 2, 1600, 'Club Y');

    const history = getPlayerTournamentHistory(playerId);
    expect(history).toHaveLength(1);
    expect(history[0].starting_number).toBe(2);
    expect(history[0].tournament_rating).toBe(1600);
    expect(history[0].tournament_club).toBe('Club Y');
  });

  it('should link a player to multiple tournaments', () => {
    upsertTournament(makeTournamentInfo({ name: 'Tournament A' }), 'T001');
    upsertTournament(makeTournamentInfo({ name: 'Tournament B' }), 'T002');
    const playerId = upsertPlayer('Multi-Tournament Player', 'POR');

    linkPlayerToTournament('T001', playerId, 1);
    linkPlayerToTournament('T002', playerId, 5);

    const history = getPlayerTournamentHistory(playerId);
    expect(history).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Results (Pairings)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Database - Results', () => {
  beforeEach(clearAllTables);

  it('should insert a result', () => {
    upsertTournament(makeTournamentInfo(), 'T001');
    const p1 = upsertPlayer('White Player', 'POR');
    const p2 = upsertPlayer('Black Player', 'ESP');

    upsertResult('T001', 1, 1, p1, p2, '1 - 0');

    const results = getResults('T001', 1) as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0].white_player_id).toBe(p1);
    expect(results[0].black_player_id).toBe(p2);
    expect(results[0].result).toBe('1 - 0');
    expect(results[0].white_name).toBe('White Player');
    expect(results[0].black_name).toBe('Black Player');
  });

  it('should update result on conflict (same tournament + round + table)', () => {
    upsertTournament(makeTournamentInfo(), 'T001');
    const p1 = upsertPlayer('Player A', 'POR');
    const p2 = upsertPlayer('Player B', 'ESP');

    upsertResult('T001', 1, 1, p1, p2, '');
    upsertResult('T001', 1, 1, p1, p2, '½ - ½');

    const results = getResults('T001', 1) as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0].result).toBe('½ - ½');
  });

  it('should handle BYE (null black player)', () => {
    upsertTournament(makeTournamentInfo(), 'T001');
    const p1 = upsertPlayer('Lone Player', 'POR');

    upsertResult('T001', 1, 5, p1, null, '1 - 0');

    const results = getResults('T001', 1) as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0].black_player_id).toBeNull();
    expect(results[0].black_name).toBeNull();
  });

  it('should store team names for team tournaments', () => {
    upsertTournament(makeTournamentInfo({ type: TournamentType.TeamSwiss }), 'T001');
    const p1 = upsertPlayer('Board 1 White', '');
    const p2 = upsertPlayer('Board 1 Black', '');

    upsertResult('T001', 1, 1, p1, p2, '1 - 0', 'Team Alpha', 'Team Beta');

    const results = getResults('T001', 1) as Array<Record<string, unknown>>;
    expect(results[0].white_team).toBe('Team Alpha');
    expect(results[0].black_team).toBe('Team Beta');
  });

  it('should order results by table number', () => {
    upsertTournament(makeTournamentInfo(), 'T001');
    const p1 = upsertPlayer('A', '');
    const p2 = upsertPlayer('B', '');
    const p3 = upsertPlayer('C', '');
    const p4 = upsertPlayer('D', '');

    upsertResult('T001', 1, 3, p3, p4, '0 - 1');
    upsertResult('T001', 1, 1, p1, p2, '1 - 0');

    const results = getResults('T001', 1) as Array<Record<string, unknown>>;
    expect(results[0].table_number).toBe(1);
    expect(results[1].table_number).toBe(3);
  });

  it('should retrieve player result rows for a player', () => {
    upsertTournament(makeTournamentInfo(), 'T001');
    const p1 = upsertPlayer('Target Player', 'POR');
    const p2 = upsertPlayer('Opponent 1', '');
    const p3 = upsertPlayer('Opponent 2', '');

    upsertResult('T001', 1, 1, p1, p2, '1 - 0');
    upsertResult('T001', 2, 1, p3, p1, '0 - 1');

    const rows = getPlayerResultRows(p1);
    expect(rows).toHaveLength(2);
    // Player appears as white or black
    const asWhite = rows.filter(r => r.white_player_id === p1);
    const asBlack = rows.filter(r => r.black_player_id === p1);
    expect(asWhite).toHaveLength(1);
    expect(asBlack).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Standings
// ═══════════════════════════════════════════════════════════════════════════════

describe('Database - Standings', () => {
  beforeEach(clearAllTables);

  it('should insert and retrieve standings', () => {
    upsertTournament(makeTournamentInfo(), 'T001');
    const p1 = upsertPlayer('First Place', 'POR', 'M', '', 2000);
    const p2 = upsertPlayer('Second Place', 'ESP', 'F', '', 1800);

    linkPlayerToTournament('T001', p1, 1, 2000, 'Club A');
    linkPlayerToTournament('T001', p2, 2, 1800, 'Club B');

    upsertStanding('T001', p1, 'open', 1, '8.5', '45.0', '50.0', '38.25');
    upsertStanding('T001', p2, 'open', 2, '7.0', '42.0', '47.0', '32.00');

    const standings = getStandings('T001') as Array<Record<string, unknown>>;
    expect(standings).toHaveLength(2);

    // First place
    expect(standings[0].rank).toBe(1);
    expect(standings[0].name).toBe('First Place');
    expect(standings[0].fed).toBe('POR');
    expect(standings[0].sex).toBe('M');
    expect(standings[0].rating).toBe(2000);
    expect(standings[0].club).toBe('Club A');
    expect(standings[0].points).toBe('8.5');
    expect(standings[0].tie_break_1).toBe('45.0');
    expect(standings[0].tie_break_2).toBe('50.0');
    expect(standings[0].tie_break_3).toBe('38.25');

    // Second place
    expect(standings[1].rank).toBe(2);
    expect(standings[1].name).toBe('Second Place');
  });

  it('should store all six tie-break columns', () => {
    upsertTournament(makeTournamentInfo(), 'T001');
    const p1 = upsertPlayer('Player', 'POR');
    linkPlayerToTournament('T001', p1, 1);

    upsertStanding('T001', p1, 'open', 1, '7.5', 'TB1', 'TB2', 'TB3', 'TB4', 'TB5', 'TB6');

    const standings = getStandings('T001') as Array<Record<string, unknown>>;
    expect(standings[0].tie_break_1).toBe('TB1');
    expect(standings[0].tie_break_2).toBe('TB2');
    expect(standings[0].tie_break_3).toBe('TB3');
    expect(standings[0].tie_break_4).toBe('TB4');
    expect(standings[0].tie_break_5).toBe('TB5');
    expect(standings[0].tie_break_6).toBe('TB6');
  });

  it('should update standing on conflict', () => {
    upsertTournament(makeTournamentInfo(), 'T001');
    const p1 = upsertPlayer('Player', 'POR');
    linkPlayerToTournament('T001', p1, 1);

    upsertStanding('T001', p1, 'open', 5, '3.0');
    upsertStanding('T001', p1, 'open', 1, '8.5', '45.0');

    const standings = getStandings('T001') as Array<Record<string, unknown>>;
    expect(standings).toHaveLength(1);
    expect(standings[0].rank).toBe(1);
    expect(standings[0].points).toBe('8.5');
  });

  it('should order standings by rank', () => {
    upsertTournament(makeTournamentInfo(), 'T001');
    const p1 = upsertPlayer('Third', '');
    const p2 = upsertPlayer('First', '');
    const p3 = upsertPlayer('Second', '');
    linkPlayerToTournament('T001', p1, 3);
    linkPlayerToTournament('T001', p2, 1);
    linkPlayerToTournament('T001', p3, 2);

    upsertStanding('T001', p1, 'open', 3, '5.0');
    upsertStanding('T001', p2, 'open', 1, '8.0');
    upsertStanding('T001', p3, 'open', 2, '7.0');

    const standings = getStandings('T001') as Array<Record<string, unknown>>;
    expect(standings[0].rank).toBe(1);
    expect(standings[0].name).toBe('First');
    expect(standings[1].rank).toBe(2);
    expect(standings[2].rank).toBe(3);
  });

  it('should use tournament_players rating over player base rating', () => {
    upsertTournament(makeTournamentInfo(), 'T001');
    const p1 = upsertPlayer('Player', 'POR', '', '', 1500);
    linkPlayerToTournament('T001', p1, 1, 1600); // tournament-specific rating
    upsertStanding('T001', p1, 'open', 1, '7.0');

    const standings = getStandings('T001') as Array<Record<string, unknown>>;
    expect(standings[0].rating).toBe(1600); // not 1500
  });

  it('should use tournament_players club over player base club', () => {
    upsertTournament(makeTournamentInfo(), 'T001');
    const p1 = upsertPlayer('Player', 'POR', '', 'Base Club', null);
    linkPlayerToTournament('T001', p1, 1, null, 'Tournament Club');
    upsertStanding('T001', p1, 'open', 1, '7.0');

    const standings = getStandings('T001') as Array<Record<string, unknown>>;
    expect(standings[0].club).toBe('Tournament Club');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// persistStandings (batch operation)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Database - persistStandings', () => {
  beforeEach(clearAllTables);

  function makeStanding(overrides: Partial<Standing> = {}): Standing {
    return {
      rank: 1,
      startingNumber: 1,
      name: 'Test Player',
      fed: 'POR',
      rating: '1800',
      club: 'Test Club',
      points: '7.5',
      sex: 'M',
      tieBreak1: '45.0',
      tieBreak2: '50.0',
      tieBreak3: '38.25',
      tieBreak4: '',
      tieBreak5: '',
      tieBreak6: '',
      ...overrides,
    };
  }

  it('should persist a full set of standings correctly', () => {
    const info = makeTournamentInfo({
      linkedTournaments: [{ id: '200', name: 'Group B' }],
      currentLabel: 'Group A',
    });

    const standings: Standing[] = [
      makeStanding({ rank: 1, name: 'First, Player', fed: 'POR', rating: '2100', points: '8.0', startingNumber: 3 }),
      makeStanding({ rank: 2, name: 'Second, Player', fed: 'ESP', rating: '2000', points: '7.5', sex: 'F', startingNumber: 1 }),
      makeStanding({ rank: 3, name: 'Third, Player', fed: 'GER', rating: '1900', points: '6.0', startingNumber: 2 }),
    ];

    persistStandings('T001', info, standings);

    // Verify tournament
    const tournament = getTournament('T001');
    expect(tournament).toBeDefined();
    expect(tournament!.name).toBe('Test Tournament 2026');
    expect(tournament!.event_label).toBe('Group A');
    const linked = JSON.parse(tournament!.linked_tournaments);
    expect(linked).toHaveLength(1);
    expect(linked[0].id).toBe('200');

    // Verify standings
    const dbStandings = getStandings('T001') as Array<Record<string, unknown>>;
    expect(dbStandings).toHaveLength(3);

    expect(dbStandings[0].name).toBe('First, Player');
    expect(dbStandings[0].rank).toBe(1);
    expect(dbStandings[0].fed).toBe('POR');
    expect(dbStandings[0].rating).toBe(2100);
    expect(dbStandings[0].points).toBe('8.0');
    expect(dbStandings[0].starting_number).toBe(3);

    expect(dbStandings[1].name).toBe('Second, Player');
    expect(dbStandings[1].sex).toBe('F');

    // Verify players were created
    const p1 = findPlayerByIdentity('First, Player', 'POR');
    expect(p1).toBeDefined();
    expect(p1!.rating).toBe(2100);
  });

  it('should update standings on re-persist (idempotent)', () => {
    const info = makeTournamentInfo();
    const standings = [
      makeStanding({ rank: 1, name: 'Player A', points: '5.0' }),
    ];

    persistStandings('T001', info, standings);
    persistStandings('T001', info, [
      makeStanding({ rank: 1, name: 'Player A', points: '8.0' }),
    ]);

    const dbStandings = getStandings('T001') as Array<Record<string, unknown>>;
    expect(dbStandings).toHaveLength(1);
    expect(dbStandings[0].points).toBe('8.0');
  });

  it('should preserve sex field through persistence', () => {
    const info = makeTournamentInfo();
    const standings = [
      makeStanding({ rank: 1, name: 'Female Player', sex: 'F', fed: 'POR' }),
      makeStanding({ rank: 2, name: 'Male Player', sex: 'M', fed: 'POR' }),
      makeStanding({ rank: 3, name: 'Unknown Sex', sex: '', fed: 'POR' }),
    ];

    persistStandings('T001', info, standings);

    const p1 = findPlayerByIdentity('Female Player', 'POR');
    expect(p1!.sex).toBe('F');

    const p2 = findPlayerByIdentity('Male Player', 'POR');
    expect(p2!.sex).toBe('M');
  });

  it('should handle standings with rating as zero-string', () => {
    const info = makeTournamentInfo();
    const standings = [
      makeStanding({ rank: 1, name: 'Unrated', rating: '0', fed: 'POR' }),
    ];

    persistStandings('T001', info, standings);
    const dbStandings = getStandings('T001') as Array<Record<string, unknown>>;
    expect(dbStandings[0].rating).toBe(0); // COALESCE fallback
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// persistPairings (batch operation)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Database - persistPairings', () => {
  beforeEach(clearAllTables);

  it('should persist pairings correctly', () => {
    const info = makeTournamentInfo();
    const pairings: Pairing[] = [
      {
        table: 1,
        white: { name: 'White Player', number: 1 },
        black: { name: 'Black Player', number: 2 },
        result: '1 - 0',
      },
      {
        table: 2,
        white: { name: 'Player C', number: 3 },
        black: { name: 'Player D', number: 4 },
        result: '½ - ½',
      },
    ];

    persistPairings('T001', info, 1, pairings);

    // Verify tournament was created
    expect(getTournament('T001')).toBeDefined();

    // Verify results
    const results = getResults('T001', 1) as Array<Record<string, unknown>>;
    expect(results).toHaveLength(2);
    expect(results[0].white_name).toBe('White Player');
    expect(results[0].black_name).toBe('Black Player');
    expect(results[0].result).toBe('1 - 0');
    expect(results[1].result).toBe('½ - ½');
  });

  it('should handle BYE pairings', () => {
    const info = makeTournamentInfo();
    const pairings: Pairing[] = [
      {
        table: 1,
        white: { name: 'Lone Player', number: 1 },
        black: null,
        unpairedLabel: 'BYE',
        result: '1 - 0',
      },
    ];

    persistPairings('T001', info, 1, pairings);

    const results = getResults('T001', 1) as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0].white_name).toBe('Lone Player');
    expect(results[0].black_player_id).toBeNull();
  });

  it('should persist multiple rounds independently', () => {
    const info = makeTournamentInfo();
    const r1: Pairing[] = [{ table: 1, white: { name: 'A', number: 1 }, black: { name: 'B', number: 2 }, result: '1 - 0' }];
    const r2: Pairing[] = [{ table: 1, white: { name: 'B', number: 2 }, black: { name: 'A', number: 1 }, result: '0 - 1' }];

    persistPairings('T001', info, 1, r1);
    persistPairings('T001', info, 2, r2);

    expect(getResults('T001', 1)).toHaveLength(1);
    expect(getResults('T001', 2)).toHaveLength(1);
  });

  it('should not create duplicate players when persisting pairings then standings', () => {
    const info = makeTournamentInfo();

    // First: pairings (no federation info)
    const pairings: Pairing[] = [
      { table: 1, white: { name: 'Silva, Bruno', number: 1 }, black: { name: 'Santos, Maria', number: 2 }, result: '1 - 0' },
    ];
    persistPairings('T001', info, 1, pairings);

    // Then: standings (with federation)
    const standings: Standing[] = [
      { rank: 1, startingNumber: 1, name: 'Silva, Bruno', fed: 'POR', rating: '1800', club: '', points: '7.0', sex: 'M', tieBreak1: '', tieBreak2: '', tieBreak3: '', tieBreak4: '', tieBreak5: '', tieBreak6: '' },
      { rank: 2, startingNumber: 2, name: 'Santos, Maria', fed: 'POR', rating: '1600', club: '', points: '6.0', sex: 'F', tieBreak1: '', tieBreak2: '', tieBreak3: '', tieBreak4: '', tieBreak5: '', tieBreak6: '' },
    ];
    persistStandings('T001', info, standings);

    // Verify: should have exactly 2 players in the DB
    const allPlayers = db.prepare('SELECT * FROM players').all() as Array<Record<string, unknown>>;
    expect(allPlayers).toHaveLength(2);

    // Both should have federation set
    for (const p of allPlayers) {
      expect(p.federation).toBe('POR');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Player Tournament History
// ═══════════════════════════════════════════════════════════════════════════════

describe('Database - Player Tournament History', () => {
  beforeEach(clearAllTables);

  it('should return full history with standings data', () => {
    upsertTournament(makeTournamentInfo({ name: 'Tournament Alpha' }), 'T001');
    upsertTournament(makeTournamentInfo({ name: 'Tournament Beta', date: '2026/04/01' }), 'T002');

    const playerId = upsertPlayer('Tournament Veteran', 'POR');

    linkPlayerToTournament('T001', playerId, 1, 1800, 'Club A');
    linkPlayerToTournament('T002', playerId, 5, 1850, 'Club B');

    upsertStanding('T001', playerId, 'open', 3, '6.0', '40.0', '45.0', '30.0');
    upsertStanding('T002', playerId, 'open', 1, '8.5', '50.0', '55.0', '42.0');

    const history = getPlayerTournamentHistory(playerId);
    expect(history).toHaveLength(2);

    // History includes tournament metadata
    const t1 = history.find(h => h.tournament_id === 'T001');
    expect(t1).toBeDefined();
    expect(t1!.tournament_name).toBe('Tournament Alpha');
    expect(t1!.rank).toBe(3);
    expect(t1!.points).toBe('6.0');
    expect(t1!.starting_number).toBe(1);
    expect(t1!.tournament_rating).toBe(1800);

    const t2 = history.find(h => h.tournament_id === 'T002');
    expect(t2).toBeDefined();
    expect(t2!.rank).toBe(1);
    expect(t2!.points).toBe('8.5');
  });

  it('should return history entry even without standings', () => {
    upsertTournament(makeTournamentInfo(), 'T001');
    const playerId = upsertPlayer('Pairing Only Player', 'POR');
    linkPlayerToTournament('T001', playerId, 1);
    // No standing inserted

    const history = getPlayerTournamentHistory(playerId);
    expect(history).toHaveLength(1);
    expect(history[0].rank).toBeNull();
    expect(history[0].points).toBeNull();
  });

  it('should include tie-breaks 4-6 in history', () => {
    upsertTournament(makeTournamentInfo(), 'T001');
    const playerId = upsertPlayer('TB Player', 'POR');
    linkPlayerToTournament('T001', playerId, 1);
    upsertStanding('T001', playerId, 'open', 1, '7.0', 'A', 'B', 'C', 'D', 'E', 'F');

    const history = getPlayerTournamentHistory(playerId);
    expect(history[0].tie_break_4).toBe('D');
    expect(history[0].tie_break_5).toBe('E');
    expect(history[0].tie_break_6).toBe('F');
  });

  it('should include event_label in history', () => {
    upsertTournament(makeTournamentInfo({ currentLabel: 'Open A' }), 'T001');
    const playerId = upsertPlayer('Label Player', 'POR');
    linkPlayerToTournament('T001', playerId, 1);

    const history = getPlayerTournamentHistory(playerId);
    expect(history[0].event_label).toBe('Open A');
  });
});

// persistPlayerCard
// ═══════════════════════════════════════════════════════════════════════════════

describe('Database - persistPlayerCard', () => {
  beforeEach(clearAllTables);

  it('should persist player card extended data', () => {
    upsertTournament(makeTournamentInfo(), 'T001');

    persistPlayerCard('T001', {
      name: 'Silva, Daniel',
      federation: 'POR',
      fideId: '1982532',
      club: 'Paredes Golfe Clube',
      birthYear: 2008,
      nationalId: '47919',
      rating: 1675,
      nationalRating: 1500,
      performanceRating: 1470,
      ratingChange: '-8,4',
      startingNumber: 1,
      rank: 2,
      points: '4.5',
    });

    const player = findPlayerByIdentity('Silva, Daniel', 'POR');
    expect(player).toBeDefined();
    expect(player!.fide_id).toBe('1982532');
    expect(player!.birth_year).toBe(2008);
    expect(player!.national_id).toBe('47919');
    expect(player!.rating).toBe(1675);

    const history = getPlayerTournamentHistory(player!.id!);
    expect(history).toHaveLength(1);
    expect(history[0].national_rating).toBe(1500);
    expect(history[0].performance_rating).toBe(1470);
    expect(history[0].rating_change).toBe('-8,4');
  });

  it('should preserve existing player data when card has empty values', () => {
    upsertTournament(makeTournamentInfo(), 'T001');
    const playerId = upsertPlayer('Existing Player', 'POR', 'M', 'Some Club', 1800, '9999999', 1990, '11111');

    // Persist a card with sparse data — should not overwrite existing birth_year/national_id
    persistPlayerCard('T001', {
      name: 'Existing Player',
      federation: 'POR',
      fideId: '9999999',
      club: '',
      birthYear: null,
      nationalId: '',
      rating: null,
      nationalRating: 1700,
      performanceRating: 1850,
      ratingChange: '+5,2',
      startingNumber: 3,
      rank: 1,
      points: '7',
    });

    const player = getPlayerById(playerId);
    expect(player!.birth_year).toBe(1990);
    expect(player!.national_id).toBe('11111');
    expect(player!.club).toBe('Some Club');
    expect(player!.rating).toBe(1800);
  });
});
