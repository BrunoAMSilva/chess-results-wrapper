import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'chess-results.db');

// Ensure the directory exists
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

let db: Database.Database;
try {
  db = new Database(dbPath);
} catch (_) {
  // Fall back to in-memory database if file DB fails
  db = new Database(':memory:');
}

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- HTTP cache (existing functionality)
  CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  -- Tournaments
  CREATE TABLE IF NOT EXISTS tournaments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'swiss',
    total_rounds INTEGER NOT NULL DEFAULT 0,
    date TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Players (deduplicated by name + federation)
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    fide_id TEXT,
    federation TEXT NOT NULL DEFAULT '',
    sex TEXT NOT NULL DEFAULT '',
    club TEXT NOT NULL DEFAULT '',
    rating INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(name, federation)
  );

  -- Link players to tournaments
  CREATE TABLE IF NOT EXISTS tournament_players (
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    starting_number INTEGER NOT NULL DEFAULT 0,
    rating INTEGER,
    club TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (tournament_id, player_id)
  );

  -- Round results / pairings
  CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    round INTEGER NOT NULL,
    table_number INTEGER NOT NULL,
    white_player_id INTEGER REFERENCES players(id),
    black_player_id INTEGER REFERENCES players(id),
    white_team TEXT,
    black_team TEXT,
    result TEXT NOT NULL DEFAULT '',
    UNIQUE(tournament_id, round, table_number)
  );

  -- Final standings
  CREATE TABLE IF NOT EXISTS standings (
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    rank INTEGER NOT NULL,
    points TEXT NOT NULL DEFAULT '',
    tie_break_1 TEXT NOT NULL DEFAULT '',
    tie_break_2 TEXT NOT NULL DEFAULT '',
    tie_break_3 TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (tournament_id, player_id)
  );

  -- Indexes for common queries
  CREATE INDEX IF NOT EXISTS idx_results_tournament_round ON results(tournament_id, round);
  CREATE INDEX IF NOT EXISTS idx_standings_tournament ON standings(tournament_id);
  CREATE INDEX IF NOT EXISTS idx_players_name ON players(name);
  CREATE INDEX IF NOT EXISTS idx_players_fide ON players(fide_id) WHERE fide_id IS NOT NULL;
`);

export default db;

// ─── Repository helpers ───────────────────────────────────────────────────────

import type {
  DbTournament,
  DbPlayer,
  Sex,
  Standing,
  TournamentInfo,
  TournamentType,
  Pairing,
} from './types';

// ── Tournaments ──

export function upsertTournament(info: TournamentInfo, tournamentId: string): void {
  db.prepare(`
    INSERT INTO tournaments (id, name, type, total_rounds, date, location, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      total_rounds = excluded.total_rounds,
      date = excluded.date,
      location = excluded.location,
      updated_at = datetime('now')
  `).run(tournamentId, info.name, info.type, info.totalRounds, info.date, info.location);
}

export function getTournament(tournamentId: string): DbTournament | undefined {
  return db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId) as DbTournament | undefined;
}

// ── Players ──

export function upsertPlayer(
  name: string,
  federation: string,
  sex: Sex = '',
  club = '',
  rating: number | null = null,
  fideId: string | null = null,
): number {
  const existing = db.prepare(
    'SELECT id FROM players WHERE name = ? AND federation = ?',
  ).get(name, federation) as { id: number } | undefined;

  if (existing) {
    // Update fields that may have changed
    db.prepare(`
      UPDATE players SET
        sex = CASE WHEN ? != '' THEN ? ELSE sex END,
        club = CASE WHEN ? != '' THEN ? ELSE club END,
        rating = CASE WHEN ? IS NOT NULL THEN ? ELSE rating END,
        fide_id = CASE WHEN ? IS NOT NULL THEN ? ELSE fide_id END,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(sex, sex, club, club, rating, rating, fideId, fideId, existing.id);
    return existing.id;
  }

  const result = db.prepare(`
    INSERT INTO players (name, federation, sex, club, rating, fide_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, federation, sex, club, rating, fideId);

  return Number(result.lastInsertRowid);
}

export function linkPlayerToTournament(
  tournamentId: string,
  playerId: number,
  startingNumber: number,
  rating: number | null = null,
  club = '',
): void {
  db.prepare(`
    INSERT INTO tournament_players (tournament_id, player_id, starting_number, rating, club)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(tournament_id, player_id) DO UPDATE SET
      starting_number = excluded.starting_number,
      rating = COALESCE(excluded.rating, tournament_players.rating),
      club = CASE WHEN excluded.club != '' THEN excluded.club ELSE tournament_players.club END
  `).run(tournamentId, playerId, startingNumber, rating, club);
}

// ── Results ──

export function upsertResult(
  tournamentId: string,
  round: number,
  tableNumber: number,
  whitePlayerId: number | null,
  blackPlayerId: number | null,
  result: string,
  whiteTeam: string | null = null,
  blackTeam: string | null = null,
): void {
  db.prepare(`
    INSERT INTO results (tournament_id, round, table_number, white_player_id, black_player_id, result, white_team, black_team)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tournament_id, round, table_number) DO UPDATE SET
      white_player_id = excluded.white_player_id,
      black_player_id = excluded.black_player_id,
      result = excluded.result,
      white_team = excluded.white_team,
      black_team = excluded.black_team
  `).run(tournamentId, round, tableNumber, whitePlayerId, blackPlayerId, result, whiteTeam, blackTeam);
}

export function getResults(tournamentId: string, round: number) {
  return db.prepare(`
    SELECT r.*, pw.name AS white_name, pb.name AS black_name
    FROM results r
    LEFT JOIN players pw ON r.white_player_id = pw.id
    LEFT JOIN players pb ON r.black_player_id = pb.id
    WHERE r.tournament_id = ? AND r.round = ?
    ORDER BY r.table_number
  `).all(tournamentId, round);
}

// ── Standings ──

export function upsertStanding(
  tournamentId: string,
  playerId: number,
  rank: number,
  points: string,
  tb1 = '',
  tb2 = '',
  tb3 = '',
): void {
  db.prepare(`
    INSERT INTO standings (tournament_id, player_id, rank, points, tie_break_1, tie_break_2, tie_break_3)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tournament_id, player_id) DO UPDATE SET
      rank = excluded.rank,
      points = excluded.points,
      tie_break_1 = excluded.tie_break_1,
      tie_break_2 = excluded.tie_break_2,
      tie_break_3 = excluded.tie_break_3
  `).run(tournamentId, playerId, rank, points, tb1, tb2, tb3);
}

export function getStandings(tournamentId: string) {
  return db.prepare(`
    SELECT s.rank, p.name, p.federation AS fed, p.sex,
           COALESCE(tp.rating, p.rating, 0) AS rating,
           COALESCE(tp.club, p.club, '') AS club,
           s.points, s.tie_break_1, s.tie_break_2, s.tie_break_3,
           tp.starting_number
    FROM standings s
    JOIN players p ON s.player_id = p.id
    LEFT JOIN tournament_players tp ON tp.tournament_id = s.tournament_id AND tp.player_id = p.id
    WHERE s.tournament_id = ?
    ORDER BY s.rank
  `).all(tournamentId);
}

/** Persist an entire batch of standings + players in a single transaction. */
export function persistStandings(
  tournamentId: string,
  info: TournamentInfo,
  standings: Standing[],
): void {
  const txn = db.transaction(() => {
    upsertTournament(info, tournamentId);

    for (const s of standings) {
      const playerId = upsertPlayer(
        s.name,
        s.fed,
        s.sex,
        s.club,
        s.rating ? parseInt(s.rating) || null : null,
      );
      linkPlayerToTournament(
        tournamentId,
        playerId,
        s.startingNumber,
        s.rating ? parseInt(s.rating) || null : null,
        s.club,
      );
      upsertStanding(tournamentId, playerId, s.rank, s.points, s.tieBreak1, s.tieBreak2, s.tieBreak3);
    }
  });
  txn();
}

/** Persist an entire batch of pairings + players in a single transaction. */
export function persistPairings(
  tournamentId: string,
  info: TournamentInfo,
  round: number,
  pairings: Pairing[],
): void {
  const txn = db.transaction(() => {
    upsertTournament(info, tournamentId);

    for (const p of pairings) {
      const whiteId = p.white.name
        ? upsertPlayer(p.white.name, '')
        : null;
      const blackId = p.black?.name
        ? upsertPlayer(p.black.name, '')
        : null;

      if (whiteId) linkPlayerToTournament(tournamentId, whiteId, p.white.number);
      if (blackId && p.black) linkPlayerToTournament(tournamentId, blackId, p.black.number);

      upsertResult(tournamentId, round, p.table, whiteId, blackId, p.result);
    }
  });
  txn();
}

// ── Search ──

export function searchTournaments(query: string, limit = 10): DbTournament[] {
  return db.prepare(`
    SELECT * FROM tournaments
    WHERE name LIKE '%' || ? || '%'
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(query, limit) as DbTournament[];
}
