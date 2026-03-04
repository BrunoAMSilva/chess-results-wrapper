import type { APIRoute } from "astro";
import { searchTournaments } from "../../lib/db";

export const GET: APIRoute = async ({ url }) => {
  const query = url.searchParams.get("q")?.trim();

  if (!query || query.length < 2) {
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const results = searchTournaments(query, 8);

  return new Response(JSON.stringify(results), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
    },
  });
};
