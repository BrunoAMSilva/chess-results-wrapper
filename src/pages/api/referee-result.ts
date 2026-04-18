import type { APIRoute } from "astro";
import { upsertRefereeResult, deleteRefereeResult, getRefereeResults } from "../../lib/db";

const VALID_RESULTS = ["1-0", "0-1", "½-½", "+:-", "-:+", "-:-"];

function parseBody(raw: {
  tid?: unknown;
  round?: unknown;
  table?: unknown;
  result?: unknown;
  gameResult?: unknown;
  absentWhite?: unknown;
  absentBlack?: unknown;
  _redirect?: unknown;
}) {
  const tid = typeof raw.tid === "string" ? raw.tid : "";
  const round = Number(raw.round);
  const table = Number(raw.table);

  // Prefer the explicit result field, then the radio-group value.
  // Legacy absent fields remain supported for older form payloads.
  let result = typeof raw.result === "string" ? raw.result : "";
  if (!result) {
    result = typeof raw.gameResult === "string" ? raw.gameResult : "";
    if (!result) {
      const wAbsent = raw.absentWhite === "on" || raw.absentWhite === "true";
      const bAbsent = raw.absentBlack === "on" || raw.absentBlack === "true";
      if (wAbsent && bAbsent) {
        result = "-:-";
      } else if (wAbsent) {
        result = "-:+";
      } else if (bAbsent) {
        result = "+:-";
      }
    }
  }

  const redirect = typeof raw._redirect === "string" ? raw._redirect : "";

  return { tid, round, table, result, redirect };
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const contentType = request.headers.get("content-type") || "";
    let raw: Record<string, unknown>;

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await request.formData();
      raw = Object.fromEntries(formData.entries());
    } else {
      raw = await request.json();
    }

    const { tid, round, table, result, redirect } = parseBody(raw);

    if (!tid) return jsonError("Missing or invalid tid", 400);
    if (!Number.isInteger(round) || round < 1 || round > 64)
      return jsonError("Invalid round", 400);
    if (!Number.isInteger(table) || table < 1)
      return jsonError("Invalid table number", 400);
    if (!VALID_RESULTS.includes(result))
      return jsonError("Invalid result", 400);

    upsertRefereeResult(tid, round, table, result);

    // PRG redirect for native form submissions (relative paths only)
    if (redirect && redirect.startsWith("/")) {
      return new Response(null, {
        status: 303,
        headers: { Location: redirect },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save result";
    return jsonError(message, 500);
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

  const round = Number.parseInt(roundStr ?? '1', 10);
  if (!Number.isFinite(round) || round < 1 || round > 64) {
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

export const DELETE: APIRoute = async ({ request }) => {
  try {
    const raw = await request.json();
    const tid = typeof raw.tid === "string" ? raw.tid : "";
    const round = Number(raw.round);
    const table = Number(raw.table);

    if (!tid) return jsonError("Missing or invalid tid", 400);
    if (!Number.isInteger(round) || round < 1 || round > 64)
      return jsonError("Invalid round", 400);
    if (!Number.isInteger(table) || table < 1)
      return jsonError("Invalid table number", 400);

    deleteRefereeResult(tid, round, table);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to delete result";
    return jsonError(message, 500);
  }
};
