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
    event_label TEXT NOT NULL DEFAULT '',
    linked_tournaments TEXT NOT NULL DEFAULT '[]',
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
    tie_break_4 TEXT NOT NULL DEFAULT '',
    tie_break_5 TEXT NOT NULL DEFAULT '',
    tie_break_6 TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (tournament_id, player_id)
  );

  -- Indexes for common queries
  CREATE INDEX IF NOT EXISTS idx_results_tournament_round ON results(tournament_id, round);
  CREATE INDEX IF NOT EXISTS idx_standings_tournament ON standings(tournament_id);
  CREATE INDEX IF NOT EXISTS idx_players_name ON players(name);
  CREATE INDEX IF NOT EXISTS idx_players_fide ON players(fide_id) WHERE fide_id IS NOT NULL;
`);

function playerRichnessScore(row: DbPlayer): number {
  let score = 0;
  if (row.federation) score += 8;
  if (row.sex) score += 4;
  if (row.fide_id) score += 6;
  if (row.rating !== null && row.rating !== undefined) score += 3;
  if (row.club) score += 2;
  return score;
}

/**
 * Merge duplicate placeholder player rows into a richer canonical row.
 *
 * Safety rules:
 * - only merge rows with the same exact name
 * - prefer rows with federation/metadata as canonical
 * - avoid merging across clearly different federations
 */
function migrateDeduplicatePlayers(): void {
  const names = db.prepare(`
    SELECT name
    FROM players
    GROUP BY name
    HAVING COUNT(*) > 1
  `).all() as Array<{ name: string }>;

  if (names.length === 0) return;

  const txn = db.transaction(() => {
    for (const { name } of names) {
      const rows = db.prepare(`
        SELECT *
        FROM players
        WHERE name = ?
      `).all(name) as DbPlayer[];

      if (rows.length < 2) continue;

      const withFederation = rows.filter((r) => !!r.federation);
      const uniqueFederations = new Set(withFederation.map((r) => r.federation));

      // If multiple explicit federations exist, skip migration for this name.
      if (uniqueFederations.size > 1) continue;

      const ordered = [...rows].sort((a, b) => {
        const scoreDiff = playerRichnessScore(b) - playerRichnessScore(a);
        if (scoreDiff !== 0) return scoreDiff;
        return (b.updated_at || '').localeCompare(a.updated_at || '');
      });

      const target = ordered[0];
      if (!target.id) continue;

      const sources = ordered.slice(1).filter((r) => !!r.id);
      for (const source of sources) {
        const sourceId = source.id!;
        if (sourceId === target.id) continue;

        // Avoid unique conflicts by removing overlapping source links first.
        db.prepare(`
          DELETE FROM tournament_players
          WHERE player_id = ?
            AND tournament_id IN (
              SELECT tournament_id FROM tournament_players WHERE player_id = ?
            )
        `).run(sourceId, target.id);

        db.prepare(`
          DELETE FROM standings
          WHERE player_id = ?
            AND tournament_id IN (
              SELECT tournament_id FROM standings WHERE player_id = ?
            )
        `).run(sourceId, target.id);

        db.prepare('UPDATE tournament_players SET player_id = ? WHERE player_id = ?').run(target.id, sourceId);
        db.prepare('UPDATE standings SET player_id = ? WHERE player_id = ?').run(target.id, sourceId);
        db.prepare('UPDATE results SET white_player_id = ? WHERE white_player_id = ?').run(target.id, sourceId);
        db.prepare('UPDATE results SET black_player_id = ? WHERE black_player_id = ?').run(target.id, sourceId);

        db.prepare('DELETE FROM players WHERE id = ?').run(sourceId);
      }
    }
  });

  txn();
}

try {
  migrateDeduplicatePlayers();
} catch (_) {
  // Non-critical migration; keep app startup resilient.
}

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
  DbPlayerTournamentHistory,
  DbPlayerResultEntry,
} from './types';

// ── Tournaments ──

export function upsertTournament(info: TournamentInfo, tournamentId: string): void {
  // Migrate: add columns if they don't exist yet (no-op after first run)
  try { db.exec('ALTER TABLE tournaments ADD COLUMN event_label TEXT NOT NULL DEFAULT \'\''); } catch (_) {}
  try { db.exec('ALTER TABLE tournaments ADD COLUMN linked_tournaments TEXT NOT NULL DEFAULT \'[]\''); } catch (_) {}

  const linkedJson = info.linkedTournaments && info.linkedTournaments.length > 0
    ? JSON.stringify(info.linkedTournaments)
    : '[]';
  db.prepare(`
    INSERT INTO tournaments (id, name, type, total_rounds, date, location, event_label, linked_tournaments, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      total_rounds = CASE WHEN excluded.total_rounds > 0 THEN excluded.total_rounds ELSE tournaments.total_rounds END,
      date = CASE WHEN excluded.date != '' THEN excluded.date ELSE tournaments.date END,
      location = CASE WHEN excluded.location != '' THEN excluded.location ELSE tournaments.location END,
      event_label = CASE WHEN excluded.event_label != '' THEN excluded.event_label ELSE tournaments.event_label END,
      linked_tournaments = CASE WHEN excluded.linked_tournaments != '[]' THEN excluded.linked_tournaments ELSE tournaments.linked_tournaments END,
      updated_at = datetime('now')
  `).run(tournamentId, info.name, info.type, info.totalRounds, info.date, info.location, info.currentLabel || '', linkedJson);
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
  const normalizedName = name.trim();
  const normalizedFed = federation.trim();
  const normalizedClub = club.trim();
  const normalizedFideId = fideId?.trim() || null;

  // Strongest identity signal when available.
  if (normalizedFideId) {
    const byFideId = db.prepare(
      'SELECT id FROM players WHERE fide_id = ? LIMIT 1',
    ).get(normalizedFideId) as { id: number } | undefined;
    if (byFideId) {
      db.prepare(`
        UPDATE players SET
          name = CASE WHEN ? != '' THEN ? ELSE name END,
          federation = CASE WHEN ? != '' THEN ? ELSE federation END,
          sex = CASE WHEN ? != '' THEN ? ELSE sex END,
          club = CASE WHEN ? != '' THEN ? ELSE club END,
          rating = CASE WHEN ? IS NOT NULL THEN ? ELSE rating END,
          fide_id = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        normalizedName,
        normalizedName,
        normalizedFed,
        normalizedFed,
        sex,
        sex,
        normalizedClub,
        normalizedClub,
        rating,
        rating,
        normalizedFideId,
        byFideId.id,
      );
      return byFideId.id;
    }
  }

  const existing = db.prepare(
    'SELECT id FROM players WHERE name = ? AND federation = ?',
  ).get(normalizedName, normalizedFed) as { id: number } | undefined;

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
    `).run(
      sex,
      sex,
      normalizedClub,
      normalizedClub,
      rating,
      rating,
      normalizedFideId,
      normalizedFideId,
      existing.id,
    );
    return existing.id;
  }

  // If federation is unknown (pairings pages), reuse an existing unique player by name.
  if (!normalizedFed) {
    const sameName = db.prepare(
      `SELECT id, federation
       FROM players
       WHERE name = ?
       ORDER BY CASE WHEN federation = '' THEN 1 ELSE 0 END, updated_at DESC`,
    ).all(normalizedName) as Array<{ id: number; federation: string }>;

    if (sameName.length === 1) {
      db.prepare(`
        UPDATE players SET
          sex = CASE WHEN ? != '' THEN ? ELSE sex END,
          club = CASE WHEN ? != '' THEN ? ELSE club END,
          rating = CASE WHEN ? IS NOT NULL THEN ? ELSE rating END,
          fide_id = CASE WHEN ? IS NOT NULL THEN ? ELSE fide_id END,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        sex,
        sex,
        normalizedClub,
        normalizedClub,
        rating,
        rating,
        normalizedFideId,
        normalizedFideId,
        sameName[0].id,
      );
      return sameName[0].id;
    }
  } else {
    // If we now know the federation, adopt a previous placeholder entry.
    const placeholder = db.prepare(
      "SELECT id FROM players WHERE name = ? AND federation = '' LIMIT 1",
    ).get(normalizedName) as { id: number } | undefined;

    if (placeholder) {
      db.prepare(`
        UPDATE players SET
          federation = ?,
          sex = CASE WHEN ? != '' THEN ? ELSE sex END,
          club = CASE WHEN ? != '' THEN ? ELSE club END,
          rating = CASE WHEN ? IS NOT NULL THEN ? ELSE rating END,
          fide_id = CASE WHEN ? IS NOT NULL THEN ? ELSE fide_id END,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        normalizedFed,
        sex,
        sex,
        normalizedClub,
        normalizedClub,
        rating,
        rating,
        normalizedFideId,
        normalizedFideId,
        placeholder.id,
      );
      return placeholder.id;
    }
  }

  const result = db.prepare(`
    INSERT INTO players (name, federation, sex, club, rating, fide_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(normalizedName, normalizedFed, sex, normalizedClub, rating, normalizedFideId);

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

// Migrate: add TB4-TB6 columns if they don't exist yet (no-op after first run)
try { db.exec("ALTER TABLE standings ADD COLUMN tie_break_4 TEXT NOT NULL DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE standings ADD COLUMN tie_break_5 TEXT NOT NULL DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE standings ADD COLUMN tie_break_6 TEXT NOT NULL DEFAULT ''"); } catch (_) {}

export function upsertStanding(
  tournamentId: string,
  playerId: number,
  rank: number,
  points: string,
  tb1 = '',
  tb2 = '',
  tb3 = '',
  tb4 = '',
  tb5 = '',
  tb6 = '',
): void {
  db.prepare(`
    INSERT INTO standings (tournament_id, player_id, rank, points, tie_break_1, tie_break_2, tie_break_3, tie_break_4, tie_break_5, tie_break_6)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tournament_id, player_id) DO UPDATE SET
      rank = excluded.rank,
      points = excluded.points,
      tie_break_1 = excluded.tie_break_1,
      tie_break_2 = excluded.tie_break_2,
      tie_break_3 = excluded.tie_break_3,
      tie_break_4 = excluded.tie_break_4,
      tie_break_5 = excluded.tie_break_5,
      tie_break_6 = excluded.tie_break_6
  `).run(tournamentId, playerId, rank, points, tb1, tb2, tb3, tb4, tb5, tb6);
}

export function getStandings(tournamentId: string) {
  return db.prepare(`
    SELECT s.rank, p.name, p.federation AS fed, p.sex,
           COALESCE(tp.rating, p.rating, 0) AS rating,
           COALESCE(tp.club, p.club, '') AS club,
           s.points, s.tie_break_1, s.tie_break_2, s.tie_break_3,
           s.tie_break_4, s.tie_break_5, s.tie_break_6,
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
      upsertStanding(tournamentId, playerId, s.rank, s.points, s.tieBreak1, s.tieBreak2, s.tieBreak3, s.tieBreak4, s.tieBreak5, s.tieBreak6);
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

export function getPlayerById(playerId: number): DbPlayer | undefined {
  return db.prepare('SELECT * FROM players WHERE id = ?').get(playerId) as DbPlayer | undefined;
}

export function findPlayerByIdentity(name: string, federation = ''): DbPlayer | undefined {
  const normalizedName = name.trim();
  const normalizedFed = federation.trim();

  if (normalizedFed) {
    const exact = db.prepare(
      'SELECT * FROM players WHERE name = ? AND federation = ? LIMIT 1',
    ).get(normalizedName, normalizedFed) as DbPlayer | undefined;
    if (exact) return exact;
  }

  if (!normalizedFed) {
    return db.prepare(
      `SELECT *
       FROM players
       WHERE name = ?
       ORDER BY
         CASE
           WHEN federation != '' THEN 0
           WHEN sex != '' THEN 1
           WHEN fide_id IS NOT NULL THEN 2
           WHEN rating IS NOT NULL THEN 3
           ELSE 4
         END,
         updated_at DESC
       LIMIT 1`,
    ).get(normalizedName) as DbPlayer | undefined;
  }

  return db.prepare(
    `SELECT *
     FROM players
     WHERE name = ?
     ORDER BY CASE WHEN federation = ? THEN 0 WHEN federation != '' THEN 1 ELSE 2 END,
              updated_at DESC
     LIMIT 1`,
  ).get(normalizedName, normalizedFed) as DbPlayer | undefined;
}

export function getPlayerTournamentHistory(playerId: number) {
  return db.prepare(`
    SELECT
      t.id AS tournament_id,
      t.name AS tournament_name,
      t.event_label,
      t.date,
      t.location,
      t.type,
      t.total_rounds,
      t.updated_at,
      s.rank,
      s.points,
      s.tie_break_1,
      s.tie_break_2,
      s.tie_break_3,
      s.tie_break_4,
      s.tie_break_5,
      s.tie_break_6,
      tp.starting_number,
      tp.rating AS tournament_rating,
      tp.club AS tournament_club
    FROM tournament_players tp
    JOIN tournaments t ON t.id = tp.tournament_id
    LEFT JOIN standings s ON s.tournament_id = tp.tournament_id AND s.player_id = tp.player_id
    WHERE tp.player_id = ?
    ORDER BY datetime(t.updated_at) DESC
  `).all(playerId) as DbPlayerTournamentHistory[];
}

export function getPlayerResultRows(playerId: number) {
  return db.prepare(`
    SELECT tournament_id, white_player_id, black_player_id, result
    FROM results
    WHERE white_player_id = ? OR black_player_id = ?
  `).all(playerId, playerId) as DbPlayerResultEntry[];
}
