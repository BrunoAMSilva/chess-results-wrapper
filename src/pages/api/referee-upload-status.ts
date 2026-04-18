import type { APIRoute } from "astro";
import { getUploadLog } from "../../lib/db";

export const GET: APIRoute = async ({ url }) => {
  const tid = url.searchParams.get("tid");
  const roundStr = url.searchParams.get("round");

  if (!tid) {
    return new Response(JSON.stringify({ error: "Missing tid" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const round = Number.parseInt(roundStr || "1", 10);
  if (!Number.isFinite(round) || round < 1 || round > 64) {
    return new Response(JSON.stringify({ error: "Invalid round" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const log = getUploadLog(tid, round);
  return new Response(JSON.stringify({ log }), {
    headers: { "Content-Type": "application/json" },
  });
};
