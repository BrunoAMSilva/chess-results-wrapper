import type { APIRoute } from "astro";
import { upsertRefereeResult, getRefereeResults } from "../../lib/db";

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { tid, round, table, result } = body;

    if (!tid || typeof tid !== "string") {
      return new Response(JSON.stringify({ error: "Missing or invalid tid" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!Number.isInteger(round) || round < 1 || round > 64) {
      return new Response(JSON.stringify({ error: "Invalid round" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!Number.isInteger(table) || table < 1) {
      return new Response(JSON.stringify({ error: "Invalid table number" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const validResults = ["1-0", "0-1", "½-½", "+:-", "-:+", "-:-"];
    if (!validResults.includes(result)) {
      return new Response(JSON.stringify({ error: "Invalid result" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    upsertRefereeResult(tid, round, table, result);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save result";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

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

  const results = getRefereeResults(tid, round);

  return new Response(JSON.stringify({ results }), {
    headers: { "Content-Type": "application/json" },
  });
};
