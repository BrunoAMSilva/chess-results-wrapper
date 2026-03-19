import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'chess-results.db');

// Bump when the schema changes. Triggers a full data wipe on startup
// if the stored PRAGMA user_version is behind this value.
const DB_VERSION = 5;

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
    birth_year INTEGER,
    national_id TEXT,
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
    national_rating INTEGER,
    performance_rating INTEGER,
    rating_change TEXT,
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
    type TEXT NOT NULL DEFAULT 'open',
    rank INTEGER NOT NULL,
    points TEXT NOT NULL DEFAULT '',
    tie_break_1 TEXT NOT NULL DEFAULT '',
    tie_break_2 TEXT NOT NULL DEFAULT '',
    tie_break_3 TEXT NOT NULL DEFAULT '',
    tie_break_4 TEXT NOT NULL DEFAULT '',
    tie_break_5 TEXT NOT NULL DEFAULT '',
    tie_break_6 TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (tournament_id, player_id, type)
  );

  -- Indexes for common queries
  CREATE INDEX IF NOT EXISTS idx_results_tournament_round ON results(tournament_id, round);
  CREATE INDEX IF NOT EXISTS idx_results_white_player ON results(white_player_id) WHERE white_player_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_results_black_player ON results(black_player_id) WHERE black_player_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_standings_tournament ON standings(tournament_id);
  CREATE INDEX IF NOT EXISTS idx_standings_player_type ON standings(player_id, type);
  CREATE INDEX IF NOT EXISTS idx_tournament_players_player ON tournament_players(player_id);
  CREATE INDEX IF NOT EXISTS idx_players_name ON players(name);
  CREATE INDEX IF NOT EXISTS idx_players_fide ON players(fide_id) WHERE fide_id IS NOT NULL;

  -- Referee-recorded results (separate from chess-results source of truth)
  CREATE TABLE IF NOT EXISTS referee_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id TEXT NOT NULL,
    round INTEGER NOT NULL,
    table_number INTEGER NOT NULL,
    result TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(tournament_id, round, table_number)
  );
  CREATE INDEX IF NOT EXISTS idx_referee_results_tournament_round ON referee_results(tournament_id, round);
`);

// ─── Database versioning ────────────────────────────────────────────────────
// If the stored version is behind DB_VERSION, wipe all data so stale rows
// (wrong tournament types, missing labels, etc.) don't persist across deploys.
const currentVersion = db.pragma('user_version', { simple: true }) as number;
if (currentVersion < DB_VERSION) {
  db.exec(`
    DELETE FROM results;
    DELETE FROM standings;
    DELETE FROM tournament_players;
    DELETE FROM players;
    DELETE FROM tournaments;
    DELETE FROM cache;
  `);
  db.pragma(`user_version = ${DB_VERSION}`);
}

// ─── Table migrations (idempotent) ──────────────────────────────────────────
// Recreate standings table if missing `type` column (needed in PRIMARY KEY)
const standingsCols = (db.prepare('PRAGMA table_info(standings)').all() as { name: string }[]);
if (!standingsCols.some(c => c.name === 'type')) {
  db.exec('DROP TABLE IF EXISTS standings');
  db.exec(`
    CREATE TABLE standings (
      tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'open',
      rank INTEGER NOT NULL,
      points TEXT NOT NULL DEFAULT '',
      tie_break_1 TEXT NOT NULL DEFAULT '',
      tie_break_2 TEXT NOT NULL DEFAULT '',
      tie_break_3 TEXT NOT NULL DEFAULT '',
      tie_break_4 TEXT NOT NULL DEFAULT '',
      tie_break_5 TEXT NOT NULL DEFAULT '',
      tie_break_6 TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (tournament_id, player_id, type)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_standings_tournament ON standings(tournament_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_standings_player_type ON standings(player_id, type)');
}

// ─── Column migrations (idempotent) ─────────────────────────────────────────
try { db.exec('ALTER TABLE players ADD COLUMN birth_year INTEGER'); } catch (_) {}
try { db.exec('ALTER TABLE players ADD COLUMN national_id TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE tournament_players ADD COLUMN national_rating INTEGER'); } catch (_) {}
try { db.exec('ALTER TABLE tournament_players ADD COLUMN performance_rating INTEGER'); } catch (_) {}
try { db.exec("ALTER TABLE tournament_players ADD COLUMN rating_change TEXT"); } catch (_) {}

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
  LinkedTournament,
  Sex,
  Standing,
  TournamentInfo,
  TournamentType,
  Pairing,
  TeamPairing,
  PlayerCardData,
  DbPlayerTournamentHistory,
  DbPlayerResultEntry,
} from './types';

// ── Tournaments ──

export function upsertTournament(info: TournamentInfo, tournamentId: string): void {
  // Migrate: add columns if they don't exist yet (no-op after first run)
  try { db.exec('ALTER TABLE tournaments ADD COLUMN event_label TEXT NOT NULL DEFAULT \'\''); } catch (_) {}
  try { db.exec('ALTER TABLE tournaments ADD COLUMN linked_tournaments TEXT NOT NULL DEFAULT \'[]\''); } catch (_) {}
  try { db.exec("ALTER TABLE tournaments ADD COLUMN last_updated TEXT NOT NULL DEFAULT ''"); } catch (_) {}

  // Filter out self-reference from linked tournaments
  const filtered = info.linkedTournaments?.filter((t) => t.id !== tournamentId);
  const linkedJson = filtered && filtered.length > 0
    ? JSON.stringify(filtered)
    : '[]';
  db.prepare(`
    INSERT INTO tournaments (id, name, type, total_rounds, date, location, event_label, linked_tournaments, last_updated, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      total_rounds = CASE WHEN excluded.total_rounds > 0 THEN excluded.total_rounds ELSE tournaments.total_rounds END,
      date = CASE WHEN excluded.date != '' THEN excluded.date ELSE tournaments.date END,
      location = CASE WHEN excluded.location != '' THEN excluded.location ELSE tournaments.location END,
      event_label = CASE WHEN excluded.event_label != '' THEN excluded.event_label ELSE tournaments.event_label END,
      linked_tournaments = CASE WHEN excluded.linked_tournaments != '[]' THEN excluded.linked_tournaments ELSE tournaments.linked_tournaments END,
      last_updated = CASE WHEN excluded.last_updated != '' THEN excluded.last_updated ELSE tournaments.last_updated END,
      updated_at = datetime('now')
  `).run(tournamentId, info.name, info.type, info.totalRounds, info.date, info.location, info.currentLabel || '', linkedJson, info.lastUpdated || '');

  // Propagate links bidirectionally: if A links to B, ensure B links back to A
  if (filtered && filtered.length > 0 && info.currentLabel) {
    const reverseEntry = JSON.stringify({ id: tournamentId, name: info.currentLabel });
    for (const linked of filtered) {
      const row = db.prepare('SELECT linked_tournaments, event_label FROM tournaments WHERE id = ?').get(linked.id) as { linked_tournaments: string; event_label: string } | undefined;
      if (!row) continue;
      try {
        const existing: LinkedTournament[] = JSON.parse(row.linked_tournaments);
        if (existing.some((t) => t.id === tournamentId)) continue;
        // Build full link set: existing links + this tournament + all siblings (excluding self)
        const siblings = filtered.filter((t) => t.id !== linked.id);
        const merged = [...existing];
        for (const entry of [{ id: tournamentId, name: info.currentLabel }, ...siblings]) {
          if (!merged.some((t) => t.id === entry.id)) {
            merged.push(entry);
          }
        }
        const mergedJson = JSON.stringify(merged);
        // Also propagate event_label from the link name if the linked tournament has none
        if (!row.event_label && linked.name) {
          db.prepare('UPDATE tournaments SET linked_tournaments = ?, event_label = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(mergedJson, linked.name, linked.id);
        } else {
          db.prepare('UPDATE tournaments SET linked_tournaments = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(mergedJson, linked.id);
        }
      } catch (_) { /* malformed JSON is non-critical */ }
    }
  }
}

export function getTournament(tournamentId: string): DbTournament | undefined {
  return db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId) as DbTournament | undefined;
}

// ── Players ──

export function upsertPlayer(
  name: string,
  federation: string,
  sex: Sex = '',
  fideId: string | null = null,
  birthYear: number | null = null,
  nationalId: string | null = null,
): number {
  const normalizedName = name.trim();
  const normalizedFed = federation.trim();
  const normalizedFideId = fideId?.trim() || null;
  const normalizedNationalId = nationalId?.trim() || null;

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
          fide_id = ?,
          birth_year = CASE WHEN ? IS NOT NULL THEN ? ELSE birth_year END,
          national_id = CASE WHEN ? IS NOT NULL THEN ? ELSE national_id END,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        normalizedName,
        normalizedName,
        normalizedFed,
        normalizedFed,
        sex,
        sex,
        normalizedFideId,
        birthYear,
        birthYear,
        normalizedNationalId,
        normalizedNationalId,
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
        fide_id = CASE WHEN ? IS NOT NULL THEN ? ELSE fide_id END,
        birth_year = CASE WHEN ? IS NOT NULL THEN ? ELSE birth_year END,
        national_id = CASE WHEN ? IS NOT NULL THEN ? ELSE national_id END,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      sex,
      sex,
      normalizedFideId,
      normalizedFideId,
      birthYear,
      birthYear,
      normalizedNationalId,
      normalizedNationalId,
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
          fide_id = CASE WHEN ? IS NOT NULL THEN ? ELSE fide_id END,
          birth_year = CASE WHEN ? IS NOT NULL THEN ? ELSE birth_year END,
          national_id = CASE WHEN ? IS NOT NULL THEN ? ELSE national_id END,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        sex,
        sex,
        normalizedFideId,
        normalizedFideId,
        birthYear,
        birthYear,
        normalizedNationalId,
        normalizedNationalId,
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
          fide_id = CASE WHEN ? IS NOT NULL THEN ? ELSE fide_id END,
          birth_year = CASE WHEN ? IS NOT NULL THEN ? ELSE birth_year END,
          national_id = CASE WHEN ? IS NOT NULL THEN ? ELSE national_id END,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        normalizedFed,
        sex,
        sex,
        normalizedFideId,
        normalizedFideId,
        birthYear,
        birthYear,
        normalizedNationalId,
        normalizedNationalId,
        placeholder.id,
      );
      return placeholder.id;
    }
  }

  const result = db.prepare(`
    INSERT INTO players (name, federation, sex, fide_id, birth_year, national_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(normalizedName, normalizedFed, sex, normalizedFideId, birthYear, normalizedNationalId);

  return Number(result.lastInsertRowid);
}

export function linkPlayerToTournament(
  tournamentId: string,
  playerId: number,
  startingNumber: number,
  rating: number | null = null,
  club = '',
  nationalRating: number | null = null,
  performanceRating: number | null = null,
  ratingChange: string | null = null,
): void {
  db.prepare(`
    INSERT INTO tournament_players (tournament_id, player_id, starting_number, rating, club, national_rating, performance_rating, rating_change)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tournament_id, player_id) DO UPDATE SET
      starting_number = CASE WHEN excluded.starting_number > 0 THEN excluded.starting_number ELSE tournament_players.starting_number END,
      rating = COALESCE(excluded.rating, tournament_players.rating),
      club = CASE WHEN excluded.club != '' THEN excluded.club ELSE tournament_players.club END,
      national_rating = COALESCE(excluded.national_rating, tournament_players.national_rating),
      performance_rating = COALESCE(excluded.performance_rating, tournament_players.performance_rating),
      rating_change = CASE WHEN excluded.rating_change IS NOT NULL THEN excluded.rating_change ELSE tournament_players.rating_change END
  `).run(tournamentId, playerId, startingNumber, rating, club, nationalRating, performanceRating, ratingChange);
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
    SELECT r.*, pw.name AS white_name, pb.name AS black_name,
           COALESCE(tpw.starting_number, 0) AS white_starting_number,
           COALESCE(tpb.starting_number, 0) AS black_starting_number
    FROM results r
    LEFT JOIN players pw ON r.white_player_id = pw.id
    LEFT JOIN players pb ON r.black_player_id = pb.id
    LEFT JOIN tournament_players tpw ON tpw.tournament_id = r.tournament_id AND tpw.player_id = r.white_player_id
    LEFT JOIN tournament_players tpb ON tpb.tournament_id = r.tournament_id AND tpb.player_id = r.black_player_id
    WHERE r.tournament_id = ? AND r.round = ?
    ORDER BY r.table_number
  `).all(tournamentId, round);
}

/** Build TournamentData for a specific round from DB rows. */
export function getPairingsFromDb(
  tournamentId: string,
  round: number,
): { info: TournamentInfo; pairings: Pairing[]; teamPairings?: TeamPairing[] } | null {
  const tournament = getTournament(tournamentId);
  if (!tournament) return null;

  const results = getResults(tournamentId, round) as Array<{
    table_number: number;
    white_name: string | null;
    black_name: string | null;
    white_starting_number: number;
    black_starting_number: number;
    result: string;
    white_team: string | null;
    black_team: string | null;
  }>;
  if (results.length === 0) return null;

  const inferUnpairedLabel = (result: string): string => {
    const normalized = result.trim();
    return normalized === '1' ? 'BYE' : 'not paired';
  };

  const pairings: Pairing[] = results.map((r) => ({
    table: r.table_number,
    white: { name: r.white_name || '', number: r.white_starting_number },
    black: r.black_name ? { name: r.black_name, number: r.black_starting_number } : null,
    unpairedLabel: r.black_name ? undefined : inferUnpairedLabel(r.result),
    result: r.result,
  }));

  const info = buildTournamentInfo(tournament, round);

  const parseBoardScore = (result: string): { white: number; black: number } | null => {
    const normalized = result.replace(/\s+/g, "").toLowerCase();
    if (normalized === "1-0" || normalized === "1:0") return { white: 1, black: 0 };
    if (normalized === "0-1" || normalized === "0:1") return { white: 0, black: 1 };
    if (
      normalized === "½-½" ||
      normalized === "½:½" ||
      normalized === "1/2-1/2" ||
      normalized === "1/2:1/2" ||
      normalized === "0.5-0.5" ||
      normalized === "0.5:0.5"
    ) {
      return { white: 0.5, black: 0.5 };
    }
    return null;
  };

  const formatScore = (value: number): string => {
    if (Number.isInteger(value)) return String(value);
    return String(value).replace(".5", "½");
  };

  // Reconstruct team pairings from board-level results if applicable
  const isTeam = tournament.type === 'team-swiss' || tournament.type === 'team-round-robin';
  const hasTeamData = results.some((r) => r.white_team || r.black_team);

  if (isTeam && hasTeamData) {
    const groupsByKey = new Map<string, {
      whiteTeam: string;
      blackTeam: string;
      boards: Pairing[];
      whiteScore: number;
      blackScore: number;
      scoredBoards: number;
      firstTable: number;
    }>();

    for (const r of results) {
      if (!r.white_team || !r.black_team) {
        continue;
      }

      const key = `${r.white_team}__${r.black_team}`;
      let group = groupsByKey.get(key);
      if (!group) {
        group = {
          whiteTeam: r.white_team,
          blackTeam: r.black_team,
          boards: [],
          whiteScore: 0,
          blackScore: 0,
          scoredBoards: 0,
          firstTable: r.table_number,
        };
        groupsByKey.set(key, group);
      }

      group.boards.push({
        table: r.table_number,
        white: { name: r.white_name || '', number: r.white_starting_number },
        black: r.black_name ? { name: r.black_name, number: r.black_starting_number } : null,
        unpairedLabel: r.black_name ? undefined : inferUnpairedLabel(r.result),
        result: r.result,
      });

      const score = parseBoardScore(r.result);
      if (score) {
        group.whiteScore += score.white;
        group.blackScore += score.black;
        group.scoredBoards += 1;
      }
    }

    if (groupsByKey.size === 0) {
      return { info, pairings };
    }

    const teamPairings: TeamPairing[] = Array.from(groupsByKey.values())
      .sort((a, b) => a.firstTable - b.firstTable)
      .map((g, i) => ({
      table: i + 1,
      whiteTeam: g.whiteTeam,
      blackTeam: g.blackTeam,
      boards: g.boards,
      result: g.scoredBoards > 0
        ? `${formatScore(g.whiteScore)}:${formatScore(g.blackScore)}`
        : '',
      }));

    return { info, pairings, teamPairings };
  }

  return { info, pairings };
}

/** Build StandingsData from DB rows. */
export function getStandingsFromDb(tournamentId: string): {
  info: TournamentInfo;
  standings: Standing[];
  womenStandings: Standing[];
} | null {
  const tournament = getTournament(tournamentId);
  if (!tournament) return null;

  const openRows = getStandings(tournamentId, 'open') as Array<{
    rank: number;
    name: string;
    fed: string;
    sex: Sex;
    rating: number;
    club: string;
    points: string;
    tie_break_1: string;
    tie_break_2: string;
    tie_break_3: string;
    tie_break_4: string;
    tie_break_5: string;
    tie_break_6: string;
    starting_number: number;
    fide_id: string;
  }>;
  if (openRows.length === 0) return null;

  const standings: Standing[] = openRows.map((r) => ({
    rank: r.rank,
    startingNumber: r.starting_number || 0,
    name: r.name,
    fed: r.fed || '',
    rating: r.rating ? String(r.rating) : '',
    club: r.club || '',
    points: r.points,
    sex: r.sex || '',
    fideId: r.fide_id || '',
    tieBreak1: r.tie_break_1 || '',
    tieBreak2: r.tie_break_2 || '',
    tieBreak3: r.tie_break_3 || '',
    tieBreak4: r.tie_break_4 || '',
    tieBreak5: r.tie_break_5 || '',
    tieBreak6: r.tie_break_6 || '',
  }));

  const womenRows = getStandings(tournamentId, 'women') as typeof openRows;
  const womenStandings: Standing[] = womenRows.map((r) => ({
    rank: r.rank,
    startingNumber: r.starting_number || 0,
    name: r.name,
    fed: r.fed || '',
    rating: r.rating ? String(r.rating) : '',
    club: r.club || '',
    points: r.points,
    sex: 'F' as Sex,
    fideId: r.fide_id || '',
    tieBreak1: r.tie_break_1 || '',
    tieBreak2: r.tie_break_2 || '',
    tieBreak3: r.tie_break_3 || '',
    tieBreak4: r.tie_break_4 || '',
    tieBreak5: r.tie_break_5 || '',
    tieBreak6: r.tie_break_6 || '',
  }));

  return { info: buildTournamentInfo(tournament, 0), standings, womenStandings };
}

function buildTournamentInfo(tournament: DbTournament, round = 0): TournamentInfo {
  let linkedTournaments: LinkedTournament[] | undefined;
  let currentLabel: string | undefined;
  try {
    const parsed = JSON.parse(tournament.linked_tournaments);
    if (Array.isArray(parsed) && parsed.length > 0) {
      linkedTournaments = parsed;
      currentLabel = tournament.event_label || undefined;
    }
  } catch (_) { /* ignore */ }

  return {
    name: tournament.name,
    round,
    totalRounds: tournament.total_rounds,
    date: tournament.date,
    location: tournament.location,
    type: tournament.type as TournamentType,
    linkedTournaments,
    currentLabel,
    lastUpdated: tournament.last_updated || undefined,
  };
}

// ── Standings ──

// Migrate: add TB4-TB6 columns if they don't exist yet (no-op after first run)
try { db.exec("ALTER TABLE standings ADD COLUMN tie_break_4 TEXT NOT NULL DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE standings ADD COLUMN tie_break_5 TEXT NOT NULL DEFAULT ''"); } catch (_) {}
try { db.exec("ALTER TABLE standings ADD COLUMN tie_break_6 TEXT NOT NULL DEFAULT ''"); } catch (_) {}

export function upsertStanding(
  tournamentId: string,
  playerId: number,
  type: 'open' | 'women',
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
    INSERT INTO standings (tournament_id, player_id, type, rank, points, tie_break_1, tie_break_2, tie_break_3, tie_break_4, tie_break_5, tie_break_6)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tournament_id, player_id, type) DO UPDATE SET
      rank = excluded.rank,
      points = excluded.points,
      tie_break_1 = excluded.tie_break_1,
      tie_break_2 = excluded.tie_break_2,
      tie_break_3 = excluded.tie_break_3,
      tie_break_4 = excluded.tie_break_4,
      tie_break_5 = excluded.tie_break_5,
      tie_break_6 = excluded.tie_break_6
  `).run(tournamentId, playerId, type, rank, points, tb1, tb2, tb3, tb4, tb5, tb6);
}

export function getStandings(tournamentId: string, type: string = 'open') {
  return db.prepare(`
    SELECT s.rank, p.name, p.federation AS fed, p.sex,
           COALESCE(tp.rating, 0) AS rating,
           COALESCE(tp.club, '') AS club,
           s.points, s.tie_break_1, s.tie_break_2, s.tie_break_3,
           s.tie_break_4, s.tie_break_5, s.tie_break_6,
           tp.starting_number, p.fide_id
    FROM standings s
    JOIN players p ON s.player_id = p.id
    LEFT JOIN tournament_players tp ON tp.tournament_id = s.tournament_id AND tp.player_id = p.id
    WHERE s.tournament_id = ? AND s.type = ?
    ORDER BY s.rank
  `).all(tournamentId, type);
}

/** Persist an entire batch of standings + players in a single transaction. */
export function persistStandings(
  tournamentId: string,
  info: TournamentInfo,
  standings: Standing[],
  womenStandings: Standing[] = [],
): void {
  const txn = db.transaction(() => {
    upsertTournament(info, tournamentId);

    const saveStanding = (s: Standing, type: 'open' | 'women') => {
      const playerId = upsertPlayer(
        s.name,
        s.fed,
        s.sex,
        s.fideId || null,
      );
      linkPlayerToTournament(
        tournamentId,
        playerId,
        s.startingNumber,
        s.rating ? parseInt(s.rating) || null : null,
        s.club,
      );
      upsertStanding(tournamentId, playerId, type, s.rank, s.points, s.tieBreak1, s.tieBreak2, s.tieBreak3, s.tieBreak4, s.tieBreak5, s.tieBreak6);
    };

    for (const s of standings) {
      saveStanding(s, 'open');
    }
    for (const s of womenStandings) {
      saveStanding(s, 'women');
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
  teamPairings?: TeamPairing[],
): void {
  const txn = db.transaction(() => {
    upsertTournament(info, tournamentId);

    if (teamPairings && teamPairings.length > 0) {
      for (const tm of teamPairings) {
        for (const b of tm.boards) {
          const whiteId = b.white.name ? upsertPlayer(b.white.name, '') : null;
          const blackId = b.black?.name ? upsertPlayer(b.black.name, '') : null;
          if (whiteId) linkPlayerToTournament(tournamentId, whiteId, b.white.number);
          if (blackId && b.black) linkPlayerToTournament(tournamentId, blackId, b.black.number);
          upsertResult(tournamentId, round, b.table, whiteId, blackId, b.result, tm.whiteTeam, tm.blackTeam);
        }
      }
    } else {
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
    }
  });
  txn();
}

/** Look up national IDs (Ident-Number) for all players in a tournament, keyed by starting number. */
export function getPlayerNationalIds(tournamentId: string): Record<number, string> {
  const rows = db.prepare(`
    SELECT tp.starting_number, p.national_id
    FROM tournament_players tp
    JOIN players p ON p.id = tp.player_id
    WHERE tp.tournament_id = ? AND p.national_id IS NOT NULL AND p.national_id != ''
  `).all(tournamentId) as Array<{ starting_number: number; national_id: string }>;

  const map: Record<number, string> = {};
  for (const r of rows) {
    if (r.starting_number > 0) {
      map[r.starting_number] = r.national_id;
    }
  }
  return map;
}

/** Persist player card data (art=9) — enriches player + tournament_players with extended fields. */
export function persistPlayerCard(
  tournamentId: string,
  card: PlayerCardData,
): void {
  const playerId = upsertPlayer(
    card.name,
    card.federation,
    '',
    card.fideId || null,
    card.birthYear,
    card.nationalId || null,
  );
  linkPlayerToTournament(
    tournamentId,
    playerId,
    card.startingNumber,
    card.rating,
    card.club,
    card.nationalRating,
    card.performanceRating,
    card.ratingChange || null,
  );
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

export function listTournaments(limit = 20, offset = 0): DbTournament[] {
  return db.prepare(`
    SELECT * FROM tournaments
    ORDER BY datetime(updated_at) DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as DbTournament[];
}

export function searchTournamentsPaged(query: string, limit = 20, offset = 0): DbTournament[] {
  return db.prepare(`
    SELECT * FROM tournaments
    WHERE name LIKE '%' || ? || '%'
    ORDER BY datetime(updated_at) DESC
    LIMIT ? OFFSET ?
  `).all(query, limit, offset) as DbTournament[];
}

export function countTournaments(query = ''): number {
  if (!query.trim()) {
    return (db.prepare(`SELECT COUNT(*) as count FROM tournaments`).get() as { count: number }).count;
  }

  return (db.prepare(`
    SELECT COUNT(*) as count
    FROM tournaments
    WHERE name LIKE '%' || ? || '%'
  `).get(query) as { count: number }).count;
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
      tp.club AS tournament_club,
      tp.national_rating,
      tp.performance_rating,
      tp.rating_change
    FROM tournament_players tp
    JOIN tournaments t ON t.id = tp.tournament_id
    LEFT JOIN standings s ON s.tournament_id = tp.tournament_id AND s.player_id = tp.player_id AND s.type = 'open'
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

// ── Referee Results ──

export function upsertRefereeResult(
  tournamentId: string,
  round: number,
  tableNumber: number,
  result: string,
): void {
  db.prepare(`
    INSERT INTO referee_results (tournament_id, round, table_number, result)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(tournament_id, round, table_number) DO UPDATE SET
      result = excluded.result,
      created_at = datetime('now')
  `).run(tournamentId, round, tableNumber, result);
}

export function getRefereeResults(tournamentId: string, round: number) {
  return db.prepare(`
    SELECT table_number, result, created_at
    FROM referee_results
    WHERE tournament_id = ? AND round = ?
    ORDER BY table_number
  `).all(tournamentId, round) as Array<{ table_number: number; result: string; created_at: string }>;
}
