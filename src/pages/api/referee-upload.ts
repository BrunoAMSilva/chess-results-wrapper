import type { APIRoute } from "astro";
import { scrapePairings } from "../../lib/scraper";
import { uploadRoundResults } from "../../lib/chess-results-upload";
import type { Pairing, TeamPairing } from "../../lib/types";
import { rejectUntrustedBrowserRequest } from "../../lib/request-security";

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request, url }) => {
  const blocked = rejectUntrustedBrowserRequest(request, url);
  if (blocked) return blocked;

  try {
    const body = await request.json();
    const tid = typeof body.tid === "string" ? body.tid : "";
    const round = Number(body.round);
    const section = typeof body.section === "string" ? body.section : tid;

    if (!tid) return jsonError("Missing tid", 400);
    if (!Number.isInteger(round) || round < 1 || round > 64) {
      return jsonError("Invalid round", 400);
    }

    // Fetch pairings for the section (may differ from tid for linked tournaments)
    const data = await scrapePairings(section, round);

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

    const results = await uploadRoundResults({
      tournamentId: section,
      round,
      allPairings,
      teamPairings: teamPairings.length > 0 ? teamPairings : undefined,
    });

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed";
    const status = message.includes("SID not configured") ? 400 : 500;
    return jsonError(message, status);
  }
};
