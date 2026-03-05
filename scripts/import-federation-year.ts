import { scrapePairings, scrapeStandings } from "../src/lib/scraper.ts";

const BASE_URL = "https://chess-results.com";

interface Args {
  fed: string;
  year: number;
  lang: number;
  maxTournaments: number;
  maxPages: number;
  withPairings: boolean;
  strictTitleYear: boolean;
}

interface TournamentSeed {
  id: string;
  title: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    fed: "POR",
    year: 2026,
    lang: 10,
    maxTournaments: 0,
    maxPages: 120,
    withPairings: true,
    strictTitleYear: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === "--fed" && next) {
      args.fed = next.toUpperCase();
      i += 1;
      continue;
    }
    if (token === "--year" && next) {
      args.year = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (token === "--lang" && next) {
      args.lang = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (token === "--max" && next) {
      args.maxTournaments = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (token === "--max-pages" && next) {
      args.maxPages = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (token === "--no-pairings") {
      args.withPairings = false;
      continue;
    }
    if (token === "--strict-title-year") {
      args.strictTitleYear = true;
      continue;
    }
  }

  return args;
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#8211;", "-")
    .replaceAll("&#8220;", '"')
    .replaceAll("&#8221;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ")
    .trim();
}

function extractTournamentSeeds(html: string): TournamentSeed[] {
  const seen = new Set<string>();
  const seeds: TournamentSeed[] = [];
  const re = /https:\/\/chess-results\.com\/tnr(\d+)\.aspx\?lan=\d+">([^<]+)</g;

  let m = re.exec(html);
  while (m) {
    const id = m[1];
    if (!seen.has(id)) {
      seen.add(id);
      seeds.push({ id, title: decodeHtml(m[2]) });
    }
    m = re.exec(html);
  }

  return seeds;
}

function extractTransferPath(html: string): string | null {
  const m = html.match(/href="(Transfer\.aspx\?key5=TS[^\"]+)"/i);
  return m ? decodeHtml(m[1]) : null;
}

function titleLooksLikeYear(title: string, year: number): boolean {
  return title.includes(String(year)) || title.includes(`${year - 1}/${String(year).slice(2)}`);
}

function dateLooksLikeYear(dateText: string, year: number): boolean {
  if (!dateText) return false;
  return dateText.includes(String(year));
}

async function discoverFederationTournaments(fed: string, maxPages: number): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const visited = new Set<string>();

  let pageUrl = `${BASE_URL}/fed.aspx?lan=1&fed=${encodeURIComponent(fed)}`;
  let page = 0;

  while (pageUrl && page < maxPages && !visited.has(pageUrl)) {
    visited.add(pageUrl);
    page += 1;
    console.log(`[discover] page ${page}: ${pageUrl}`);

    const res = await fetch(pageUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch federation page ${pageUrl}: HTTP ${res.status}`);
    }
    const html = await res.text();

    for (const seed of extractTournamentSeeds(html)) {
      if (!result.has(seed.id)) {
        result.set(seed.id, seed.title);
      }
    }

    const transfer = extractTransferPath(html);
    pageUrl = transfer ? `${BASE_URL}/${transfer}` : "";
  }

  return result;
}

async function importTournament(tid: string, title: string, args: Args): Promise<{ imported: boolean; rounds: number }> {
  const standings = await scrapeStandings(tid, args.lang);
  const dateText = standings.info.date || "";
  const titleYear = titleLooksLikeYear(title, args.year);
  const dateYear = dateLooksLikeYear(dateText, args.year);

  if (!dateYear && !titleYear) {
    return { imported: false, rounds: 0 };
  }

  let roundsImported = 0;
  if (args.withPairings) {
    const rounds = standings.info.totalRounds || 0;
    if (rounds > 0) {
      for (let round = 1; round <= rounds; round += 1) {
        try {
          await scrapePairings(tid, round, args.lang);
          roundsImported += 1;
        } catch {
          // best effort per round
        }
      }
    }
  }

  return { imported: true, rounds: roundsImported };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[start] fed=${args.fed} year=${args.year} lang=${args.lang} withPairings=${args.withPairings}`);

  const discovered = await discoverFederationTournaments(args.fed, args.maxPages);
  console.log(`[discover] total unique tournaments found: ${discovered.size}`);

  let candidates = Array.from(discovered.entries()).map(([id, title]) => ({ id, title }));

  if (args.strictTitleYear) {
    candidates = candidates.filter((c) => titleLooksLikeYear(c.title, args.year));
    console.log(`[filter] strict title-year enabled: ${candidates.length} candidates`);
  } else {
    const yearish = candidates.filter((c) => titleLooksLikeYear(c.title, args.year));
    if (yearish.length > 0) {
      candidates = yearish;
      console.log(`[filter] selected year-like titles: ${candidates.length} candidates`);
    }
  }

  if (args.maxTournaments > 0) {
    candidates = candidates.slice(0, args.maxTournaments);
    console.log(`[filter] max tournaments applied: ${candidates.length}`);
  }

  let importedCount = 0;
  let skippedByDate = 0;
  let failed = 0;
  let roundsImported = 0;

  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i];
    const label = `[${i + 1}/${candidates.length}] tnr${c.id}`;

    try {
      const result = await importTournament(c.id, c.title, args);
      if (result.imported) {
        importedCount += 1;
        roundsImported += result.rounds;
        console.log(`${label} imported (${c.title})`);
      } else {
        skippedByDate += 1;
        console.log(`${label} skipped by date (${c.title})`);
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`${label} failed: ${message}`);
    }
  }

  console.log("\n[done]");
  console.log(`discovered=${discovered.size}`);
  console.log(`candidates=${candidates.length}`);
  console.log(`imported=${importedCount}`);
  console.log(`skippedByDate=${skippedByDate}`);
  console.log(`failed=${failed}`);
  console.log(`pairingRoundsImported=${roundsImported}`);
}

main().catch((error) => {
  console.error("[fatal]", error instanceof Error ? error.message : error);
  process.exit(1);
});
