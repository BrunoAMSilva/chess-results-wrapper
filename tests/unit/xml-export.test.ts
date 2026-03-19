import { describe, it, expect } from 'vitest';
import { buildRefereeExportXml, invertResult, mapResult } from '../../src/lib/xml-export';
import type { Pairing, TeamPairing } from '../../src/lib/types';

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function parseLine(xml: string, tag: string): Record<string, string>[] {
  const re = new RegExp(`<${tag}\\s+(.*?)\\s*/>`, 'g');
  const entries: Record<string, string>[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrs: Record<string, string> = {};
    const attrRe = /(\w+)="([^"]*)"/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(m[1])) !== null) {
      attrs[a[1]] = a[2];
    }
    entries.push(attrs);
  }
  return entries;
}

function makeBoard(
  table: number,
  whiteNum: number,
  blackNum: number | null,
  result = '',
): Pairing {
  return {
    table,
    white: { name: `Player ${whiteNum}`, number: whiteNum },
    black: blackNum != null ? { name: `Player ${blackNum}`, number: blackNum } : null,
    result,
  };
}

function makeTeamMatch(
  matchTable: number,
  homeTeam: string,
  awayTeam: string,
  boards: Array<{ homeNum: number; awayNum: number }>,
): TeamPairing {
  return {
    table: matchTable,
    whiteTeam: homeTeam,
    blackTeam: awayTeam,
    result: '',
    boards: boards.map((b, i) => makeBoard(matchTable * 100 + (i + 1), b.homeNum, b.awayNum)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Unit: invertResult / mapResult
// ═══════════════════════════════════════════════════════════════════════════════

describe('invertResult', () => {
  it('should invert results symmetrically', () => {
    expect(invertResult('1-0')).toBe('0-1');
    expect(invertResult('0-1')).toBe('1-0');
    expect(invertResult('1-0F')).toBe('0-1F');
    expect(invertResult('0-1F')).toBe('1-0F');
    expect(invertResult('1/2')).toBe('1/2');
    expect(invertResult('0-0F')).toBe('0-0F');
    expect(invertResult('')).toBe('');
  });
});

describe('mapResult', () => {
  it('should convert raw referee format to Swiss-Manager format', () => {
    expect(mapResult('1-0')).toBe('1-0');
    expect(mapResult('½-½')).toBe('1/2');
    expect(mapResult('+:-')).toBe('1-0F');
    expect(mapResult('-:+')).toBe('0-1F');
    expect(mapResult('-:-')).toBe('0-0F');
    expect(mapResult('unknown')).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Individual tournament XML export
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildRefereeExportXml — individual tournament', () => {
  const nationalIds: Record<number, string> = {
    1: '50001',
    2: '50002',
    3: '50003',
    10: '50010',
    11: '50011',
    13: '50013',
  };

  it('should produce Results section with player national IDs', () => {
    const pairings: Pairing[] = [
      makeBoard(1, 1, 10),
      makeBoard(2, 11, 2),
      makeBoard(3, 3, 13),
    ];
    const resultsMap: Record<number, string> = {
      1: '1-0',
      2: '½-½',
      3: '0-1',
    };

    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [],
      allPairings: pairings,
      resultsMap,
      nationalIds,
    });

    const results = parseLine(xml, 'Result');
    expect(results).toHaveLength(3);

    // Board 1: White=player 1 (national 50001), Black=player 10 (national 50010)
    expect(results[0].PlayerWhiteId).toBe('50001');
    expect(results[0].PlayerBlackId).toBe('50010');
    expect(results[0].Res).toBe('1-0');

    // Board 2: draw
    expect(results[1].PlayerWhiteId).toBe('50011');
    expect(results[1].PlayerBlackId).toBe('50002');
    expect(results[1].Res).toBe('1/2');

    // Board 3: Black wins
    expect(results[2].Res).toBe('0-1');
  });

  it('should NOT produce TeamCompositions for individual tournament', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [],
      allPairings: [makeBoard(1, 1, 10)],
      resultsMap: { 1: '1-0' },
      nationalIds,
    });

    expect(xml).not.toContain('<TeamCompositions>');
    expect(xml).not.toContain('<TeamComposition ');
  });

  it('should handle BYE (no opponent) with PlayerBlackId="0"', () => {
    const xml = buildRefereeExportXml({
      round: 3,
      teamPairings: [],
      allPairings: [makeBoard(5, 6, null)],
      resultsMap: { 5: '+:-' },
      nationalIds: { 6: '50006' },
    });

    const results = parseLine(xml, 'Result');
    expect(results).toHaveLength(1);
    expect(results[0].PlayerWhiteId).toBe('50006');
    expect(results[0].PlayerBlackId).toBe('0');
    expect(results[0].Res).toBe('1-0F');
  });

  it('should fall back to starting number when national ID is missing', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [],
      allPairings: [makeBoard(1, 99, 88)],
      resultsMap: { 1: '1-0' },
      nationalIds: {}, // no national IDs
    });

    const results = parseLine(xml, 'Result');
    expect(results[0].PlayerWhiteId).toBe('99');
    expect(results[0].PlayerBlackId).toBe('88');
  });

  it('should handle all result types', () => {
    const pairings: Pairing[] = [
      makeBoard(1, 1, 2),
      makeBoard(2, 3, 4),
      makeBoard(3, 5, 6),
      makeBoard(4, 7, 8),
      makeBoard(5, 9, 10),
      makeBoard(6, 11, 12),
    ];
    const resultsMap: Record<number, string> = {
      1: '1-0',
      2: '0-1',
      3: '½-½',
      4: '+:-',
      5: '-:+',
      6: '-:-',
    };

    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [],
      allPairings: pairings,
      resultsMap,
      nationalIds: {},
    });

    const results = parseLine(xml, 'Result');
    expect(results[0].Res).toBe('1-0');
    expect(results[1].Res).toBe('0-1');
    expect(results[2].Res).toBe('1/2');
    expect(results[3].Res).toBe('1-0F');
    expect(results[4].Res).toBe('0-1F');
    expect(results[5].Res).toBe('0-0F');
  });

  it('should produce empty Res when no referee result exists', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [],
      allPairings: [makeBoard(1, 1, 2)],
      resultsMap: {}, // no results entered
      nationalIds: {},
    });

    const results = parseLine(xml, 'Result');
    expect(results[0].Res).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Team tournament XML export
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildRefereeExportXml — team tournament', () => {
  // 2 teams: "Alpha Club" and "Beta Club"
  // Alpha Club is home (whiteTeam), Beta Club is away (blackTeam)
  // Board 1 (odd): home has White → Alpha player has White pieces
  // Board 2 (even): away has White → Beta player has White pieces
  // Board 3 (odd): home has White → Alpha player has White pieces
  // Board 4 (even): away has White → Beta player has White pieces

  const homeTeam = 'Alpha Club';
  const awayTeam = 'Beta Club';

  // Home players: SNR 1,2,3,4 → national IDs 50001-50004
  // Away players: SNR 11,12,13,14 → national IDs 60001-60004
  const nationalIds: Record<number, string> = {
    1: '50001', 2: '50002', 3: '50003', 4: '50004',
    11: '60001', 12: '60002', 13: '60003', 14: '60004',
  };

  const teamMatch = makeTeamMatch(1, homeTeam, awayTeam, [
    { homeNum: 1, awayNum: 11 },   // board 1 → table 101
    { homeNum: 2, awayNum: 12 },   // board 2 → table 102
    { homeNum: 3, awayNum: 13 },   // board 3 → table 103
    { homeNum: 4, awayNum: 14 },   // board 4 → table 104
  ]);

  const allPairings: Pairing[] = teamMatch.boards;

  // Referee results from home perspective:
  // Board 1: home (Alpha) won → "1-0"
  // Board 2: home (Alpha) lost → "0-1"
  // Board 3: draw → "½-½"
  // Board 4: home (Alpha) won by forfeit → "+:-"
  const resultsMap: Record<number, string> = {
    101: '1-0',
    102: '0-1',
    103: '½-½',
    104: '+:-',
  };

  it('should produce TeamCompositions section', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [teamMatch],
      allPairings,
      resultsMap,
      nationalIds,
    });

    expect(xml).toContain('<TeamCompositions>');
    expect(xml).toContain('</TeamCompositions>');

    const compositions = parseLine(xml, 'TeamComposition');
    // 4 boards × 2 players = 8 entries
    expect(compositions).toHaveLength(8);
  });

  it('should use national IDs as PlayerId in TeamCompositions', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [teamMatch],
      allPairings,
      resultsMap,
      nationalIds,
    });

    const compositions = parseLine(xml, 'TeamComposition');
    const playerIds = compositions.map(c => c.PlayerId);

    // All 8 entries should use national IDs
    expect(playerIds).toContain('50001'); // home board 1
    expect(playerIds).toContain('60001'); // away board 1
    expect(playerIds).toContain('50002'); // home board 2
    expect(playerIds).toContain('60002'); // away board 2
    expect(playerIds).toContain('50003'); // home board 3
    expect(playerIds).toContain('60003'); // away board 3
    expect(playerIds).toContain('50004'); // home board 4
    expect(playerIds).toContain('60004'); // away board 4
  });

  it('should assign TeamUniqueId = player own team, TeamUniqueId2 = opponent team', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [teamMatch],
      allPairings,
      resultsMap,
      nationalIds,
    });

    const compositions = parseLine(xml, 'TeamComposition');

    // Team IDs are assigned alphabetically: "Alpha Club" = 1, "Beta Club" = 2
    const alphaId = '1';
    const betaId = '2';

    // Home team player entries (board 1,2,3,4 — odd entries: index 0,2,4,6)
    for (const c of compositions) {
      if (['50001', '50002', '50003', '50004'].includes(c.PlayerId)) {
        expect(c.TeamUniqueId).toBe(alphaId);
        expect(c.TeamUniqueId2).toBe(betaId);
      }
      if (['60001', '60002', '60003', '60004'].includes(c.PlayerId)) {
        expect(c.TeamUniqueId).toBe(betaId);
        expect(c.TeamUniqueId2).toBe(alphaId);
      }
    }
  });

  it('should set TeamUniqueIdWhite/Black based on odd/even board color rule', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [teamMatch],
      allPairings,
      resultsMap,
      nationalIds,
    });

    const compositions = parseLine(xml, 'TeamComposition');

    // "Alpha Club" = 1 (home), "Beta Club" = 2 (away)
    const alphaId = '1';
    const betaId = '2';

    // Board 1 (odd): home (Alpha) has White
    const board1 = compositions.filter(c => c.Board === '1');
    expect(board1).toHaveLength(2);
    for (const c of board1) {
      expect(c.TeamUniqueIdWhite).toBe(alphaId);
      expect(c.TeamUniqueIdBlack).toBe(betaId);
    }

    // Board 2 (even): away (Beta) has White
    const board2 = compositions.filter(c => c.Board === '2');
    expect(board2).toHaveLength(2);
    for (const c of board2) {
      expect(c.TeamUniqueIdWhite).toBe(betaId);
      expect(c.TeamUniqueIdBlack).toBe(alphaId);
    }

    // Board 3 (odd): home (Alpha) has White
    const board3 = compositions.filter(c => c.Board === '3');
    for (const c of board3) {
      expect(c.TeamUniqueIdWhite).toBe(alphaId);
      expect(c.TeamUniqueIdBlack).toBe(betaId);
    }

    // Board 4 (even): away (Beta) has White
    const board4 = compositions.filter(c => c.Board === '4');
    for (const c of board4) {
      expect(c.TeamUniqueIdWhite).toBe(betaId);
      expect(c.TeamUniqueIdBlack).toBe(alphaId);
    }
  });

  it('should set Res from each player perspective in TeamCompositions', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [teamMatch],
      allPairings,
      resultsMap,
      nationalIds,
    });

    const compositions = parseLine(xml, 'TeamComposition');

    // Board 1: home won → home Res="1-0", away Res="0-1"
    expect(compositions.find(c => c.PlayerId === '50001')!.Res).toBe('1-0');
    expect(compositions.find(c => c.PlayerId === '60001')!.Res).toBe('0-1');

    // Board 2: home lost → home Res="0-1", away Res="1-0"
    expect(compositions.find(c => c.PlayerId === '50002')!.Res).toBe('0-1');
    expect(compositions.find(c => c.PlayerId === '60002')!.Res).toBe('1-0');

    // Board 3: draw → both Res="1/2"
    expect(compositions.find(c => c.PlayerId === '50003')!.Res).toBe('1/2');
    expect(compositions.find(c => c.PlayerId === '60003')!.Res).toBe('1/2');

    // Board 4: home won by forfeit → home Res="1-0F", away Res="0-1F"
    expect(compositions.find(c => c.PlayerId === '50004')!.Res).toBe('1-0F');
    expect(compositions.find(c => c.PlayerId === '60004')!.Res).toBe('0-1F');
  });

  it('should use national IDs as PlayerWhiteId/PlayerBlackId in Results', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [teamMatch],
      allPairings,
      resultsMap,
      nationalIds,
    });

    const results = parseLine(xml, 'Result');
    expect(results).toHaveLength(4);

    const allIds = results.flatMap(r => [r.PlayerWhiteId, r.PlayerBlackId]);
    // All IDs should be national IDs (5-digit)
    for (const id of allIds) {
      expect(id).toMatch(/^\d{5}$/);
    }
  });

  it('should swap player IDs and invert result on even boards for Results', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [teamMatch],
      allPairings,
      resultsMap,
      nationalIds,
    });

    const results = parseLine(xml, 'Result');

    // Board 1 (odd): home=White → White=50001(home), Black=60001(away)
    // Referee result "1-0" from home(=White) perspective → Res="1-0"
    expect(results[0].PlayerWhiteId).toBe('50001');
    expect(results[0].PlayerBlackId).toBe('60001');
    expect(results[0].Res).toBe('1-0');

    // Board 2 (even): away=White → White=60002(away), Black=50002(home)
    // Referee result "0-1" from home perspective → from White(=away) perspective: invert → "1-0"
    expect(results[1].PlayerWhiteId).toBe('60002');
    expect(results[1].PlayerBlackId).toBe('50002');
    expect(results[1].Res).toBe('1-0');

    // Board 3 (odd): home=White → White=50003, Black=60003
    // Referee result "½-½" → Res="1/2"
    expect(results[2].PlayerWhiteId).toBe('50003');
    expect(results[2].PlayerBlackId).toBe('60003');
    expect(results[2].Res).toBe('1/2');

    // Board 4 (even): away=White → White=60004(away), Black=50004(home)
    // Referee result "+:-" from home perspective = "1-0F" → invert for White(=away): "0-1F"
    expect(results[3].PlayerWhiteId).toBe('60004');
    expect(results[3].PlayerBlackId).toBe('50004');
    expect(results[3].Res).toBe('0-1F');
  });

  it('should produce both TeamCompositions and Results sections', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [teamMatch],
      allPairings,
      resultsMap,
      nationalIds,
    });

    // TeamCompositions appears before Results
    const tcIndex = xml.indexOf('<TeamCompositions>');
    const rIndex = xml.indexOf('<Results>');
    expect(tcIndex).toBeGreaterThan(-1);
    expect(rIndex).toBeGreaterThan(-1);
    expect(tcIndex).toBeLessThan(rIndex);
  });

  it('should handle multiple team matches with correct team IDs', () => {
    const match1 = makeTeamMatch(1, 'Gamma', 'Alpha', [
      { homeNum: 21, awayNum: 1 },
    ]);
    const match2 = makeTeamMatch(2, 'Beta', 'Gamma', [
      { homeNum: 11, awayNum: 21 },
    ]);

    const allP = [...match1.boards, ...match2.boards];

    const xml = buildRefereeExportXml({
      round: 2,
      teamPairings: [match1, match2],
      allPairings: allP,
      resultsMap: {},
      nationalIds: {},
    });

    const compositions = parseLine(xml, 'TeamComposition');

    // Alphabetically sorted: Alpha=1, Beta=2, Gamma=3
    // Match 1: Gamma(home)=3 vs Alpha(away)=1
    const m1home = compositions.find(c => c.PlayerId === '21' && c.Board === '1')!;
    expect(m1home.TeamUniqueId).toBe('3'); // Gamma
    expect(m1home.TeamUniqueId2).toBe('1'); // Alpha

    // Match 2: Beta(home)=2 vs Gamma(away)=3
    const m2entries = compositions.filter(c => c.Board === '1' && c.Round === '2');
    const m2home = m2entries.find(c => c.PlayerId === '11')!;
    expect(m2home.TeamUniqueId).toBe('2'); // Beta
    expect(m2home.TeamUniqueId2).toBe('3'); // Gamma
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// XML structure validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildRefereeExportXml — XML structure', () => {
  it('should start with XML declaration', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [],
      allPairings: [],
      resultsMap: {},
      nationalIds: {},
    });

    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="utf-8"\?>/);
  });

  it('should always include Results section even with no pairings', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [],
      allPairings: [],
      resultsMap: {},
      nationalIds: {},
    });

    expect(xml).toContain('<Results>');
    expect(xml).toContain('</Results>');
  });

  it('should include Round attribute matching input', () => {
    const xml = buildRefereeExportXml({
      round: 7,
      teamPairings: [],
      allPairings: [makeBoard(1, 1, 2)],
      resultsMap: { 1: '1-0' },
      nationalIds: {},
    });

    const results = parseLine(xml, 'Result');
    expect(results[0].Round).toBe('7');
  });
});
