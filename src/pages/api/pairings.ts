import type { APIRoute } from "astro";
import { scrapePairings } from "../../lib/scraper";

export const GET: APIRoute = async ({ url }) => {
  const tid = url.searchParams.get("tid");
  const round = parseInt(url.searchParams.get("round") || "1");
  const lang = parseInt(url.searchParams.get("lang") || "1");

  if (!tid) {
    return new Response(JSON.stringify({ error: "Missing tid parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const data = await scrapePairings(tid, round, lang);
    return new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=30",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch data";
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};
