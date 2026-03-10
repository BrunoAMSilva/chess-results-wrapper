import type { APIRoute } from "astro";
import {
  countTournaments,
  listTournaments,
  searchTournamentsPaged,
} from "../../lib/db";
import { getIntParam } from "../../lib/request-params";

export const GET: APIRoute = async ({ url }) => {
  const query = url.searchParams.get("q")?.trim() || "";
  const limit = getIntParam(url.searchParams.get("limit"), 20, 1, 50);
  const offset = getIntParam(url.searchParams.get("offset"), 0, 0, 1000000);

  const tournaments = query
    ? searchTournamentsPaged(query, limit, offset)
    : listTournaments(limit, offset);

  const total = countTournaments(query);

  return new Response(
    JSON.stringify({ query, limit, offset, total, tournaments }),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=30",
      },
    },
  );
};
