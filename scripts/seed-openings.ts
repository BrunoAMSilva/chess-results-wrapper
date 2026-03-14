import { insertOpening } from '../src/lib/db';
import Database from 'better-sqlite3';
import path from 'node:path';

const TSV_URLS = [
  'https://raw.githubusercontent.com/lichess-org/chess-openings/master/a.tsv',
  'https://raw.githubusercontent.com/lichess-org/chess-openings/master/b.tsv',
  'https://raw.githubusercontent.com/lichess-org/chess-openings/master/c.tsv',
  'https://raw.githubusercontent.com/lichess-org/chess-openings/master/d.tsv',
  'https://raw.githubusercontent.com/lichess-org/chess-openings/master/e.tsv',
];

function parsePgnMoves(pgn: string): string[] {
  return pgn
    .replace(/\d+\.\s*/g, '')
    .trim()
    .split(/\s+/)
    .filter((m) => m.length > 0);
}

function splitName(fullName: string): { name: string; variation: string } {
  const colonIdx = fullName.indexOf(':');
  if (colonIdx === -1) {
    return { name: fullName.trim(), variation: 'Main Line' };
  }
  return {
    name: fullName.slice(0, colonIdx).trim(),
    variation: fullName.slice(colonIdx + 2).trim() || 'Main Line',
  };
}

async function main() {
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'chess-results.db');
  const db = new Database(dbPath);
  db.exec('DELETE FROM openings');
  db.close();

  let totalInserted = 0;

  for (const url of TSV_URLS) {
    const letter = url.split('/').pop()?.replace('.tsv', '') || '?';
    console.log(`Fetching ${letter}.tsv...`);
    const res = await fetch(url);
    const text = await res.text();
    const lines = text.split('\n');

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const [eco, fullName, pgn] = parts;
      if (!eco || !fullName || !pgn) continue;

      const { name, variation } = splitName(fullName);
      const moves = parsePgnMoves(pgn);
      const limitedMoves = moves.slice(0, 30);
      const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

      insertOpening(name, variation, eco, 'w', limitedMoves, startFen);
      insertOpening(name, variation, eco, 'b', limitedMoves, startFen);
      totalInserted += 2;
    }
  }

  console.log(`Seeded ${totalInserted} openings (${totalInserted / 2} unique variations)`);
}

main().catch(console.error);
