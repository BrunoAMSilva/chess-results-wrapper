import type { APIRoute } from "astro";
import { searchTournaments } from "../../lib/db";
import { getIntParam } from "../../lib/request-params";

export const GET: APIRoute = async ({ url }) => {
  const query = url.searchParams.get("q")?.trim();
  const limit = getIntParam(url.searchParams.get("limit"), 8, 1, 25);

  if (!query || query.length < 2) {
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const results = searchTournaments(query, limit);

  return new Response(JSON.stringify(results), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
    },
  });
};
