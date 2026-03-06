import { scrapeStandings } from './src/lib/scraper';

async function test() {
  const en = await scrapeStandings('1361358', 1);
  const pt = await scrapeStandings('1361358', 10);
  
  console.log('EN standings count:', en.standings.length);
  console.log('PT standings count:', pt.standings.length);
  
  if (en.standings.length > 0) {
    console.log('EN first:', en.standings[0].name, 'rank:', en.standings[0].rank);
    console.log('EN last:', en.standings[en.standings.length-1].name);
  }
  if (pt.standings.length > 0) {
    console.log('PT first:', pt.standings[0].name, 'rank:', pt.standings[0].rank);
    console.log('PT last:', pt.standings[pt.standings.length-1].name);
  }
  
  const target = 'Silva, Bruno Alexandre Martins da';
  const enMatch = en.standings.find(s => s.name === target);
  const ptMatch = pt.standings.find(s => s.name === target);
  console.log('EN match:', enMatch ? 'found rank ' + enMatch.rank : 'NOT FOUND');
  console.log('PT match:', ptMatch ? 'found rank ' + ptMatch.rank : 'NOT FOUND');
  
  // Search for "Silva" in both
  const enSilva = en.standings.filter(s => s.name.includes('Silva'));
  const ptSilva = pt.standings.filter(s => s.name.includes('Silva'));
  console.log('EN Silva matches:', enSilva.map(s => s.name));
  console.log('PT Silva matches:', ptSilva.map(s => s.name));
}
test().catch(e => console.error('ERROR:', e));
