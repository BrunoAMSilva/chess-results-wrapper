import type { APIRoute } from "astro";
import { scrapeFullTournament, scrapeStartingRank } from "../../../lib/scraper";
import { rejectUntrustedBrowserRequest } from "../../../lib/request-security";
import {
  getTournament,
  getStandingsFromDb,
  getPairingsFromDb,
  getTournamentPlayers,
} from "../../../lib/db";

export const POST: APIRoute = async ({ request, url }) => {
  const blocked = rejectUntrustedBrowserRequest(request, url);
  if (blocked) return blocked;

  let tid: string;
  try {
    const body = await request.json();
    tid = String(body.tid ?? "").trim();
  } catch {
    return new Response(
      JSON.stringify({ error: "JSON body with tid required" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (!tid) {
    return new Response(JSON.stringify({ error: "tid is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Attempt a full tournament refresh. If it fails, return a 500 and include
  // the current DB snapshot for this tournament so the caller can inspect
  // what was (or wasn't) persisted.
  try {
    await scrapeFullTournament(tid);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);

    // Gather DB snapshot to return to client
    const tournament = getTournament(tid) ?? null;
    const standings = getStandingsFromDb(tid) ?? null;

    const pairingsByRound: Record<number, any> = {};
    try {
      const totalRounds = tournament?.total_rounds ?? 0;
      for (let rd = 1; rd <= Math.max(1, totalRounds); rd++) {
        try {
          const roundData = getPairingsFromDb(tid, rd);
          if (roundData) pairingsByRound[rd] = roundData;
        } catch (_) {
          /* best-effort */
        }
      }
    } catch (_) {
      /* best-effort */
    }

    const players = getTournamentPlayers(tid) ?? [];

    return new Response(
      JSON.stringify({
        ok: false,
        error: `scrapeFullTournament failed: ${errMsg}`,
        tournament,
        standings,
        pairings: pairingsByRound,
        players,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // If full refresh succeeded, also run starting-rank enrichment and return
  // the full DB snapshot to the client.
  try {
    const playersUpdated = await scrapeStartingRank(tid);

    const tournament = getTournament(tid) ?? null;
    const standings = getStandingsFromDb(tid) ?? null;

    const pairingsByRound: Record<number, any> = {};
    try {
      const totalRounds = tournament?.total_rounds ?? 0;
      for (let rd = 1; rd <= Math.max(1, totalRounds); rd++) {
        try {
          const roundData = getPairingsFromDb(tid, rd);
          if (roundData) pairingsByRound[rd] = roundData;
        } catch (_) {
          /* best-effort */
        }
      }
    } catch (_) {
      /* best-effort */
    }

    const players = getTournamentPlayers(tid) ?? [];

    return new Response(
      JSON.stringify({
        ok: true,
        players_updated: playersUpdated,
        tournament_refreshed: true,
        tournament,
        standings,
        pairings: pairingsByRound,
        players,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    // If enrichment fails, return 500 and include DB snapshot so caller can
    // investigate.
    const errMsg = e instanceof Error ? e.message : String(e);
    const tournament = getTournament(tid) ?? null;
    const standings = getStandingsFromDb(tid) ?? null;

    const pairingsByRound: Record<number, any> = {};
    try {
      const totalRounds = tournament?.total_rounds ?? 0;
      for (let rd = 1; rd <= Math.max(1, totalRounds); rd++) {
        try {
          const roundData = getPairingsFromDb(tid, rd);
          if (roundData) pairingsByRound[rd] = roundData;
        } catch (_) {
          /* best-effort */
        }
      }
    } catch (_) {
      /* best-effort */
    }

    const players = getTournamentPlayers(tid) ?? [];

    return new Response(
      JSON.stringify({
        ok: false,
        error: `scrapeStartingRank failed: ${errMsg}`,
        tournament,
        standings,
        pairings: pairingsByRound,
        players,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};
