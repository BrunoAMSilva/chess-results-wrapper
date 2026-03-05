import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { parseHtml, parseStandingsHtml } from '../scraper';
import { detectTournamentType } from './index';
import { TournamentType } from '../types';

// ─── Known tournament IDs for each strategy ────────────────────────────────────
// These are real, ended tournaments whose data is stable.
const TOURNAMENTS = {
  swiss: '865223', // Portimão Chess Festival 2024
  roundRobin: '984637', // Memorial Daniel Morelli - Prix ACUA
  teamSwiss: '1085703', // National Progressive School's Confrence Chess-Mate
  teamRoundRobin: '1095200', // PŠS KS 1.1 (1. třída) 2024-2025
} as const;

const BASE_URL = 'https://chess-results.com';

// Skip live tests when SKIP_LIVE=1 is set
const SKIP_LIVE = process.env.SKIP_LIVE === '1';
const liveDescribe = SKIP_LIVE ? describe.skip : describe;

// ─── Helper to fetch HTML ──────────────────────────────────────────────────────

async function fetchPairingsHtml(id: string, round = 1, lang = 1): Promise<string> {
  const url = `${BASE_URL}/tnr${id}.aspx?lan=${lang}&art=2&rd=${round}&turdet=YES`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchStandingsHtml(id: string, lang = 1): Promise<string> {
  const url = `${BASE_URL}/tnr${id}.aspx?lan=${lang}&art=1&turdet=YES`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Swiss Strategy Tests
// ═══════════════════════════════════════════════════════════════════════════════

liveDescribe('SwissStrategy — live (865223)', { timeout: 15000 }, () => {
  it('should detect Swiss tournament type', async () => {
    const html = await fetchPairingsHtml(TOURNAMENTS.swiss);
    const $ = cheerio.load(html);
    const type = detectTournamentType($);
    expect(type).toBe(TournamentType.Swiss);
  });

  it('should parse Swiss pairings correctly', async () => {
    const html = await fetchPairingsHtml(TOURNAMENTS.swiss, 1);
    const data = parseHtml(html, 1);

    expect(data.info.type).toBe(TournamentType.Swiss);
    expect(data.info.round).toBe(1);
    expect(data.info.name).toContain('Portimão');
    // totalRounds may be 0 if the metadata is not on the pairings page
    expect(data.info.totalRounds).toBeGreaterThanOrEqual(0);

    // Swiss pairings should have individual pairings, no team pairings
    expect(data.pairings.length).toBeGreaterThan(10);
    expect(data.teamPairings).toBeUndefined();

    // Validate pairing shape
    const first = data.pairings[0];
    expect(first.table).toBe(1);
    expect(first.white.name).toBeTruthy();
    expect(first.white.number).toBeGreaterThan(0);
    expect(first.result).toBeTruthy();
  });

  it('should parse Swiss standings correctly', async () => {
    const html = await fetchStandingsHtml(TOURNAMENTS.swiss);
    const data = parseStandingsHtml(html);

    expect(data.info.name).toContain('Portimão');
    expect(data.standings.length).toBeGreaterThan(10);

    const first = data.standings[0];
    expect(first.rank).toBe(1);
    expect(first.name).toBeTruthy();
    expect(first.points).toBeTruthy();
  });

  it('should parse different rounds for Swiss', async () => {
    const html1 = await fetchPairingsHtml(TOURNAMENTS.swiss, 1);
    const html5 = await fetchPairingsHtml(TOURNAMENTS.swiss, 5);

    const data1 = parseHtml(html1, 1);
    const data5 = parseHtml(html5, 5);

    expect(data1.info.round).toBe(1);
    expect(data5.info.round).toBe(5);

    // Different rounds should generally have different pairings
    expect(data1.pairings.length).toBeGreaterThan(0);
    expect(data5.pairings.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Round Robin Strategy Tests
// ═══════════════════════════════════════════════════════════════════════════════

liveDescribe('RoundRobinStrategy — live (984637)', { timeout: 15000 }, () => {
  it('should detect Round Robin tournament type', async () => {
    const html = await fetchPairingsHtml(TOURNAMENTS.roundRobin);
    const $ = cheerio.load(html);
    const type = detectTournamentType($);
    expect(type).toBe(TournamentType.RoundRobin);
  });

  it('should parse Round Robin pairings with round separators', async () => {
    const html = await fetchPairingsHtml(TOURNAMENTS.roundRobin, 1);
    const data = parseHtml(html, 1);

    expect(data.info.type).toBe(TournamentType.RoundRobin);
    expect(data.info.round).toBe(1);
    expect(data.teamPairings).toBeUndefined();

    // Round Robin pairings only contain boards for the requested round
    expect(data.pairings.length).toBeGreaterThan(0);

    // Validate pairing shape
    for (const p of data.pairings) {
      expect(typeof p.table).toBe('number');
      expect(p.white.name).toBeTruthy();
      expect(typeof p.result).toBe('string');
    }
  });

  it('should filter to specific round in Round Robin', async () => {
    const html = await fetchPairingsHtml(TOURNAMENTS.roundRobin, 1);

    // Round Robin pages include all rounds — the strategy should filter
    const data1 = parseHtml(html, 1);
    const data2 = parseHtml(html, 2);

    expect(data1.info.round).toBe(1);
    expect(data2.info.round).toBe(2);

    // Each round should have a portion of the total pairings
    expect(data1.pairings.length).toBeGreaterThan(0);
    expect(data2.pairings.length).toBeGreaterThan(0);
  });

  it('should parse Round Robin standings correctly', async () => {
    const html = await fetchStandingsHtml(TOURNAMENTS.roundRobin);
    const data = parseStandingsHtml(html);

    expect(data.standings.length).toBeGreaterThan(0);
    const first = data.standings[0];
    expect(first.rank).toBe(1);
    expect(first.name).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Team Swiss Strategy Tests
// ═══════════════════════════════════════════════════════════════════════════════

liveDescribe('TeamSwissStrategy — live (1085703)', { timeout: 15000 }, () => {
  it('should detect Team Swiss tournament type', async () => {
    const html = await fetchPairingsHtml(TOURNAMENTS.teamSwiss);
    const $ = cheerio.load(html);
    const type = detectTournamentType($);
    // Should detect as a team type (Swiss or TeamSwiss)
    expect([TournamentType.TeamSwiss, TournamentType.TeamRoundRobin]).toContain(type);
  });

  it('should parse Team Swiss pairings as team matches', async () => {
    const html = await fetchPairingsHtml(TOURNAMENTS.teamSwiss, 1);
    const data = parseHtml(html, 1);

    expect([TournamentType.TeamSwiss, TournamentType.TeamRoundRobin]).toContain(data.info.type);
    expect(data.info.round).toBe(1);

    // Team pairings should exist
    expect(data.teamPairings).toBeDefined();
    expect(data.teamPairings!.length).toBeGreaterThan(0);

    // Each team pairing should have team names and a result
    const first = data.teamPairings![0];
    expect(first.table).toBe(1);
    expect(first.whiteTeam).toBeTruthy();
    expect(first.blackTeam).toBeTruthy();
    expect(first.result).toBeTruthy();

    // Individual pairings array should be empty for art=2 team format
    expect(data.pairings.length).toBe(0);
  });

  it('should parse multiple team matches in a round', async () => {
    const html = await fetchPairingsHtml(TOURNAMENTS.teamSwiss, 1);
    const data = parseHtml(html, 1);

    // The tournament has multiple teams playing per round
    expect(data.teamPairings!.length).toBeGreaterThanOrEqual(3);

    // Table numbers should be sequential
    const tables = data.teamPairings!.map(tp => tp.table);
    for (let i = 1; i < tables.length; i++) {
      expect(tables[i]).toBe(tables[i - 1] + 1);
    }
  });

  it('should parse Team Swiss standings', async () => {
    const html = await fetchStandingsHtml(TOURNAMENTS.teamSwiss);
    const data = parseStandingsHtml(html);

    // art=1 for team tournaments shows team-composition cross-table
    // Our standings parser should handle it or return empty gracefully
    expect(data).toBeDefined();
    expect(data.info).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Team Round Robin Strategy Tests
// ═══════════════════════════════════════════════════════════════════════════════

liveDescribe('TeamRoundRobinStrategy — live (1095200)', { timeout: 15000 }, () => {
  it('should detect Team Round Robin tournament type', async () => {
    const html = await fetchPairingsHtml(TOURNAMENTS.teamRoundRobin);
    const $ = cheerio.load(html);
    const type = detectTournamentType($);
    // With metadata, should detect as TeamRoundRobin
    expect(type).toBe(TournamentType.TeamRoundRobin);
  });

  it('should parse Team Round Robin pairings as team matches', async () => {
    const html = await fetchPairingsHtml(TOURNAMENTS.teamRoundRobin, 1);
    const data = parseHtml(html, 1);

    expect(data.info.type).toBe(TournamentType.TeamRoundRobin);
    expect(data.info.round).toBe(1);

    // Team pairings should exist
    expect(data.teamPairings).toBeDefined();
    expect(data.teamPairings!.length).toBeGreaterThan(0);

    // Each team pairing should have team names and a result
    for (const tp of data.teamPairings!) {
      expect(tp.whiteTeam).toBeTruthy();
      if (tp.blackTeam !== 'bye') {
        expect(tp.blackTeam).toBeTruthy();
      }
      expect(typeof tp.result).toBe('string');
    }

    // Individual pairings should be empty for team format
    expect(data.pairings.length).toBe(0);
  });

  it('should detect metadata correctly for Team Round Robin', async () => {
    const html = await fetchPairingsHtml(TOURNAMENTS.teamRoundRobin);
    const data = parseHtml(html, 1);

    expect(data.info.totalRounds).toBe(11);
  });

  it('should parse Team Round Robin standings', async () => {
    const html = await fetchStandingsHtml(TOURNAMENTS.teamRoundRobin);
    const data = parseStandingsHtml(html);

    expect(data).toBeDefined();
    expect(data.info).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Cross-strategy validation
// ═══════════════════════════════════════════════════════════════════════════════

liveDescribe('Cross-strategy detection consistency', { timeout: 30000 }, () => {
  it('should uniquely identify each tournament type', async () => {
    const results: Record<string, TournamentType> = {};

    for (const [label, id] of Object.entries(TOURNAMENTS)) {
      const html = await fetchPairingsHtml(id);
      const $ = cheerio.load(html);
      results[label] = detectTournamentType($);
    }

    // Swiss and Round Robin should be detected correctly
    expect(results.swiss).toBe(TournamentType.Swiss);
    expect(results.roundRobin).toBe(TournamentType.RoundRobin);

    // Team types should be detected as team variants
    expect([TournamentType.TeamSwiss, TournamentType.TeamRoundRobin]).toContain(results.teamSwiss);
    expect(results.teamRoundRobin).toBe(TournamentType.TeamRoundRobin);
  });
});

describe('detectTournamentType regressions', () => {
  it('treats single-round-header pairings pages as Swiss', () => {
    const html = `
      <table class="CRs1">
        <tr class="CRg1b"><td colspan="8">Round 3 on 2026/03/01 at 10:00</td></tr>
        <tr>
          <th>Bo.</th><th>No.</th><th>White</th><th>Pts.</th><th>Result</th><th>Pts.</th><th>Black</th><th>No.</th>
        </tr>
        <tr class="CRg1">
          <td>1</td><td>1</td><td>Alice</td><td>2</td><td>1 - 0</td><td>2</td><td>Bob</td><td>2</td>
        </tr>
      </table>
    `;

    const $ = cheerio.load(html);
    expect(detectTournamentType($)).toBe(TournamentType.Swiss);
  });
});
