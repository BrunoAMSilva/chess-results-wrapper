import type { APIRoute } from "astro";
import { scrapePairings } from "../../lib/scraper";
import { getRefereeResults, getPlayerNationalIds } from "../../lib/db";
import type { Pairing, TeamPairing } from "../../lib/types";

const RESULT_MAP: Record<string, string> = {
  "1-0": "1-0",
  "0-1": "0-1",
  "½-½": "1/2",
  "+:-": "1-0F",
  "-:+": "0-1F",
  "-:-": "0-0F",
};

function invertResult(res: string): string {
  if (res === "1-0") return "0-1";
  if (res === "0-1") return "1-0";
  if (res === "1-0F") return "0-1F";
  if (res === "0-1F") return "1-0F";
  return res; // 1/2, 0-0F stay the same
}

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

    // Look up national IDs (Ident-Number = Swiss-Manager PlayerId) from DB
    // Falls back to chess-results starting number if national ID not available
    const nationalIds = getPlayerNationalIds(tid);
    function resolvePlayerId(startingNumber: number): string {
      return nationalIds[startingNumber] || String(startingNumber || 0);
    }

    // Build XML — match Swiss-Manager format
    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="utf-8"?>');

    // Team compositions (only for team tournaments)
    if (teamPairings.length > 0) {
      lines.push(`<TeamCompositions>${escapeXml(data.info.name)}`);
      for (const tm of teamPairings) {
        for (const b of tm.boards) {
          const res = resultsMap[b.table] ?? "";
          const smRes = RESULT_MAP[res] ?? "";
          const boardNum = b.table % 100;
          lines.push(
            `<TeamComposition Round="${round}" PlayerId="${resolvePlayerId(b.white.number)}" Board="${boardNum}" Res="${smRes}"` +
              ` TeamWhite="${escapeXml(tm.whiteTeam)}" TeamBlack="${escapeXml(tm.blackTeam)}" />`
          );
          if (b.black) {
            lines.push(
              `<TeamComposition Round="${round}" PlayerId="${resolvePlayerId(b.black.number)}" Board="${boardNum}" Res="${invertResult(smRes)}"` +
                ` TeamWhite="${escapeXml(tm.whiteTeam)}" TeamBlack="${escapeXml(tm.blackTeam)}" />`
            );
          }
        }
      }
      lines.push("</TeamCompositions>");
    }

    // Individual results
    lines.push("<Results>");
    for (const p of allPairings) {
      const res = resultsMap[p.table] ?? "";
      const smRes = RESULT_MAP[res] ?? "";
      lines.push(
        `<Result Round="${round}" PlayerWhiteId="${resolvePlayerId(p.white.number)}" PlayerBlackId="${resolvePlayerId(p.black?.number || 0)}" Res="${smRes}" />`
      );
    }
    lines.push("</Results>");

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
