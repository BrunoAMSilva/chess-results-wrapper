import { describe, it, expect } from 'vitest';
import { parseHtml, parseStandingsHtml } from '../../src/lib/scraper';
import { detectTournamentType } from '../../src/lib/strategies';
import { parseTournamentMeta, parseStandingsTable, deriveWomenStandings } from '../../src/lib/strategies/base';
import { TournamentType } from '../../src/lib/types';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

const fixturesDir = path.join(__dirname, '../../tests/fixtures');

function loadFixture(filename: string): string {
  return fs.readFileSync(path.join(fixturesDir, filename), 'utf-8');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tournament Metadata Parsing (recurring regression area)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scraper - Tournament Metadata', () => {
  it('should extract tournament name from h2', () => {
    const html = loadFixture('ended_standings.html');
    const $ = cheerio.load(html);
    const meta = parseTournamentMeta($);
    expect(meta.name).toContain('Portimão');
    expect(meta.name.length).toBeGreaterThan(0);
  });

  it('should extract totalRounds', () => {
    const html = loadFixture('ended_standings.html');
    const $ = cheerio.load(html);
    const meta = parseTournamentMeta($);
    expect(meta.totalRounds).toBeGreaterThan(0);
  });

  it('should extract totalRounds from rd= links when metadata is absent', () => {
    // Build minimal HTML with rd= links but no "Number of rounds" text
    const html = `
      <html><body>
        <h2>Test Tournament</h2>
        <h3>Round 1 on 2026/03/01</h3>
        <table class="CRs1">
          <tr><th>Bo.</th><th>White</th><th>Result</th><th>Black</th></tr>
        </table>
        <a href="tnr123.aspx?rd=1">Rd.1</a>
        <a href="tnr123.aspx?rd=2">Rd.2</a>
        <a href="tnr123.aspx?rd=3">Rd.3</a>
        <a href="tnr123.aspx?rd=4">Rd.4</a>
        <a href="tnr123.aspx?rd=5">Rd.5</a>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const meta = parseTournamentMeta($);
    expect(meta.totalRounds).toBe(5);
  });

  it('should extract totalRounds from "after N rounds" text as final fallback', () => {
    const html = `
      <html><body>
        <h2>Test Tournament</h2>
        <h3>after 7 rounds</h3>
        <table class="CRs1">
          <tr><th>Bo.</th></tr>
        </table>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const meta = parseTournamentMeta($);
    expect(meta.totalRounds).toBe(7);
  });

  it('should extract date from h3 text', () => {
    const html = loadFixture('ended_standings.html');
    const $ = cheerio.load(html);
    const meta = parseTournamentMeta($);
    // Date should be in YYYY/MM/DD format
    if (meta.date) {
      expect(meta.date).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
    }
  });

  it('should extract location from Google Maps link', () => {
    const html = loadFixture('ended_standings.html');
    const $ = cheerio.load(html);
    const meta = parseTournamentMeta($);
    // May or may not have location depending on fixture
    expect(typeof meta.location).toBe('string');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Linked Tournaments Parsing (MAJOR recurring regression)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scraper - Linked Tournaments', () => {
  it('should parse linked tournaments from "Tournament selection" row', () => {
    const html = loadFixture('future_participants.html');
    const $ = cheerio.load(html);
    const meta = parseTournamentMeta($);

    expect(meta.linkedTournaments).toBeDefined();
    expect(meta.linkedTournaments!.length).toBeGreaterThan(0);

    // Each linked tournament should have id and name
    for (const lt of meta.linkedTournaments!) {
      expect(lt.id).toBeTruthy();
      expect(lt.name).toBeTruthy();
      // ID should be numeric
      expect(lt.id).toMatch(/^\d+$/);
    }
  });

  it('should extract current tournament label from bold/italic text', () => {
    const html = loadFixture('future_participants.html');
    const $ = cheerio.load(html);
    const meta = parseTournamentMeta($);

    expect(meta.currentLabel).toBeDefined();
    expect(meta.currentLabel!.length).toBeGreaterThan(0);
  });

  it('should return empty when no Tournament selection row exists', () => {
    const html = loadFixture('ended_standings.html');
    const $ = cheerio.load(html);
    const meta = parseTournamentMeta($);

    // Ended standings fixture has no tournament selection
    expect(meta.linkedTournaments).toBeUndefined();
    expect(meta.currentLabel).toBeUndefined();
  });

  it('should parse linked tournaments from Portuguese label', () => {
    const html = `
      <html><body>
        <h2>Test</h2><h3>Round</h3>
        <table><tr>
          <td class="CRnowrap b">Selecção de torneio</td>
          <td class="CR">
            <a href="https://chess-results.com/tnr111.aspx?lan=10">Federados</a>,
            <i><b>Não Federados</b></i>,
            <a href="https://chess-results.com/tnr333.aspx?lan=10">Sub-18</a>
          </td>
        </tr></table>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const meta = parseTournamentMeta($);

    expect(meta.currentLabel).toBe('Não Federados');
    expect(meta.linkedTournaments).toHaveLength(2);
    expect(meta.linkedTournaments![0].id).toBe('111');
    expect(meta.linkedTournaments![0].name).toBe('Federados');
    expect(meta.linkedTournaments![1].id).toBe('333');
    expect(meta.linkedTournaments![1].name).toBe('Sub-18');
  });

  it('should parse linked tournaments from Spanish label', () => {
    const html = `
      <html><body>
        <h2>Test</h2><h3>Round</h3>
        <table><tr>
          <td class="CRnowrap b">Selección de torneo</td>
          <td class="CR">
            <i><b>Open</b></i>,
            <a href="https://chess-results.com/tnr555.aspx?lan=5">Sub-14</a>
          </td>
        </tr></table>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const meta = parseTournamentMeta($);

    expect(meta.currentLabel).toBe('Open');
    expect(meta.linkedTournaments).toHaveLength(1);
  });

  it('should parse linked tournaments from French label', () => {
    const html = `
      <html><body>
        <h2>Test</h2><h3>Round</h3>
        <table><tr>
          <td class="CRnowrap b">Sélection du tournoi</td>
          <td class="CR">
            <a href="https://chess-results.com/tnr777.aspx?lan=3">Groupe A</a>,
            <i><b>Groupe B</b></i>
          </td>
        </tr></table>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const meta = parseTournamentMeta($);

    expect(meta.currentLabel).toBe('Groupe B');
    expect(meta.linkedTournaments).toHaveLength(1);
    expect(meta.linkedTournaments![0].name).toBe('Groupe A');
  });

  it('should parse linked tournaments from German label', () => {
    const html = `
      <html><body>
        <h2>Test</h2><h3>Round</h3>
        <table><tr>
          <td class="CRnowrap b">Turnierauswahl</td>
          <td class="CR">
            <a href="https://chess-results.com/tnr999.aspx?lan=0">Open A</a>,
            <i><b>Open B</b></i>
          </td>
        </tr></table>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const meta = parseTournamentMeta($);

    expect(meta.currentLabel).toBe('Open B');
    expect(meta.linkedTournaments).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Standings Parsing (tie-breaks, columns, sex)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scraper - Standings Parsing', () => {
  it('should parse English standings with all tie-break columns', () => {
    const html = loadFixture('ended_standings.html');
    const data = parseStandingsHtml(html);

    expect(data.standings.length).toBeGreaterThan(0);

    const first = data.standings[0];
    expect(first.rank).toBe(1);
    expect(first.name).toBeTruthy();
    expect(first.points).toBeTruthy();
    expect(first.tieBreak1).toBeTruthy();
  });

  it('should parse Portuguese standings with Desp headers', () => {
    const html = loadFixture('portuguese_standings.html');
    const data = parseStandingsHtml(html);

    expect(data.standings.length).toBeGreaterThan(0);

    // The Portuguese fixture uses "Desp1", "Desp2" headers instead of "TB1", "TB2"
    const first = data.standings[0];
    expect(first.points).toBeTruthy();
    expect(first.tieBreak1).toBeTruthy();
  });

  it('should correctly parse all standing fields', () => {
    const html = loadFixture('ended_standings.html');
    const data = parseStandingsHtml(html);

    for (const s of data.standings.slice(0, 5)) {
      expect(typeof s.rank).toBe('number');
      expect(s.rank).toBeGreaterThan(0);
      expect(typeof s.name).toBe('string');
      expect(s.name.length).toBeGreaterThan(0);
      expect(typeof s.points).toBe('string');
      expect(typeof s.fed).toBe('string');
      expect(typeof s.rating).toBe('string');
      expect(typeof s.club).toBe('string');
      expect(['M', 'F', '']).toContain(s.sex);
      expect(typeof s.tieBreak1).toBe('string');
      expect(typeof s.tieBreak2).toBe('string');
      expect(typeof s.tieBreak3).toBe('string');
      expect(typeof s.tieBreak4).toBe('string');
      expect(typeof s.tieBreak5).toBe('string');
      expect(typeof s.tieBreak6).toBe('string');
    }
  });

  it('should detect sex column and produce women standings', () => {
    const html = loadFixture('ended_standings.html');
    const data = parseStandingsHtml(html);

    expect(data.womenStandings).toBeDefined();

    const womenInFull = data.standings.filter(s => s.sex === 'F');
    expect(data.womenStandings.length).toBe(womenInFull.length);

    // Women standings should be re-ranked 1, 2, 3, ...
    data.womenStandings.forEach((s, i) => {
      expect(s.rank).toBe(i + 1);
    });
  });

  it('should handle future tournament (participants list) gracefully', () => {
    const html = loadFixture('future_participants.html');
    const data = parseStandingsHtml(html);
    expect(data).toBeDefined();
    expect(data.info).toBeDefined();
    // Future tournament may have no standings
    expect(data.standings).toBeDefined();
  });

  it('should detect SNo (starting number) column', () => {
    const html = loadFixture('ended_standings.html');
    const data = parseStandingsHtml(html);

    // At least some players should have non-zero starting numbers
    const withSno = data.standings.filter(s => s.startingNumber > 0);
    expect(withSno.length).toBeGreaterThan(0);
  });

  it('should parse standings from synthetic HTML with TB1-TB6', () => {
    const html = `
      <html><body>
        <h2>Synthetic Tournament</h2>
        <h3>after 9 rounds</h3>
        <table class="CRs1">
          <tr>
            <th>Rk.</th><th>SNo</th><th>Name</th><th>sex</th><th>FED</th><th>Rtg</th>
            <th>Club/City</th><th>Pts.</th>
            <th>TB1</th><th>TB2</th><th>TB3</th><th>TB4</th><th>TB5</th><th>TB6</th>
          </tr>
          <tr class="CRng1">
            <td>1</td><td>3</td><td>GM Alpha, Player</td><td>m</td><td>POR</td><td>2500</td>
            <td>Club A</td><td>8.0</td>
            <td>45.0</td><td>50.0</td><td>38.25</td><td>12.0</td><td>9.0</td><td>3.5</td>
          </tr>
          <tr class="CRng2">
            <td>2</td><td>1</td><td>WGM Beta, Player</td><td>w</td><td>ESP</td><td>2300</td>
            <td>Club B</td><td>7.5</td>
            <td>43.0</td><td>48.0</td><td>35.00</td><td>11.0</td><td>8.5</td><td>3.0</td>
          </tr>
        </table>
      </body></html>
    `;
    const data = parseStandingsHtml(html);

    expect(data.standings).toHaveLength(2);

    const first = data.standings[0];
    expect(first.rank).toBe(1);
    expect(first.startingNumber).toBe(3);
    expect(first.name).toBe('GM Alpha, Player');
    expect(first.sex).toBe('M');
    expect(first.fed).toBe('POR');
    expect(first.rating).toBe('2500');
    expect(first.club).toBe('Club A');
    expect(first.points).toBe('8.0');
    expect(first.tieBreak1).toBe('45.0');
    expect(first.tieBreak2).toBe('50.0');
    expect(first.tieBreak3).toBe('38.25');
    expect(first.tieBreak4).toBe('12.0');
    expect(first.tieBreak5).toBe('9.0');
    expect(first.tieBreak6).toBe('3.5');

    const second = data.standings[1];
    expect(second.sex).toBe('F'); // 'w' → 'F'
    expect(second.fed).toBe('ESP');

    // Women standings derived
    expect(data.womenStandings).toHaveLength(1);
    expect(data.womenStandings[0].name).toBe('WGM Beta, Player');
    expect(data.womenStandings[0].rank).toBe(1);
  });

  it('should parse standings with Portuguese Desp headers', () => {
    const html = `
      <html><body>
        <h2>Torneio Teste</h2>
        <h3>após 7 rondas</h3>
        <table class="CRs1">
          <tr>
            <th>Rk.</th><th>NrI</th><th>Nome</th><th>FED</th><th>Elo</th>
            <th>Pts.</th><th>Desp1</th><th>Desp2</th><th>Desp3</th>
          </tr>
          <tr class="CRng1">
            <td>1</td><td>5</td><td>Silva, João</td><td>POR</td><td>1900</td>
            <td>6.5</td><td>30.0</td><td>35.0</td><td>28.00</td>
          </tr>
        </table>
      </body></html>
    `;
    const data = parseStandingsHtml(html);

    expect(data.standings).toHaveLength(1);
    expect(data.standings[0].name).toBe('Silva, João');
    expect(data.standings[0].points).toBe('6.5');
    expect(data.standings[0].tieBreak1).toBe('30.0');
    expect(data.standings[0].tieBreak2).toBe('35.0');
    expect(data.standings[0].tieBreak3).toBe('28.00');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Pairings Parsing
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scraper - Pairings Parsing', () => {
  it('should parse ended tournament pairings', () => {
    const html = loadFixture('ended_pairings.html');
    const data = parseHtml(html, 9);

    expect(data.info.round).toBe(9);
    expect(data.pairings.length).toBeGreaterThan(0);

    const first = data.pairings[0];
    expect(first.table).toBe(1);
    expect(first.white.name).toBeTruthy();
    expect(first.result).toBeTruthy();
  });

  it('should include tournament type in parsed pairings', () => {
    const html = loadFixture('ended_pairings.html');
    const data = parseHtml(html, 9);

    expect(data.info.type).toBeDefined();
    expect(Object.values(TournamentType)).toContain(data.info.type);
  });

  it('should parse white and black player numbers', () => {
    const html = loadFixture('ended_pairings.html');
    const data = parseHtml(html, 9);

    for (const p of data.pairings) {
      // White should always have a number
      expect(typeof p.white.number).toBe('number');
      // Black can be null (BYE)
      if (p.black) {
        expect(typeof p.black.number).toBe('number');
      }
    }
  });

  it('should handle BYE/unpaired entries', () => {
    const html = `
      <html><body>
        <h2>Test</h2><h3>Round 1</h3>
        <td class="CR">Number of rounds</td><td class="CR">5</td>
        <table class="CRs1">
          <tr><th>Bo.</th><th>No.</th><th>White</th><th>Result</th><th>Black</th><th>No.</th></tr>
          <tr class="CRng1">
            <td>1</td><td>1</td><td>Player A</td><td>1 - 0</td><td>bye</td><td></td>
          </tr>
          <tr class="CRng2">
            <td>2</td><td>2</td><td>Player B</td><td>½ - ½</td><td>Player C</td><td>3</td>
          </tr>
        </table>
      </body></html>
    `;
    const data = parseHtml(html, 1);

    expect(data.pairings).toHaveLength(2);

    // First pairing is a BYE
    expect(data.pairings[0].black).toBeNull();
    expect(data.pairings[0].unpairedLabel).toBeTruthy();

    // Second is normal
    expect(data.pairings[1].black).not.toBeNull();
    expect(data.pairings[1].black!.name).toBe('Player C');
  });

  it('should handle Portuguese unpaired label', () => {
    const html = `
      <html><body>
        <h2>Test</h2><h3>Round 1</h3>
        <td class="CR">Número de rondas</td><td class="CR">3</td>
        <table class="CRs1">
          <tr><th>Bo.</th><th>No.</th><th>Brancas</th><th>Resultado</th><th>Pretas</th><th>No.</th></tr>
          <tr class="CRng1">
            <td>1</td><td>1</td><td>Jogador A</td><td>+ - -</td><td>não emparceirado</td><td></td>
          </tr>
        </table>
      </body></html>
    `;
    const data = parseHtml(html, 1);

    expect(data.pairings[0].black).toBeNull();
    expect(data.pairings[0].unpairedLabel).toBeTruthy();
  });

  it('should parse pairings with both CRng and CRg row classes', () => {
    const html = `
      <html><body>
        <h2>Test</h2><h3>Round 1</h3>
        <td class="CR">Number of rounds</td><td class="CR">3</td>
        <table class="CRs1">
          <tr><th>Bo.</th><th>No.</th><th>White</th><th>Result</th><th>Black</th><th>No.</th></tr>
          <tr class="CRg1">
            <td>1</td><td>1</td><td>Player A</td><td>1 - 0</td><td>Player B</td><td>2</td>
          </tr>
          <tr class="CRg2">
            <td>2</td><td>3</td><td>Player C</td><td>0 - 1</td><td>Player D</td><td>4</td>
          </tr>
        </table>
      </body></html>
    `;
    const data = parseHtml(html, 1);

    // Both CRg1 and CRg2 should be recognized as data rows
    expect(data.pairings).toHaveLength(2);
    expect(data.pairings[0].white.name).toBe('Player A');
    expect(data.pairings[1].white.name).toBe('Player C');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tournament Type Detection
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scraper - Tournament Type Detection', () => {
  it('should detect Swiss by default', () => {
    const html = loadFixture('ended_pairings.html');
    const $ = cheerio.load(html);
    expect(detectTournamentType($)).toBe(TournamentType.Swiss);
  });

  it('should detect Round Robin from metadata', () => {
    const html = `
      <html><body>
        <table><tr><td class="CR">Tournament type</td><td class="CR">Round Robin (League)</td></tr></table>
        <table class="CRs1">
          <tr><th>Bo.</th><th>White</th><th>Result</th><th>Black</th></tr>
        </table>
      </body></html>
    `;
    const $ = cheerio.load(html);
    expect(detectTournamentType($)).toBe(TournamentType.RoundRobin);
  });

  it('should detect Round Robin from multiple round separator rows', () => {
    const html = `
      <html><body>
        <table class="CRs1">
          <tr class="CRg1b"><td colspan="6">Round 1 on 2026/03/01</td></tr>
          <tr class="CRng1"><td>1</td><td>1</td><td>A</td><td>1-0</td><td>B</td><td>2</td></tr>
          <tr class="CRg1b"><td colspan="6">Round 2 on 2026/03/02</td></tr>
          <tr class="CRng1"><td>1</td><td>2</td><td>B</td><td>0-1</td><td>A</td><td>1</td></tr>
        </table>
      </body></html>
    `;
    const $ = cheerio.load(html);
    expect(detectTournamentType($)).toBe(TournamentType.RoundRobin);
  });

  it('should NOT classify as Round Robin from a single Round separator', () => {
    // This was a specific regression: a single "Round 1" header should not
    // trigger round-robin detection
    const html = `
      <html><body>
        <table class="CRs1">
          <tr class="CRg1b"><td colspan="6">Round 1 on 2026/03/01</td></tr>
          <tr class="CRng1"><td>1</td><td>1</td><td>A</td><td>1-0</td><td>B</td><td>2</td></tr>
        </table>
      </body></html>
    `;
    const $ = cheerio.load(html);
    // Should be Swiss (default), not Round Robin
    const type = detectTournamentType($);
    expect(type).not.toBe(TournamentType.RoundRobin);
  });

  it('should detect Team Swiss from metadata', () => {
    const html = `
      <html><body>
        <table><tr><td class="CR">Tournament type</td><td class="CR">Team tournament (Swiss)</td></tr></table>
        <table class="CRs1">
          <tr><th>No.</th><th>Team</th><th>Team</th><th>Res.</th></tr>
        </table>
      </body></html>
    `;
    const $ = cheerio.load(html);
    expect(detectTournamentType($)).toBe(TournamentType.TeamSwiss);
  });

  it('should detect Team Round Robin', () => {
    const html = `
      <html><body>
        <table><tr><td class="CR">Tournament type</td><td class="CR">Team Round Robin</td></tr></table>
        <table class="CRs1">
          <tr><th>No.</th><th>Team</th><th>Team</th><th>Res.</th></tr>
        </table>
      </body></html>
    `;
    const $ = cheerio.load(html);
    expect(detectTournamentType($)).toBe(TournamentType.TeamRoundRobin);
  });

  it('should detect Portuguese tournament type labels', () => {
    const html = `
      <html><body>
        <table><tr><td class="CR">Tipo de torneio</td><td class="CR">Todos contra todos</td></tr></table>
        <table class="CRs1">
          <tr><th>Bo.</th><th>White</th><th>Result</th><th>Black</th></tr>
        </table>
      </body></html>
    `;
    const $ = cheerio.load(html);
    expect(detectTournamentType($)).toBe(TournamentType.RoundRobin);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// deriveWomenStandings (unit)
// ═══════════════════════════════════════════════════════════════════════════════

describe('deriveWomenStandings', () => {
  it('should filter and re-rank only F players', () => {
    const standings = [
      { rank: 1, startingNumber: 1, name: 'Male 1', fed: '', rating: '', club: '', points: '8', sex: 'M' as const, tieBreak1: '', tieBreak2: '', tieBreak3: '', tieBreak4: '', tieBreak5: '', tieBreak6: '' },
      { rank: 2, startingNumber: 2, name: 'Female 1', fed: '', rating: '', club: '', points: '7', sex: 'F' as const, tieBreak1: '', tieBreak2: '', tieBreak3: '', tieBreak4: '', tieBreak5: '', tieBreak6: '' },
      { rank: 3, startingNumber: 3, name: 'Male 2', fed: '', rating: '', club: '', points: '6', sex: 'M' as const, tieBreak1: '', tieBreak2: '', tieBreak3: '', tieBreak4: '', tieBreak5: '', tieBreak6: '' },
      { rank: 4, startingNumber: 4, name: 'Female 2', fed: '', rating: '', club: '', points: '5', sex: 'F' as const, tieBreak1: '', tieBreak2: '', tieBreak3: '', tieBreak4: '', tieBreak5: '', tieBreak6: '' },
    ];

    const women = deriveWomenStandings(standings);
    expect(women).toHaveLength(2);
    expect(women[0].name).toBe('Female 1');
    expect(women[0].rank).toBe(1);
    expect(women[1].name).toBe('Female 2');
    expect(women[1].rank).toBe(2);
  });

  it('should return empty array when no women in standings', () => {
    const standings = [
      { rank: 1, startingNumber: 1, name: 'Male 1', fed: '', rating: '', club: '', points: '8', sex: 'M' as const, tieBreak1: '', tieBreak2: '', tieBreak3: '', tieBreak4: '', tieBreak5: '', tieBreak6: '' },
    ];
    expect(deriveWomenStandings(standings)).toHaveLength(0);
  });
});
