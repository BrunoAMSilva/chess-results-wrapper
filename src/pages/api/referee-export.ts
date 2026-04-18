import type { APIRoute } from "astro";
import { scrapePairings } from "../../lib/scraper";
import { getRefereeResults } from "../../lib/db";
import { buildRefereeExportXml } from "../../lib/xml-export";
import type { Pairing, TeamPairing } from "../../lib/types";

export const GET: APIRoute = async ({ url }) => {
  const tid = url.searchParams.get("tid");
  const roundStr = url.searchParams.get("round");
  const formatParam = url.searchParams.get("format");
  const format = formatParam === "team-compositions" ? "team-compositions" as const : "results" as const;

  if (!tid) {
    return new Response(JSON.stringify({ error: "Missing tid" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const round = Number.parseInt(roundStr ?? '1', 10);
  if (!Number.isFinite(round) || round < 1 || round > 64) {
    return new Response(JSON.stringify({ error: "Invalid round" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const data = await scrapePairings(tid, round);
    const refereeResults = getRefereeResults(tid, round) as Array<{
      table_number: number;
      result: string;
    }>;

    // Build referee results lookup by table number
    const resultsMap: Record<number, string> = {};
    for (const r of refereeResults) {
      resultsMap[r.table_number] = r.result;
    }

    // Collect all pairings (flat or from team boards)
    const allPairings: Pairing[] = [];
    const teamPairings: TeamPairing[] = data.teamPairings || [];

    if (teamPairings.length > 0) {
      for (const tm of teamPairings) {
        for (const b of tm.boards) {
          allPairings.push(b);
        }
      }
    } else {
      allPairings.push(...data.pairings);
    }

    const xml = buildRefereeExportXml({
      round,
      teamPairings,
      allPairings,
      resultsMap,
      format,
    });

    const filename = format === 'team-compositions'
      ? `round-${round}-team-compositions.xml`
      : `round-${round}-results.xml`;

    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to generate export";
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};
