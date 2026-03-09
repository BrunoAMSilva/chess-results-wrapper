import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { parseHtml, parseBoardPairingsHtml, parseStandingsHtml } from '../../src/lib/scraper';
import { detectTournamentType } from '../../src/lib/strategies/index';
import { parseTournamentMeta, parseTeamBoardPairings, parseTeamStandings, parseTeamPairings } from '../../src/lib/strategies/base';
import { TournamentType } from '../../src/lib/types';
import fs from 'fs';
import path from 'path';

const fixturesDir = path.join(__dirname, '../../tests/fixtures');

function loadFixture(filename: string): string {
  return fs.readFileSync(path.join(fixturesDir, filename), 'utf-8');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tournament Detection (1322107 — Team Swiss)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Team Tournament Detection', () => {
  it('detects TeamSwiss from art=2 pairings page', () => {
    const html = loadFixture('team_pairings_r1.html');
    const $ = cheerio.load(html);
    const type = detectTournamentType($);
    expect(type).toBe(TournamentType.TeamSwiss);
  });

  it('detects TeamSwiss from art=3 board pairings page', () => {
    const html = loadFixture('team_board_pairings_r1.html');
    const $ = cheerio.load(html);
    const type = detectTournamentType($);
    expect(type).toBe(TournamentType.TeamSwiss);
  });

  it('detects tournament type from art=1 standings page', () => {
    const html = loadFixture('team_standings.html');
    const $ = cheerio.load(html);
    const type = detectTournamentType($);
    expect(type).toBe(TournamentType.TeamSwiss);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tournament Metadata
// ═══════════════════════════════════════════════════════════════════════════════

describe('Team Tournament Metadata', () => {
  it('extracts tournament name', () => {
    const html = loadFixture('team_pairings_r1.html');
    const $ = cheerio.load(html);
    const meta = parseTournamentMeta($);
    expect(meta.name).toContain('Campeonato Distrital por Equipas');
  });

  it('extracts totalRounds capped to available rounds from links', () => {
    const html = loadFixture('team_pairings_r1.html');
    const $ = cheerio.load(html);
    const meta = parseTournamentMeta($);
    // Metadata says 8 planned rounds, but rd= links only go up to 5
    expect(meta.totalRounds).toBe(5);
  });

  it('extracts tournament type metadata from meta cell', () => {
    const html = loadFixture('team_pairings_r1.html');
    const $ = cheerio.load(html);
    const meta = parseTournamentMeta($);
    expect(meta.name).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Team Pairings — Art=2 (Team-level results)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Team Pairings (art=2)', () => {
  it('parses team-level pairings from art=2', () => {
    const html = loadFixture('team_pairings_r1.html');
    const data = parseHtml(html, 1);

    expect(data.info.type).toBe(TournamentType.TeamSwiss);
    expect(data.info.round).toBe(1);
    expect(data.teamPairings).toBeDefined();
    expect(data.teamPairings!.length).toBeGreaterThan(0);
    // Individual pairings should be empty for art=2 team format
    expect(data.pairings.length).toBe(0);
  });

  it('has correct team names and results', () => {
    const html = loadFixture('team_pairings_r1.html');
    const data = parseHtml(html, 1);

    const first = data.teamPairings![0];
    expect(first.table).toBe(1);
    expect(first.whiteTeam).toBeTruthy();
    expect(first.blackTeam).toBeTruthy();
    expect(first.result).toBeTruthy();
    // Team results should contain a colon separator (e.g., "0:4")
    expect(first.result).toMatch(/\d+:\d+/);
  });

  it('parses multiple team matches', () => {
    const html = loadFixture('team_pairings_r1.html');
    const data = parseHtml(html, 1);

    expect(data.teamPairings!.length).toBeGreaterThanOrEqual(10);

    // Table numbers should be sequential
    const tables = data.teamPairings!.map(tp => tp.table);
    for (let i = 1; i < tables.length; i++) {
      expect(tables[i]).toBe(tables[i - 1] + 1);
    }
  });

  it('art=2 team pairings have empty boards array', () => {
    const html = loadFixture('team_pairings_r1.html');
    const data = parseHtml(html, 1);

    for (const tp of data.teamPairings!) {
      expect(tp.boards).toEqual([]);
    }
  });

  it('parses round 2 pairings with different matchups', () => {
    const html1 = loadFixture('team_pairings_r1.html');
    const html2 = loadFixture('team_pairings_r2.html');
    const data1 = parseHtml(html1, 1);
    const data2 = parseHtml(html2, 2);

    expect(data1.info.round).toBe(1);
    expect(data2.info.round).toBe(2);
    expect(data1.teamPairings!.length).toBeGreaterThan(0);
    expect(data2.teamPairings!.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Board Pairings — Art=3 (Individual board matchups within team matches)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Board Pairings (art=3)', () => {
  it('parses board-level pairings from art=3', () => {
    const html = loadFixture('team_board_pairings_r1.html');
    const data = parseBoardPairingsHtml(html, 1);

    expect(data.info.type).toBe(TournamentType.TeamSwiss);
    expect(data.info.round).toBe(1);
    expect(data.teamPairings).toBeDefined();
    expect(data.teamPairings!.length).toBeGreaterThan(0);
  });

  it('team pairings have populated boards arrays', () => {
    const html = loadFixture('team_board_pairings_r1.html');
    const data = parseBoardPairingsHtml(html, 1);

    for (const tp of data.teamPairings!) {
      expect(tp.boards.length).toBeGreaterThan(0);
    }
  });

  it('board pairings have correct player data', () => {
    const html = loadFixture('team_board_pairings_r1.html');
    const data = parseBoardPairingsHtml(html, 1);

    const firstMatch = data.teamPairings![0];
    expect(firstMatch.boards.length).toBe(4); // 4 boards per team match

    const firstBoard = firstMatch.boards[0];
    expect(firstBoard.table).toBe(1); // board 1
    expect(firstBoard.white.name).toBeTruthy();
    expect(firstBoard.result).toBeTruthy();
  });

  it('extracts team names from match headers', () => {
    const html = loadFixture('team_board_pairings_r1.html');
    const data = parseBoardPairingsHtml(html, 1);

    const first = data.teamPairings![0];
    expect(first.whiteTeam).toBeTruthy();
    expect(first.blackTeam).toBeTruthy();
    expect(first.result).toBeTruthy();
  });

  it('also produces flat individual pairings', () => {
    const html = loadFixture('team_board_pairings_r1.html');
    const data = parseBoardPairingsHtml(html, 1);

    // Individual pairings are the flattened board pairings
    expect(data.pairings.length).toBeGreaterThan(0);
    const totalBoards = data.teamPairings!.reduce((sum, tp) => sum + tp.boards.length, 0);
    expect(data.pairings.length).toBe(totalBoards);
  });

  it('individual board results show correct format', () => {
    const html = loadFixture('team_board_pairings_r1.html');
    const data = parseBoardPairingsHtml(html, 1);

    for (const p of data.pairings) {
      expect(p.white.name).toBeTruthy();
      // Result should be in format like "0 - 1", "1 - 0", "½ - ½", "- - +"
      if (p.result) {
        expect(p.result).toMatch(/[-+½01]/);
      }
    }
  });

  it('handles all matches in the round', () => {
    const html = loadFixture('team_board_pairings_r1.html');
    const $ = cheerio.load(html);
    const teamPairings = parseTeamBoardPairings($, 1);

    // Tournament 1322107 has 12 team matches in round 1 (one team has bye)
    expect(teamPairings.length).toBe(12);

    // Each match has 4 boards
    for (const tp of teamPairings) {
      expect(tp.boards.length).toBe(4);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Team Standings — Art=1 (Team-composition with individual players)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Team Standings (art=1)', () => {
  it('parses team standings from art=1', () => {
    const html = loadFixture('team_standings.html');
    const data = parseStandingsHtml(html);

    expect(data.info.type).toBe(TournamentType.TeamSwiss);
    expect(data.teamStandings).toBeDefined();
    expect(data.teamStandings!.length).toBeGreaterThan(0);
  });

  it('has correct team ranking data', () => {
    const html = loadFixture('team_standings.html');
    const data = parseStandingsHtml(html);

    const first = data.teamStandings![0];
    expect(first.rank).toBe(1);
    expect(first.name).toBeTruthy();
    expect(first.ratingAvg).toBeGreaterThan(0);
  });

  it('has individual players within each team', () => {
    const html = loadFixture('team_standings.html');
    const data = parseStandingsHtml(html);

    for (const team of data.teamStandings!) {
      expect(team.players.length).toBeGreaterThan(0);
      for (const player of team.players) {
        expect(player.name).toBeTruthy();
        expect(player.board).toBeGreaterThan(0);
      }
    }
  });

  it('extracts captain and tie-break info', () => {
    const html = loadFixture('team_standings.html');
    const data = parseStandingsHtml(html);

    const first = data.teamStandings![0];
    expect(first.tieBreak1).toBeTruthy();
    // Captain may or may not be present
    if (first.captain) {
      expect(typeof first.captain).toBe('string');
    }
  });

  it('parses all 25 teams', () => {
    const html = loadFixture('team_standings.html');
    const data = parseStandingsHtml(html);

    expect(data.teamStandings!.length).toBe(25);
  });

  it('extracts player ratings and federation', () => {
    const html = loadFixture('team_standings.html');
    const data = parseStandingsHtml(html);

    const firstTeam = data.teamStandings![0];
    const firstPlayer = firstTeam.players[0];
    expect(firstPlayer.rating).toBeTruthy();
    expect(firstPlayer.fed).toBeTruthy();
  });

  it('also creates individual standings from team composition', () => {
    const html = loadFixture('team_standings.html');
    const data = parseStandingsHtml(html);

    // Individual standings should be derived from team players
    expect(data.standings.length).toBeGreaterThan(0);
    // Each standing has the team name as club
    const first = data.standings[0];
    expect(first.name).toBeTruthy();
    expect(first.club).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Team Standings — Art=4 (Individual rankings with Team column)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Team Standings Crosstable (art=4)', () => {
  it('parses individual rankings from art=4', () => {
    const html = loadFixture('team_standings_crosstable.html');
    const data = parseStandingsHtml(html);

    expect(data.info.type).toBe(TournamentType.TeamSwiss);
    expect(data.standings.length).toBeGreaterThan(0);
  });

  it('has correct player data with points and rating', () => {
    const html = loadFixture('team_standings_crosstable.html');
    const data = parseStandingsHtml(html);

    const first = data.standings[0];
    expect(first.rank).toBe(1);
    expect(first.name).toBeTruthy();
    expect(first.points).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Direct parser function tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseTeamBoardPairings', () => {
  it('correctly groups boards under team matches', () => {
    const html = loadFixture('team_board_pairings_r1.html');
    const $ = cheerio.load(html);
    const result = parseTeamBoardPairings($, 1);

    expect(result.length).toBeGreaterThan(0);
    for (const tp of result) {
      expect(tp.whiteTeam).toBeTruthy();
      expect(tp.boards.length).toBeGreaterThan(0);
    }
  });

  it('returns empty for non-matching round', () => {
    const html = loadFixture('team_board_pairings_r1.html');
    const $ = cheerio.load(html);
    // Round 99 shouldn't exist
    const result = parseTeamBoardPairings($, 99);
    expect(result.length).toBe(0);
  });
});

describe('parseTeamStandings', () => {
  it('parses team standings structure correctly', () => {
    const html = loadFixture('team_standings.html');
    const $ = cheerio.load(html);
    const result = parseTeamStandings($);

    expect(result.length).toBe(25);
    expect(result[0].rank).toBe(1);
    expect(result[0].players.length).toBeGreaterThan(0);
  });

  it('returns empty for non-team standings pages', () => {
    const html = loadFixture('ended_standings.html');
    const $ = cheerio.load(html);
    const result = parseTeamStandings($);
    expect(result.length).toBe(0);
  });
});
