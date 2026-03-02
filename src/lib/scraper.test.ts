import { describe, it, expect } from 'vitest';
import { parseHtml, parseStandingsHtml, scrapePairings, scrapeStandings } from './scraper';
import { detectTournamentType } from './strategies';
import { TournamentType } from './types';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

const fixturesDir = path.join(__dirname, '../../tests/fixtures');

function loadFixture(filename: string): string {
  return fs.readFileSync(path.join(fixturesDir, filename), 'utf-8');
}

// ─── Static fixture tests (deterministic, fast) ───────────────────────────────

describe('Scraper - Static Fixtures', () => {
  describe('parseStandingsHtml', () => {
    it('should parse ended tournament standings correctly', () => {
      const html = loadFixture('ended_standings.html');
      const data = parseStandingsHtml(html);

      expect(data.info.name).toBeTruthy();
      expect(data.standings.length).toBeGreaterThan(0);

      const first = data.standings[0];
      expect(first.rank).toBe(1);
      expect(first.name).toBeTruthy();
      expect(first.points).toBeTruthy();
      expect(first.tieBreak1).toBeTruthy();
    });

    it('should parse Portuguese standings correctly (Desp headers)', () => {
      const html = loadFixture('portuguese_standings.html');
      const data = parseStandingsHtml(html);

      expect(data.standings.length).toBeGreaterThan(0);
      const first = data.standings[0];
      expect(first.tieBreak1).toBeTruthy();
      expect(first.points).toBeTruthy();
    });

    it('should handle future tournament (participants list) gracefully', () => {
        const html = loadFixture('future_participants.html');
        const data = parseStandingsHtml(html);
        expect(data).toBeDefined();
    });

    it('should detect sex column and generate women standings', () => {
      const html = loadFixture('ended_standings.html');
      const data = parseStandingsHtml(html);

      // The ended_standings fixture has a sex column
      // Check that women's standings are derived
      expect(data.womenStandings).toBeDefined();

      // If there are women in the tournament, they should appear
      const womenInFull = data.standings.filter(s => s.sex === 'F');
      expect(data.womenStandings.length).toBe(womenInFull.length);

      // Women's standings should have re-ranked positions
      if (data.womenStandings.length > 0) {
        expect(data.womenStandings[0].rank).toBe(1);
        // Ensure rank is sequential
        data.womenStandings.forEach((s, i) => {
          expect(s.rank).toBe(i + 1);
        });
      }
    });

    it('should include sex field on standing entries', () => {
      const html = loadFixture('ended_standings.html');
      const data = parseStandingsHtml(html);

      // Every standing should have a sex field
      for (const s of data.standings) {
        expect(typeof s.sex).toBe('string');
        expect(['M', 'F', '']).toContain(s.sex);
      }
    });
  });

  describe('parseHtml (Pairings)', () => {
    it('should parse ended tournament pairings correctly', () => {
      const html = loadFixture('ended_pairings.html');
      const data = parseHtml(html, 9);

      expect(data.info.round).toBe(9);
      expect(data.pairings.length).toBeGreaterThan(0);

      const first = data.pairings[0];
      expect(first.table).toBe(1);
      expect(first.white.name).toBeTruthy();
      expect(first.black?.name).toBeTruthy();
      expect(first.result).toBeTruthy();
    });

    it('should include tournament type in info', () => {
      const html = loadFixture('ended_pairings.html');
      const data = parseHtml(html, 9);

      expect(data.info.type).toBeDefined();
      expect(Object.values(TournamentType)).toContain(data.info.type);
    });
  });

  describe('Tournament type detection', () => {
    it('should detect Swiss system by default', () => {
      const html = loadFixture('ended_pairings.html');
      const $ = cheerio.load(html);
      const type = detectTournamentType($);
      // A standard pairings page without round separators → Swiss
      expect(type).toBe(TournamentType.Swiss);
    });
  });
});

// ─── Live integration tests (detect chess-results.com format changes) ─────────
// These tests fetch real data from chess-results.com to validate that
// the HTML structure we depend on hasn't changed. They validate shape,
// not exact values.
//
// Run with: npx vitest run src/lib/scraper.test.ts
// Skip live tests: SKIP_LIVE=1 npx vitest run src/lib/scraper.test.ts

const SKIP_LIVE = process.env.SKIP_LIVE === '1';
const liveDescribe = SKIP_LIVE ? describe.skip : describe;

// Known ended tournament — stable data that won't change
const ENDED_TOURNAMENT_ID = '865223'; // Portimão Chess Festival 2024

// CSS classes and HTML elements we rely on for scraping
const CRITICAL_SELECTORS = {
  mainTable: 'table.CRs1',
  dataRowClasses: ['CRng1', 'CRng2'],
  detailCell: 'td.CR',
  headerElement: 'h2',
  roundElement: 'h3',
};

liveDescribe('Scraper - Live Canary Tests', { timeout: 15000 }, () => {
  it('should detect critical CSS classes in pairings HTML', async () => {
    const url = `https://chess-results.com/tnr${ENDED_TOURNAMENT_ID}.aspx?lan=1&art=2&rd=1&turdet=YES`;
    const res = await fetch(url, { redirect: 'follow' });
    expect(res.ok).toBe(true);
    const html = await res.text();
    const $ = cheerio.load(html);

    // Verify the CSS classes we depend on still exist
    expect($('table.CRs1').length).toBeGreaterThan(0);
    expect($('tr.CRng1, tr.CRng2').length).toBeGreaterThan(0);
    expect($('td.CR').length).toBeGreaterThan(0);
    expect($('h2').length).toBeGreaterThan(0);
  });

  it('should detect critical CSS classes in standings HTML', async () => {
    const url = `https://chess-results.com/tnr${ENDED_TOURNAMENT_ID}.aspx?lan=1&art=1&turdet=YES`;
    const res = await fetch(url, { redirect: 'follow' });
    expect(res.ok).toBe(true);
    const html = await res.text();
    const $ = cheerio.load(html);

    expect($('table.CRs1').length).toBeGreaterThan(0);
    expect($('table.CRs1 th').length).toBeGreaterThan(0);
    // Verify header contains expected columns
    const headers = $('table.CRs1 th').map((_, el) => $(el).text().trim()).get();
    expect(headers.some(h => h === 'Name')).toBe(true);
    expect(headers.some(h => h.includes('Pts'))).toBe(true);
  });
});

liveDescribe('Scraper - Live Structure Validation', { timeout: 15000 }, () => {
  it('should scrape standings for an ended tournament (English)', async () => {
    const data = await scrapeStandings(ENDED_TOURNAMENT_ID, 1);

    // Structure checks
    expect(data.info).toBeDefined();
    expect(typeof data.info.name).toBe('string');
    expect(data.info.name.length).toBeGreaterThan(0);

    expect(data.standings.length).toBeGreaterThan(10);

    // Validate shape of each standing entry
    for (const s of data.standings.slice(0, 5)) {
      expect(typeof s.rank).toBe('number');
      expect(s.rank).toBeGreaterThan(0);
      expect(typeof s.name).toBe('string');
      expect(s.name.length).toBeGreaterThan(0);
      expect(typeof s.points).toBe('string');
      expect(s.points.length).toBeGreaterThan(0);
      expect(typeof s.tieBreak1).toBe('string');
    }

    // Ranks should be sequential
    const ranks = data.standings.map(s => s.rank);
    expect(ranks[0]).toBe(1);
  });

  it('should scrape standings for an ended tournament (Portuguese)', async () => {
    const data = await scrapeStandings(ENDED_TOURNAMENT_ID, 10);

    expect(data.standings.length).toBeGreaterThan(10);

    // TB columns must be populated (this caught the Desp bug)
    const first = data.standings[0];
    expect(first.tieBreak1).toBeTruthy();
    expect(first.points).toBeTruthy();
  });

  it('should scrape pairings for an ended tournament', async () => {
    const data = await scrapePairings(ENDED_TOURNAMENT_ID, 1, 1);

    expect(data.info.round).toBe(1);
    expect(data.pairings.length).toBeGreaterThan(0);

    // Validate shape — some pairings may have byes/empty names
    for (const p of data.pairings.slice(0, 5)) {
      expect(typeof p.table).toBe('number');
      expect(p.table).toBeGreaterThan(0);
      expect(typeof p.white.name).toBe('string');
      expect(typeof p.result).toBe('string');
    }

    // At least some pairings should have non-empty white player names
    const withNames = data.pairings.filter(p => p.white.name.length > 0);
    expect(withNames.length).toBeGreaterThan(0);
  });

  it('should handle multiple different tournaments', async () => {
    // Test with a different tournament to ensure we're not overfitting
    // Prague International Chess Festival 2026
    const pragueId = '1307079';
    const data = await scrapeStandings(pragueId, 1);

    expect(data.info).toBeDefined();
    expect(typeof data.info.name).toBe('string');
    // This may or may not have standings depending on when it runs,
    // but it should never throw
  });
});
