import { validMapLocation, type MapPostPin, type MapBounds } from '../../../src/lib/mapLocation.ts';
import { inferPostPlace, mapPlaceSearchTerms } from './places.ts';
import { loadMisskey } from './load.ts';

type Job = { provider: 'bluesky' | 'misskey'; query: string; cursor?: string };
const cache = new Map<string, { expires: number; value: { pins: MapPostPin[]; next: Job[] } }>();
export function mapSearchJobs(bounds: unknown, search: unknown = ''): Job[] {
    const area=bounds as MapBounds;
    if(!area || ![area.south,area.north,area.west,area.east].every(Number.isFinite) || area.south < -90 || area.north > 90 || area.south > area.north || Math.abs(area.west)>180 || Math.abs(area.east)>180 || typeof search!=='string' || search.length>100)throw new Error('Invalid map bounds');
    const term=search.trim();
    const queries=[...new Set(mapPlaceSearchTerms(area).map(query=>term?`${query} ${term}`:query).concat(term?[term]:[]).map(query=>query.slice(0,100)))];
    return queries.flatMap(query=>[{provider:'bluesky' as const,query},{provider:'misskey' as const,query}]);
}
export async function loadMapPins(input: unknown, reader: typeof fetch = fetch) {
    if (!Array.isArray(input) || input.length > 4) throw new Error('Invalid map searches');
    const jobs: Job[] = input.map(job => {
        if (!job || !['bluesky','misskey'].includes(job.provider) || typeof job.query !== 'string' || !job.query.trim() || job.query.length > 100 ||
            (job.cursor !== undefined && (typeof job.cursor !== 'string' || job.cursor.length > 512))) throw new Error('Invalid map search');
        return { provider: job.provider, query: job.query, ...(job.cursor ? { cursor: job.cursor } : {}) };
    });
    const key = JSON.stringify(jobs), stored = cache.get(key);
    if (stored && stored.expires > Date.now()) return stored.value;
    const pins: MapPostPin[] = [], next: Job[] = [];
    const results = await Promise.allSettled(jobs.map(async job => {
        let rows: any[], cursor: string | undefined;
        if (job.provider === 'bluesky') {
            const params = new URLSearchParams({ q: job.query, limit: '100', sort: 'latest' });
            if (job.cursor) params.set('cursor', job.cursor);
            let response: Response | undefined;
            for (const host of ['api.bsky.app','public.api.bsky.app']) {
                try { response = await reader(`https://${host}/xrpc/app.bsky.feed.searchPosts?${params}`, { signal: AbortSignal.timeout(15000) }); if(response.ok)break; } catch { /* Try the other official reader. */ }
            }
            if (!response?.ok) throw new Error(`Bluesky search ${response?.status ?? 'unavailable'}`);
            const data = await response.json(); rows = data.posts ?? []; cursor = data.cursor;
        } else {
            rows = await loadMisskey('notes/search', { query: job.query, limit: 100, ...(job.cursor ? { untilId: job.cursor } : {}) }) as any[];
            cursor = rows.length === 100 ? rows.at(-1)?.id : undefined;
        }
        if (cursor && cursor !== job.cursor) next.push({ ...job, cursor });
        for (const row of rows) {
            if (job.provider === 'misskey' && row.visibility !== 'public') continue;
            const point = inferPostPlace(job.provider === 'bluesky' ? row.record?.text ?? '' : row.text ?? '');
            const id = job.provider === 'bluesky' ? (typeof row.uri === 'string' && /^at:\/\/[^/]+\/app\.bsky\.feed\.post\/[^/]+$/.test(row.uri) ? `bsky:${row.uri}` : null) : (typeof row.id === 'string' && /^[A-Za-z0-9]+$/.test(row.id) ? `misskey:https://misskey.io/notes/${row.id}` : null);
            if (!point || !validMapLocation(point) || !id) continue;
            pins.push({ id, createdAt: job.provider === 'bluesky' ? row.record?.createdAt ?? row.indexedAt : row.createdAt, source: job.provider, mapLocation: point });
        }
    }));
    if (jobs.length && results.every(result => result.status === 'rejected')) throw new Error('Map providers unavailable');
    const value = { pins: [...new Map(pins.map(pin => [pin.id, pin])).values()], next };
    // Cache only position/ID projections, never post bodies or images.
    if (results.every(result => result.status === 'fulfilled')) {
        if (cache.size >= 100) cache.delete(cache.keys().next().value!);
        cache.set(key, { expires: Date.now()+300000, value });
    }
    return value;
}
