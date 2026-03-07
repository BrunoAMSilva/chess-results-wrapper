import { describe, it, expect, beforeEach } from 'vitest';
import db, {
  getTournament,
  getStandings,
  getResults,
  persistStandings,
  persistPairings,
  getPlayerTournamentHistory,
  findPlayerByIdentity,
} from '../../src/lib/db';
import { parseHtml, parseStandingsHtml } from '../../src/lib/scraper';
import fs from 'fs';
import path from 'path';

const fixturesDir = path.join(__dirname, '../../tests/fixtures');

function loadFixture(filename: string): string {
  return fs.readFileSync(path.join(fixturesDir, filename), 'utf-8');
}

function clearAllTables(): void {
  db.exec('DELETE FROM results');
  db.exec('DELETE FROM standings');
  db.exec('DELETE FROM tournament_players');
  db.exec('DELETE FROM players');
  db.exec('DELETE FROM tournaments');
  db.exec('DELETE FROM cache');
}

// ═══════════════════════════════════════════════════════════════════════════════
// End-to-end: Parse HTML → Persist → Retrieve and verify
// These tests catch regressions where parsing works but persistence breaks,
// or vice versa.
// ═══════════════════════════════════════════════════════════════════════════════

describe('End-to-end: Standings parse → persist → retrieve', () => {
  const TOURNAMENT_ID = 'E2E_S001';

  beforeEach(clearAllTables);

  it('should parse, persist, and retrieve English standings correctly', () => {
    const html = loadFixture('ended_standings.html');
    const parsed = parseStandingsHtml(html);

    expect(parsed.standings.length).toBeGreaterThan(0);

    // Persist
    persistStandings(TOURNAMENT_ID, parsed.info, parsed.standings);

    // Retrieve and verify
    const tournament = getTournament(TOURNAMENT_ID);
    expect(tournament).toBeDefined();
    expect(tournament!.name).toBe(parsed.info.name);
    expect(tournament!.type).toBe(parsed.info.type);

    const dbStandings = getStandings(TOURNAMENT_ID) as Array<Record<string, unknown>>;
    expect(dbStandings.length).toBe(parsed.standings.length);

    // Verify field-by-field for first few entries
    for (let i = 0; i < Math.min(5, parsed.standings.length); i++) {
      const original = parsed.standings[i];
      const stored = dbStandings[i];

      expect(stored.rank).toBe(original.rank);
      expect(stored.name).toBe(original.name);
      expect(stored.fed).toBe(original.fed);
      expect(stored.points).toBe(original.points);
      expect(stored.tie_break_1).toBe(original.tieBreak1);
      expect(stored.tie_break_2).toBe(original.tieBreak2);
      expect(stored.tie_break_3).toBe(original.tieBreak3);

      // Sex should be preserved
      expect(stored.sex).toBe(original.sex);

      // Rating should be parsed number
      if (original.rating) {
        const expectedRating = parseInt(original.rating) || 0;
        expect(stored.rating).toBe(expectedRating);
      }
    }
  });

  it('should parse, persist, and retrieve Portuguese standings correctly', () => {
    const html = loadFixture('portuguese_standings.html');
    const parsed = parseStandingsHtml(html);

    expect(parsed.standings.length).toBeGreaterThan(0);

    persistStandings(TOURNAMENT_ID, parsed.info, parsed.standings);

    const dbStandings = getStandings(TOURNAMENT_ID) as Array<Record<string, unknown>>;
    expect(dbStandings.length).toBe(parsed.standings.length);

    // Verify tie-break columns are populated (this was the "Desp" regression)
    const first = dbStandings[0];
    expect(first.points).toBe(parsed.standings[0].points);
    expect(first.tie_break_1).toBe(parsed.standings[0].tieBreak1);
  });

  it('should produce queryable player history after persistence', () => {
    const html = loadFixture('ended_standings.html');
    const parsed = parseStandingsHtml(html);

    persistStandings(TOURNAMENT_ID, parsed.info, parsed.standings);

    // Pick the first player and verify their history
    const firstPlayerName = parsed.standings[0].name;
    const firstPlayerFed = parsed.standings[0].fed;

    const player = findPlayerByIdentity(firstPlayerName, firstPlayerFed);
    expect(player).toBeDefined();

    const history = getPlayerTournamentHistory(player!.id!);
    expect(history).toHaveLength(1);
    expect(history[0].tournament_id).toBe(TOURNAMENT_ID);
    expect(history[0].rank).toBe(parsed.standings[0].rank);
    expect(history[0].points).toBe(parsed.standings[0].points);
  });
});

describe('End-to-end: Pairings parse → persist → retrieve', () => {
  const TOURNAMENT_ID = 'E2E_P001';

  beforeEach(clearAllTables);

  it('should parse, persist, and retrieve pairings correctly', () => {
    const html = loadFixture('ended_pairings.html');
    const parsed = parseHtml(html, 9);

    expect(parsed.pairings.length).toBeGreaterThan(0);

    // Persist
    persistPairings(TOURNAMENT_ID, parsed.info, 9, parsed.pairings);

    // Retrieve
    const tournament = getTournament(TOURNAMENT_ID);
    expect(tournament).toBeDefined();

    const dbResults = getResults(TOURNAMENT_ID, 9) as Array<Record<string, unknown>>;
    expect(dbResults.length).toBe(parsed.pairings.length);

    // Verify first few results match parsed data
    for (let i = 0; i < Math.min(5, parsed.pairings.length); i++) {
      const original = parsed.pairings[i];
      const stored = dbResults[i];

      expect(stored.table_number).toBe(original.table);
      expect(stored.result).toBe(original.result);

      if (original.white.name) {
        expect(stored.white_name).toBe(original.white.name);
      }

      if (original.black?.name) {
        expect(stored.black_name).toBe(original.black.name);
      } else {
        expect(stored.black_player_id).toBeNull();
      }
    }
  });
});

describe('End-to-end: Pairings + Standings consistency', () => {
  const TOURNAMENT_ID = 'E2E_COMBO';

  beforeEach(clearAllTables);

  it('should merge player data from pairings and standings without duplicates', () => {
    // Simulate real flow: pairings come first (no federation), then standings (with federation)
    const pairingsHtml = loadFixture('ended_pairings.html');
    const standingsHtml = loadFixture('ended_standings.html');

    const parsedPairings = parseHtml(pairingsHtml, 9);
    const parsedStandings = parseStandingsHtml(standingsHtml);

    // Persist pairings first (creates placeholder players)
    persistPairings(TOURNAMENT_ID, parsedPairings.info, 9, parsedPairings.pairings);

    // Then persist standings (should adopt placeholder players)
    persistStandings(TOURNAMENT_ID, parsedStandings.info, parsedStandings.standings);

    // Count total unique player names from both sources
    const pairingNames = new Set<string>();
    for (const p of parsedPairings.pairings) {
      if (p.white.name) pairingNames.add(p.white.name);
      if (p.black?.name) pairingNames.add(p.black.name);
    }
    const standingNames = new Set(parsedStandings.standings.map(s => s.name));

    // Players that appear in both should NOT be duplicated
    const overlap = [...pairingNames].filter(n => standingNames.has(n));

    for (const name of overlap) {
      const rows = db.prepare('SELECT * FROM players WHERE name = ?').all(name) as Array<Record<string, unknown>>;
      // There should be at most 1 row per player (if they have same federation)
      // or 2 rows if genuinely different (different federation)
      const uniqueFeds = new Set(rows.map(r => r.federation));
      expect(rows.length).toBeLessThanOrEqual(uniqueFeds.size);
    }
  });
});

describe('End-to-end: Linked tournaments persistence', () => {
  const TOURNAMENT_ID = 'E2E_LINK';

  beforeEach(clearAllTables);

  it('should persist and retrieve linked tournaments from parsed HTML', () => {
    const html = loadFixture('future_participants.html');
    const parsed = parseStandingsHtml(html);

    // Fixture must have linked tournaments — fail explicitly if it doesn't
    expect(parsed.info.linkedTournaments).toBeDefined();
    expect(parsed.info.linkedTournaments!.length).toBeGreaterThan(0);

    persistStandings(TOURNAMENT_ID, parsed.info, parsed.standings);

    const tournament = getTournament(TOURNAMENT_ID);
    expect(tournament).toBeDefined();

    const linked = JSON.parse(tournament!.linked_tournaments);
    expect(linked.length).toBe(parsed.info.linkedTournaments!.length);

    // Verify each linked tournament has id and name
    for (const lt of linked) {
      expect(lt.id).toBeTruthy();
      expect(lt.name).toBeTruthy();
    }

    // Verify currentLabel is stored
    expect(parsed.info.currentLabel).toBeDefined();
    expect(tournament!.event_label).toBe(parsed.info.currentLabel);
  });

  it('should not overwrite linked tournaments when re-persisting without them', () => {
    const html = loadFixture('future_participants.html');
    const parsed = parseStandingsHtml(html);

    // Fixture must have linked tournaments — fail explicitly if it doesn't
    expect(parsed.info.linkedTournaments).toBeDefined();
    expect(parsed.info.linkedTournaments!.length).toBeGreaterThan(0);

    // First persist with linked tournaments
    persistStandings(TOURNAMENT_ID, parsed.info, parsed.standings);

    const firstLinked = JSON.parse(getTournament(TOURNAMENT_ID)!.linked_tournaments);
    expect(firstLinked.length).toBeGreaterThan(0);

    // Re-persist without linked tournaments (simulates pairings-only update)
    const infoWithoutLinks = { ...parsed.info, linkedTournaments: undefined, currentLabel: undefined };
    persistStandings(TOURNAMENT_ID, infoWithoutLinks, parsed.standings);

    // Linked tournaments should be preserved
    const secondLinked = JSON.parse(getTournament(TOURNAMENT_ID)!.linked_tournaments);
    expect(secondLinked.length).toBe(firstLinked.length);
  });
});
