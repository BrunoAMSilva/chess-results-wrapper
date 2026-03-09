import * as cheerio from 'cheerio';
import * as fs from 'fs';

const BASE_URL = 'https://chess-results.com';
const S2_BASE_URL = 'https://s2.chess-results.com';

function isOldTournamentGate(html: string): boolean {
  const hasGateText = /LinkButton2|mais de 2 semanas|more than 2 weeks|mehr als 2 Wochen|m[aá]s de 2 semanas/i.test(html);
  if (!hasGateText) return false;
  const hasData = /class="CRs1"/.test(html);
  return !hasData;
}

function extractHiddenFields(html: string): Map<string, string> {
  const $ = cheerio.load(html);
  const fields = new Map<string, string>();
  $('input[type="hidden"]').each((_, el) => {
    const name = ($(el).attr('name') || '').trim();
    const value = $(el).attr('value') || '';
    if (name) fields.set(name, value);
  });
  return fields;
}

class SimpleCookieJar {
  private readonly jar = new Map<string, string>();
  updateFromResponse(res: Response): void {
    const setCookies = (res.headers as any).getSetCookie?.() || [];
    for (const raw of setCookies) {
      const firstPart = raw.split(';')[0] || '';
      const eqIdx = firstPart.indexOf('=');
      if (eqIdx <= 0) continue;
      const name = firstPart.slice(0, eqIdx).trim();
      const value = firstPart.slice(eqIdx + 1).trim();
      if (name) this.jar.set(name, value);
    }
  }
  toHeader(): string {
    return Array.from(this.jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function fetchWithGate(url: string, tournamentId: string, lang: number): Promise<string> {
  const primaryRes = await fetch(url, { redirect: 'follow' });
  const primaryHtml = await primaryRes.text();
  
  if (!isOldTournamentGate(primaryHtml)) return primaryHtml;
  
  console.log('Hit gate, bypassing...');
  
  const gateUrl = `${S2_BASE_URL}/tnr${tournamentId}.aspx?lan=${lang}&turdet=YES&SNode=S0`;
  const jar = new SimpleCookieJar();
  
  const gateGet = await fetch(gateUrl);
  jar.updateFromResponse(gateGet);
  const gateHtml = await gateGet.text();
  
  if (!isOldTournamentGate(gateHtml)) return gateHtml;
  
  const body = new URLSearchParams();
  for (const [k, v] of extractHiddenFields(gateHtml).entries()) {
    body.set(k, v);
  }
  
  const $gate = cheerio.load(gateHtml);
  const submitBtn = $gate('input[type="submit"]').first();
  const postbackMatch = gateHtml.match(/__doPostBack\('([^']+)'/);
  
  if (submitBtn.length > 0 && submitBtn.attr('name')) {
    body.set('__EVENTTARGET', '');
    body.set('__EVENTARGUMENT', '');
    body.set(submitBtn.attr('name')!, submitBtn.attr('value') || '');
  } else if (postbackMatch) {
    body.set('__EVENTTARGET', postbackMatch[1]);
    body.set('__EVENTARGUMENT', '');
  }
  
  const postRes = await fetch(gateUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: jar.toHeader(),
      Referer: gateUrl,
    },
    body: body.toString(),
  });
  jar.updateFromResponse(postRes);
  
  // Now fetch the actual page we want with the unlocked session
  const s2Url = url.replace(BASE_URL, S2_BASE_URL);
  const finalRes = await fetch(s2Url, {
    headers: { Cookie: jar.toHeader(), Referer: gateUrl },
  });
  return finalRes.text();
}

async function main() {
  const tid = '1322107';
  
  // Fetch pairings round 1 (art=2)
  console.log('Fetching pairings round 1...');
  const p1 = await fetchWithGate(`${BASE_URL}/tnr${tid}.aspx?lan=1&art=2&rd=1&turdet=YES&wi=821`, tid, 1);
  fs.writeFileSync('/tmp/team_pairings_r1.html', p1);
  console.log(`Pairings r1: ${p1.split('\n').length} lines, CRs1: ${p1.includes('CRs1')}`);
  
  // Fetch pairings round 2 (art=2)
  console.log('Fetching pairings round 2...');
  const p2 = await fetchWithGate(`${BASE_URL}/tnr${tid}.aspx?lan=1&art=2&rd=2&turdet=YES&wi=821`, tid, 1);
  fs.writeFileSync('/tmp/team_pairings_r2.html', p2);
  console.log(`Pairings r2: ${p2.split('\n').length} lines, CRs1: ${p2.includes('CRs1')}`);
  
  // Fetch standings (art=1)
  console.log('Fetching standings art=1...');
  const s1 = await fetchWithGate(`${BASE_URL}/tnr${tid}.aspx?lan=1&art=1&turdet=YES&wi=821`, tid, 1);
  fs.writeFileSync('/tmp/team_standings_art1.html', s1);
  console.log(`Standings art=1: ${s1.split('\n').length} lines, CRs1: ${s1.includes('CRs1')}`);
  
  // Fetch standings (art=4)
  console.log('Fetching standings art=4...');
  const s4 = await fetchWithGate(`${BASE_URL}/tnr${tid}.aspx?lan=1&art=4&turdet=YES&wi=821`, tid, 1);
  fs.writeFileSync('/tmp/team_standings_art4.html', s4);
  console.log(`Standings art=4: ${s4.split('\n').length} lines, CRs1: ${s4.includes('CRs1')}`);
  
  // Also check art=0 (individual pairings)
  console.log('Fetching individual pairings art=0 rd=1...');
  const ip1 = await fetchWithGate(`${BASE_URL}/tnr${tid}.aspx?lan=1&art=0&rd=1&turdet=YES&wi=821`, tid, 1);
  fs.writeFileSync('/tmp/team_individual_r1.html', ip1);
  console.log(`Individual r1: ${ip1.split('\n').length} lines, CRs1: ${ip1.includes('CRs1')}`);
}

main().catch(console.error);
