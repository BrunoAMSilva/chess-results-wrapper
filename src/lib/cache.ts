import db from './db';

interface CacheEntry<T> {
  value: T;
  expires_at: number;
}

export function getCache<T>(key: string): T | null {
  const stmt = db.prepare('SELECT value, expires_at FROM cache WHERE key = ?');
  const row = stmt.get(key) as { value: string; expires_at: number } | undefined;

  if (!row) return null;

  if (Date.now() > row.expires_at) {
    db.prepare('DELETE FROM cache WHERE key = ?').run(key);
    return null;
  }

  try {
    return JSON.parse(row.value) as T;
  } catch (e) {
    return null;
  }
}

export function setCache<T>(key: string, value: T, ttlSeconds: number): void {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const stmt = db.prepare('INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)');
  stmt.run(key, JSON.stringify(value), expiresAt);
}

export function invalidateCache(key: string): void {
    db.prepare('DELETE FROM cache WHERE key = ?').run(key);
}
