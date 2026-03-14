import type { APIRoute } from 'astro';
import { getOpenings, getOpeningById, getOpeningsByName } from '../../lib/db';

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const idStr = url.searchParams.get('id');
  const name = url.searchParams.get('name');

  if (idStr) {
    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      return new Response(JSON.stringify({ error: 'Invalid ID' }), { status: 400 });
    }
    const opening = getOpeningById(id);
    if (!opening) {
      return new Response(JSON.stringify({ error: 'Opening not found' }), { status: 404 });
    }
    return new Response(JSON.stringify(opening), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (name) {
    const openings = getOpeningsByName(name);
    return new Response(JSON.stringify(openings), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const openings = getOpenings();
  return new Response(JSON.stringify(openings), {
    headers: { 'Content-Type': 'application/json' },
  });
};
