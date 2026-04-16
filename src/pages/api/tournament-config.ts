import type { APIRoute } from "astro";
import { setTournamentConfig, getTournamentConfig } from "../../lib/db";

const SID_PATTERN = /^[0-9A-Fa-f]{32}$/;

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const tid = typeof body.tid === "string" ? body.tid : "";
    const key = typeof body.key === "string" ? body.key : "";
    const value = typeof body.value === "string" ? body.value : "";

    if (!tid) return jsonError("Missing tid", 400);
    if (!key) return jsonError("Missing key", 400);

    // Only allow known config keys
    if (key !== "sid") return jsonError("Unknown config key", 400);

    // Validate SID format
    if (key === "sid" && !SID_PATTERN.test(value)) {
      return jsonError("SID must be 32 hexadecimal characters", 400);
    }

    setTournamentConfig(tid, key, value);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save config";
    return jsonError(message, 500);
  }
};

export const GET: APIRoute = async ({ url }) => {
  const tid = url.searchParams.get("tid");
  const key = url.searchParams.get("key");

  if (!tid) return jsonError("Missing tid", 400);
  if (!key) return jsonError("Missing key", 400);

  const value = getTournamentConfig(tid, key);

  // Mask the SID for security — only reveal first/last 4 chars
  let masked: string | null = null;
  if (value && key === "sid") {
    masked = value.slice(0, 4) + "…" + value.slice(-4);
  }

  return new Response(JSON.stringify({ configured: !!value, masked }), {
    headers: { "Content-Type": "application/json" },
  });
};
