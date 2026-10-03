import { GOOGLE_TRENDS_URL, GOOGLE_TRENDING_URL, parseGoogleTrends, parseGoogleTrendingPage, type TrendItem } from './trends.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
let cache: { items: TrendItem[]; expiresAt: number } | undefined;
let pending: Promise<TrendItem[]> | undefined;
async function getTrends(): Promise<TrendItem[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.items;
  if (!pending) pending = (async () => {
    let items: TrendItem[];
    try {
      const response = await fetch(GOOGLE_TRENDING_URL, {signal: AbortSignal.timeout(10_000), headers: {Accept: 'text/html'}});
      if (!response.ok) throw new Error(`Google Trending Now HTTP ${response.status}`);
      items = parseGoogleTrendingPage(await response.text());
    } catch {
      // RSS remains a fallback when the page format changes or cannot load.
      const response = await fetch(GOOGLE_TRENDS_URL, {signal: AbortSignal.timeout(10_000), headers: {Accept: 'application/rss+xml, application/xml, text/xml'}});
      if (!response.ok) throw new Error(`Google Trends RSS HTTP ${response.status}`);
      items = parseGoogleTrends(await response.text(), 200);
    }
    cache = { items, expiresAt: Date.now() + 5 * 60_000 };
    return items;
  })().finally(() => { pending = undefined; });
  return pending;
}
async function isExploreRequest(req: Request): Promise<boolean> {
  if (req.method !== 'POST') return false;
  try { return (await req.json())?.explore === true; } catch { return false; }
}
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!['GET', 'POST'].includes(req.method)) return new Response(null, { status: 405, headers: corsHeaders });
  try {
    return new Response(JSON.stringify((await getTrends()).slice(0, await isExploreRequest(req) ? 200 : 10)), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    });
  } catch {
    // No autocomplete suggestions, invented rankings or fake error trend entries.
    return new Response(JSON.stringify({ error: 'Google Trendsを取得できませんでした' }), {
      status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
});
