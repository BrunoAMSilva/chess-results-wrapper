import db from './db';

export function getCache<T>(key: string): T | null {
  try {
    const stmt = db.prepare('SELECT value, expires_at FROM cache WHERE key = ?');
    const row = stmt.get(key) as { value: string; expires_at: number } | undefined;

    if (!row) return null;

    if (Date.now() > row.expires_at) {
      try { db.prepare('DELETE FROM cache WHERE key = ?').run(key); } catch (_) { /* ignore */ }
      return null;
    }

    return JSON.parse(row.value) as T;
  } catch (_) {
    return null;
  }
}

export function setCache<T>(key: string, value: T, ttlSeconds: number): void {
  if (ttlSeconds <= 0) return;
  try {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    const stmt = db.prepare('INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)');
    stmt.run(key, JSON.stringify(value), expiresAt);
  } catch (_) {
    // Cache write failure is non-critical
  }
}

export function invalidateCache(key: string): void {
  try {
    db.prepare('DELETE FROM cache WHERE key = ?').run(key);
  } catch (_) {
    // Cache invalidation failure is non-critical
  }
}
