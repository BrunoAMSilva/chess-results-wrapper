import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'cache.db');

let db: Database.Database;
try {
  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);
} catch (_) {
  // Fall back to in-memory database if file DB fails
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);
}

export default db;
