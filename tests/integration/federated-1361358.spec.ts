import { describe, it, expect, beforeEach } from 'vitest';
import db, { persistPairings, persistStandings, upsertTournament } from '../../src/lib/db';
import { scrapePairings, scrapeStandings } from '../../src/lib/scraper';

describe.skipIf(process.env.SKIP_LIVE === '1')('Integration - Federated and Linked Tournaments (1361358 & 1340832)', () => {
  beforeEach(() => {
    db.exec(`
      DELETE FROM results; 
      DELETE FROM standings; 
      DELETE FROM tournament_players; 
      DELETE FROM players; 
      DELETE FROM tournaments;
    `);
  });

  it('should save dual standings and correctly link federated tournaments', async () => {
    // 1. Fetch Non-Federated (1361358)
    const p1 = await scrapePairings('1361358', 1, 1);
    persistPairings('1361358', p1.info, 1, p1.pairings);
    const s1 = await scrapeStandings('1361358', 1);
    persistStandings('1361358', s1.info, s1.standings, s1.womenStandings);
    
    // 2. Fetch Federated (1340832)
    const p2 = await scrapePairings('1340832', 1, 1);
    persistPairings('1340832', p2.info, 1, p2.pairings);
    const s2 = await scrapeStandings('1340832', 1);
    persistStandings('1340832', s2.info, s2.standings, s2.womenStandings);

    // 3. These tournaments are NOT linked on chess-results.com (no "Tournament
    //    selection" row), so linked_tournaments must be set externally — e.g.
    //    via the import JSON's linkedTournaments field.  Simulate that here:
    upsertTournament({
      ...s1.info,
      currentLabel: 'Não Federados',
      linkedTournaments: [{ id: '1340832', name: 'Federados' }],
    }, '1361358');

    // Verify basic tournament data
    const tournaments = db.prepare('SELECT id, name, total_rounds, linked_tournaments FROM tournaments WHERE id IN (?, ?)').all('1361358', '1340832') as any[];
    expect(tournaments).toHaveLength(2);
    
    const unFederated = tournaments.find((t: any) => t.id === '1361358');
    const federated = tournaments.find((t: any) => t.id === '1340832');
    
    expect(unFederated).toBeDefined();
    expect(unFederated.total_rounds).toBe(5);
    expect(federated).toBeDefined();
    expect(federated.total_rounds).toBeGreaterThanOrEqual(7);

    // Linked tournaments: set on 1361358, bidirectionally propagated to 1340832
    const linkedUnFed = JSON.parse(unFederated.linked_tournaments);
    expect(linkedUnFed[0]).toMatchObject({ id: '1340832', name: 'Federados' });
    
    const linkedFed = JSON.parse(federated.linked_tournaments);
    expect(linkedFed[0]).toMatchObject({ id: '1361358', name: 'Não Federados' });

    // Women standings for the federated tournament
    const womenStandingsDbRow = db.prepare("SELECT count(*) as c FROM standings WHERE tournament_id='1340832' AND type='women'").get() as any;
    expect(womenStandingsDbRow).toBeDefined();
    expect(Number(womenStandingsDbRow.c)).toBeGreaterThanOrEqual(2);
  });
});
