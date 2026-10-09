import { beforeEach, describe, it, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({ calls: [] as {
        table: string;
        filters: Record<string, unknown>;
    }[], rpc: vi.fn(), rows: [] as any[] }));
vi.mock('@/lib/uploadPostMedia', () => ({ uploadPostMedia: async (urls: string[]) => urls }));
vi.mock('@/lib/clientName', () => ({ getClientName: () => 'LimeNote' }));
vi.mock('@/lib/currentUser', () => ({ getCurrentUserId: async () => 'viewer' }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: state.rpc, from: (table: string) => {
            const call = { table, filters: {} as Record<string, unknown> };
            state.calls.push(call);
            let single = false;
            const builder: any = { single: () => { single = true; return builder; }, then: (resolve: any) => Promise.resolve({ data: table === 'posts' ? (single ? state.rows[0] : state.rows) : [], error: null }).then(resolve) };
            for (const method of ['insert', 'select', 'eq', 'not', 'gte', 'lte', 'or', 'limit', 'order', 'in', 'ilike', 'abortSignal'])
                builder[method] = (...args: any[]) => { call.filters[`${method}:${args[0]}`] = args.length > 1 ? args.slice(1) : args[0]; return builder; };
            return builder;
        } } }));
import { getMapPosts, setPostMapLocation, createPost } from './posts';
import { normaliseMapLocation } from '@/lib/mapLocation';
beforeEach(() => { state.calls = []; state.rows = [{ id: 'post', user_id: 'author', content: '画像だけでも場所を表示', created_at: '2026-10-09T00:00:00Z', map_latitude: 35, map_longitude: 139, visibility: 'public', profiles: { id: 'author', username: 'author', display_name: '作者' } }]; state.rpc.mockReset().mockResolvedValue({ error: null }); });
describe('LimeMaps API', () => {
    it('fetches only public posts inside the viewport with a bounded page and cancellation', async () => {
        const signal = new AbortController().signal;
        const posts = await getMapPosts({ south: 30, north: 40, west: 130, east: 145 }, undefined, signal);
        const filters = state.calls.find(c => c.table === 'posts')!.filters;
        expect(filters['eq:visibility']).toEqual(['public']);
        expect(filters['gte:map_latitude']).toEqual([30]);
        expect(filters['lte:map_latitude']).toEqual([40]);
        expect(filters['gte:map_longitude']).toEqual([130]);
        expect(filters['lte:map_longitude']).toEqual([145]);
        expect(filters['limit:40']).toBe(40);
        expect(Object.values(filters)).toContain(signal);
        expect(posts[0].mapLocation).toEqual({ latitude: 35, longitude: 139 });
        expect(posts[0].author.displayName).toBe('作者');
    });
    it('combines dateline bounds and timestamp/id pagination without dropping tied timestamps', async () => {
        await getMapPosts({ south: -40, north: 40, west: 170, east: -170 }, { createdAt: '2026-10-09T00:00:00Z', id: 'last-post' });
        const filter = Object.keys(state.calls[0].filters).find(k => k.startsWith('or:'));
        expect(filter).toBe('or:and(or(map_longitude.gte.170,map_longitude.lte.-170),or(created_at.lt.2026-10-09T00:00:00Z,and(created_at.eq.2026-10-09T00:00:00Z,id.lt.last-post)))');
    });
    it('searches the bounded viewport and escapes SQL wildcard characters', async () => {
        await getMapPosts({south:30,north:40,west:130,east:145},undefined,undefined,'#100%_test');
        expect(state.calls[0].filters['ilike:content']).toEqual(['%#100\\%\\_test%']);
    });
    it('updates or removes only location via the authenticated RPC', async () => {
        await setPostMapLocation('post', { latitude: 35, longitude: 139 });
        await setPostMapLocation('post', null);
        expect(state.rpc.mock.calls).toEqual([['set_post_map_location', { post_id: 'post', latitude: 35, longitude: 139 }], ['set_post_map_location', { post_id: 'post', latitude: null, longitude: null }]]);
        expect(state.calls).toHaveLength(0);
    });
    it('saves selected coordinates alongside a new post while normal posts omit the new columns', async () => {
        await createPost({ content: 'map post', imageUrls: [], mapLocation: { latitude: 35, longitude: 139 } });
        let insert = Object.entries(state.calls[0].filters).find(([key]) => key.startsWith('insert:'))![1] as any;
        expect(insert).toMatchObject({ content: 'map post', map_latitude: 35, map_longitude: 139 });
        state.calls = [];
        await createPost({ content: 'normal post', imageUrls: [] });
        insert = Object.entries(state.calls[0].filters).find(([key]) => key.startsWith('insert:'))![1] as any;
        expect(insert).not.toHaveProperty('map_latitude');
        expect(insert).not.toHaveProperty('map_longitude');
    });
    it('rejects invalid coordinates before writing or uploading post media', async () => {
        await expect(setPostMapLocation('post', { latitude: NaN, longitude: 139 })).rejects.toThrow();
        await expect(createPost({ content: 'bad', imageUrls: [], mapLocation: { latitude: 35, longitude: 181 } })).rejects.toThrow();
        expect(state.rpc).not.toHaveBeenCalled();
        expect(state.calls).toHaveLength(0);
    });
    it('surfaces database failures instead of reporting a saved location', async () => {
        state.rpc.mockResolvedValue({ error: new Error('permission denied') });
        await expect(setPostMapLocation('not-own', { latitude: 35, longitude: 139 })).rejects.toThrow('permission denied');
    });
    it('normalises a pin dragged across the international date line', () => { expect(normaliseMapLocation(35.12345678, 540)).toEqual({ latitude: 35.123457, longitude: -180 }); });
});
