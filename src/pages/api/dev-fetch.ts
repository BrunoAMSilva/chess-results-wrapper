import type { APIRoute } from 'astro';
import { scrapeFullTournament } from '../../lib/scraper';

export const POST: APIRoute = async ({ request }) => {
  if (!import.meta.env.DEV) {
    return new Response(JSON.stringify({ error: 'Dev only' }), { status: 403 });
  }

  const { tid } = await request.json();
  if (!tid || typeof tid !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing tid' }), { status: 400 });
  }

  try {
    await scrapeFullTournament(tid);
    return new Response(JSON.stringify({ ok: true, tid }));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Scrape failed';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};
