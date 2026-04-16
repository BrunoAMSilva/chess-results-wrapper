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
  it('should produce Results section with player starting rank numbers', () => {
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
    });

    const results = parseLine(xml, 'Result');
    expect(results).toHaveLength(3);

    // Board 1: White=player 1, Black=player 10
    expect(results[0].PlayerWhiteSNo).toBe('1');
    expect(results[0].PlayerBlackSNo).toBe('10');
    expect(results[0].Res).toBe('1-0');

    // Board 2: draw
    expect(results[1].PlayerWhiteSNo).toBe('11');
    expect(results[1].PlayerBlackSNo).toBe('2');
    expect(results[1].Res).toBe('1/2');

    // Board 3: Black wins
    expect(results[2].Res).toBe('0-1');
  });

  it('should NOT produce TeamCompositions in results format', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [],
      allPairings: [makeBoard(1, 1, 10)],
      resultsMap: { 1: '1-0' },
    });

    expect(xml).not.toContain('<TeamCompositions>');
    expect(xml).not.toContain('<TeamComposition ');
  });

  it('should handle BYE (no opponent) with PlayerBlackSNo="0"', () => {
    const xml = buildRefereeExportXml({
      round: 3,
      teamPairings: [],
      allPairings: [makeBoard(5, 6, null)],
      resultsMap: { 5: '+:-' },
    });

    const results = parseLine(xml, 'Result');
    expect(results).toHaveLength(1);
    expect(results[0].PlayerWhiteSNo).toBe('6');
    expect(results[0].PlayerBlackSNo).toBe('0');
    expect(results[0].Res).toBe('1-0F');
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

  // Home players: SNR 1,2,3,4
  // Away players: SNR 11,12,13,14

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

  it('should produce TeamCompositions section in team-compositions format', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [teamMatch],
      allPairings,
      resultsMap,
      format: 'team-compositions',
    });

    expect(xml).toContain('<TeamCompositions>');
    expect(xml).toContain('</TeamCompositions>');
    expect(xml).not.toContain('<Results>');

    const compositions = parseLine(xml, 'TeamComposition');
    // 4 boards × 2 players = 8 entries
    expect(compositions).toHaveLength(8);
  });

  it('should NOT produce TeamCompositions in default results format for team tournaments', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [teamMatch],
      allPairings,
      resultsMap,
    });

    expect(xml).not.toContain('<TeamCompositions>');
    expect(xml).toContain('<Results>');
  });

  it('should use starting rank numbers as PlayerSNo in TeamCompositions', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [teamMatch],
      allPairings,
      resultsMap,
      format: 'team-compositions',
    });

    const compositions = parseLine(xml, 'TeamComposition');
    const playerSNos = compositions.map(c => c.PlayerSNo);

    // All 8 entries should use starting rank numbers
    expect(playerSNos).toContain('1');  // home board 1
    expect(playerSNos).toContain('11'); // away board 1
    expect(playerSNos).toContain('2');  // home board 2
    expect(playerSNos).toContain('12'); // away board 2
    expect(playerSNos).toContain('3');  // home board 3
    expect(playerSNos).toContain('13'); // away board 3
    expect(playerSNos).toContain('4');  // home board 4
    expect(playerSNos).toContain('14'); // away board 4
  });

  it('should assign TeamUniqueId based on player team', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [teamMatch],
      allPairings,
      resultsMap,
      format: 'team-compositions',
    });

    const compositions = parseLine(xml, 'TeamComposition');

    // Team IDs are assigned alphabetically: "Alpha Club" = 1, "Beta Club" = 2
    const alphaId = '1';
    const betaId = '2';

    // Home team player entries use starting rank numbers
    for (const c of compositions) {
      if (['1', '2', '3', '4'].includes(c.PlayerSNo)) {
        expect(c.TeamUniqueId).toBe(alphaId);
      }
      if (['11', '12', '13', '14'].includes(c.PlayerSNo)) {
        expect(c.TeamUniqueId).toBe(betaId);
      }
    }
  });

  it('should only include spec attributes: Round, TeamUniqueId, Board, PlayerSNo', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [teamMatch],
      allPairings,
      resultsMap,
      format: 'team-compositions',
    });

    const compositions = parseLine(xml, 'TeamComposition');
    for (const c of compositions) {
      // Spec attributes present
      expect(c.Round).toBeDefined();
      expect(c.TeamUniqueId).toBeDefined();
      expect(c.Board).toBeDefined();
      expect(c.PlayerSNo).toBeDefined();
      // Non-spec attributes removed
      expect(c.PlayerId).toBeUndefined();
      expect(c.Res).toBeUndefined();
      expect(c.TeamUniqueId2).toBeUndefined();
      expect(c.TeamUniqueIdWhite).toBeUndefined();
      expect(c.TeamUniqueIdBlack).toBeUndefined();
    }
  });

  it('should assign home team ID to home players and away team ID to away players', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [teamMatch],
      allPairings,
      resultsMap,
      format: 'team-compositions',
    });

    const compositions = parseLine(xml, 'TeamComposition');

    // "Alpha Club" = 1 (home), "Beta Club" = 2 (away)
    // Home players get TeamUniqueId=1, away players get TeamUniqueId=2
    expect(compositions.find(c => c.PlayerSNo === '1')!.TeamUniqueId).toBe('1');
    expect(compositions.find(c => c.PlayerSNo === '11')!.TeamUniqueId).toBe('2');
    expect(compositions.find(c => c.PlayerSNo === '2')!.TeamUniqueId).toBe('1');
    expect(compositions.find(c => c.PlayerSNo === '12')!.TeamUniqueId).toBe('2');
  });

  it('should use starting rank numbers as PlayerWhiteSNo/PlayerBlackSNo in Results', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [teamMatch],
      allPairings,
      resultsMap,
    });

    const results = parseLine(xml, 'Result');
    expect(results).toHaveLength(4);

    const allSNos = results.flatMap(r => [r.PlayerWhiteSNo, r.PlayerBlackSNo]);
    // All SNo values should be defined
    for (const sno of allSNos) {
      expect(sno).toBeDefined();
    }
  });

  it('should swap player SNo and invert result on even boards for Results', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [teamMatch],
      allPairings,
      resultsMap,
    });

    const results = parseLine(xml, 'Result');

    // Board 1 (odd): home=White → White=1(home), Black=11(away)
    // Referee result "1-0" from home(=White) perspective → Res="1-0"
    expect(results[0].PlayerWhiteSNo).toBe('1');
    expect(results[0].PlayerBlackSNo).toBe('11');
    expect(results[0].Res).toBe('1-0');

    // Board 2 (even): away=White → White=12(away), Black=2(home)
    // Referee result "0-1" from home perspective → from White(=away) perspective: invert → "1-0"
    expect(results[1].PlayerWhiteSNo).toBe('12');
    expect(results[1].PlayerBlackSNo).toBe('2');
    expect(results[1].Res).toBe('1-0');

    // Board 3 (odd): home=White → White=3, Black=13
    // Referee result "½-½" → Res="1/2"
    expect(results[2].PlayerWhiteSNo).toBe('3');
    expect(results[2].PlayerBlackSNo).toBe('13');
    expect(results[2].Res).toBe('1/2');

    // Board 4 (even): away=White → White=14(away), Black=4(home)
    // Referee result "+:-" from home perspective = "1-0F" → invert for White(=away): "0-1F"
    expect(results[3].PlayerWhiteSNo).toBe('14');
    expect(results[3].PlayerBlackSNo).toBe('4');
    expect(results[3].Res).toBe('0-1F');
  });

  it('should produce valid XML with single root element for each format', () => {
    const resultsXml = buildRefereeExportXml({
      round: 1,
      teamPairings: [teamMatch],
      allPairings,
      resultsMap,
      format: 'results',
    });

    const tcXml = buildRefereeExportXml({
      round: 1,
      teamPairings: [teamMatch],
      allPairings,
      resultsMap,
      format: 'team-compositions',
    });

    // Results format has <Results> root, no TeamCompositions
    expect(resultsXml).toContain('<Results>');
    expect(resultsXml).not.toContain('<TeamCompositions>');

    // TeamCompositions format has <TeamCompositions> root, no Results
    expect(tcXml).toContain('<TeamCompositions>');
    expect(tcXml).not.toContain('<Results>');
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
      format: 'team-compositions',
    });

    const compositions = parseLine(xml, 'TeamComposition');

    // Alphabetically sorted: Alpha=1, Beta=2, Gamma=3
    // Match 1: Gamma(home)=3 vs Alpha(away)=1
    const m1home = compositions.find(c => c.PlayerSNo === '21' && c.Board === '1')!;
    expect(m1home.TeamUniqueId).toBe('3'); // Gamma

    // Match 2: Beta(home)=2 vs Gamma(away)=3
    const m2entries = compositions.filter(c => c.Board === '1' && c.Round === '2');
    const m2home = m2entries.find(c => c.PlayerSNo === '11')!;
    expect(m2home.TeamUniqueId).toBe('2'); // Beta
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
    });

    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  });

  it('should always include Results section even with no pairings', () => {
    const xml = buildRefereeExportXml({
      round: 1,
      teamPairings: [],
      allPairings: [],
      resultsMap: {},
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
    });

    const results = parseLine(xml, 'Result');
    expect(results[0].Round).toBe('7');
  });
});
