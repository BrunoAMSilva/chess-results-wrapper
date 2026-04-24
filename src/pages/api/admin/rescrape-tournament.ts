import type { APIRoute } from "astro";
import { scrapeStartingRank } from "../../../lib/scraper";
import { rejectUntrustedBrowserRequest } from "../../../lib/request-security";

export const POST: APIRoute = async ({ request, url }) => {
  const blocked = rejectUntrustedBrowserRequest(request, url);
  if (blocked) return blocked;

  let tid: string;
  try {
    const body = await request.json();
    tid = String(body.tid ?? "").trim();
  } catch {
    return new Response(JSON.stringify({ error: "JSON body with tid required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!tid) {
    return new Response(JSON.stringify({ error: "tid is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const count = await scrapeStartingRank(tid);
    return new Response(JSON.stringify({ ok: true, players_updated: count }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Scrape failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
