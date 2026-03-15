import type { APIRoute } from "astro";
import { scrapePairings } from "../../lib/scraper";
import { getRefereeResults } from "../../lib/db";
import type { Pairing, TeamPairing } from "../../lib/types";

const RESULT_MAP: Record<string, string> = {
  "1-0": "1-0",
  "0-1": "0-1",
  "½-½": "1/2",
  "+:-": "1-0F",
  "-:+": "0-1F",
  "-:-": "0-0F",
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const GET: APIRoute = async ({ url }) => {
  const tid = url.searchParams.get("tid");
  const roundStr = url.searchParams.get("round");

  if (!tid) {
    return new Response(JSON.stringify({ error: "Missing tid" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const round = parseInt(roundStr || "1", 10);
  if (isNaN(round) || round < 1 || round > 64) {
    return new Response(JSON.stringify({ error: "Invalid round" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const data = await scrapePairings(tid, round, 1);
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

    // Build XML
    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="utf-8"?>');
    lines.push(`<SwissManagerExport Tournament="${escapeXml(data.info.name)}" Round="${round}">`);

    // Team compositions (only for team tournaments)
    if (teamPairings.length > 0) {
      lines.push("  <TeamCompositions>");
      for (const tm of teamPairings) {
        for (const b of tm.boards) {
          const res = resultsMap[b.table] ?? "";
          const smRes = RESULT_MAP[res] ?? "";
          lines.push(
            `    <TeamComp Round="${round}" PlayerId="${b.white.number}" Board="${b.table}" Res="${smRes}"` +
              ` TeamWhite="${escapeXml(tm.whiteTeam)}" TeamBlack="${escapeXml(tm.blackTeam)}" />`
          );
        }
      }
      lines.push("  </TeamCompositions>");
    }

    // Individual results
    lines.push("  <Results>");
    for (const p of allPairings) {
      const res = resultsMap[p.table] ?? "";
      const smRes = RESULT_MAP[res] ?? "";
      if (!p.black) continue; // Skip BYE/unpaired
      lines.push(
        `    <Result Round="${round}" PlayerWhiteId="${p.white.number}" PlayerBlackId="${p.black.number}" Res="${smRes}" />`
      );
    }
    lines.push("  </Results>");

    lines.push("</SwissManagerExport>");

    const xml = lines.join("\n");

    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="round-${round}-results.xml"`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to generate export";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
