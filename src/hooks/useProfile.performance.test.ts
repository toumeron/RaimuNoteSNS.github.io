import {renderHook} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  follows: [] as { follower_id: string; followee_id: string }[],
  likes: [] as any[],
  calls: [] as { table: string; filters: Record<string, unknown>; select: string }[],
}));
vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: (options: unknown) => options,
  useQuery: (options: unknown) => options,
  useMutation: vi.fn(), useQueryClient: vi.fn(),
}));
vi.mock('@/lib/currentUser', () => ({ getCurrentUserId: async () => 'viewer' }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const call = { table, filters: {} as Record<string, unknown>, select: '' };
    const builder = {
      select: (columns: string) => { call.select = columns; return builder; },
      eq: (column: string, value: unknown) => { call.filters[column] = value; return builder; },
      in: (column: string, value: unknown[]) => { call.filters[column] = value; return builder; },
      or: () => builder, order: () => builder, range: () => builder,
      maybeSingle: () => { call.filters.single = true; return builder; },
      then: (resolve: (value: unknown) => void) => {
        db.calls.push(call);
        const data = table === 'follows'
          ? db.follows.filter(row => (!call.filters.follower_id || row.follower_id === call.filters.follower_id)
            && row.followee_id === call.filters.followee_id)
          : table==='likes'?db.likes:[];
        return Promise.resolve({ data: call.filters.single ? data[0] ?? null : data, error: null }).then(resolve);
      },
    };
    return builder;
  },
} }));

import { useUserPostsInfinite, useUserMediaInfinite, useUserLikesInfinite, useUserReactionsInfinite } from './useProfile';
type QueryOptions = { queryFn: (context: { pageParam: number }) => Promise<unknown> };
const run = (options: unknown) => (options as QueryOptions).queryFn({ pageParam: 0 });
beforeEach(() => {
  db.calls.length = 0;
  db.likes=[];
  db.follows = [{ follower_id: 'author', followee_id: 'viewer' }];
});

describe('profile permission request scope', () => {
  it.each([useUserPostsInfinite, useUserMediaInfinite])('skips follower lookup for own profile', async hook => {
    await run(renderHook(()=>hook('viewer')).result.current);
    expect(db.calls.some(call => call.table === 'follows')).toBe(false);
    expect(db.calls.find(call => call.table === 'posts')?.filters.visibility).toBeUndefined();
    expect(db.calls.find(call => call.table === 'posts')?.select).not.toContain('author:user_id(*)');
    expect(db.calls.find(call => call.table === 'posts')?.select).toContain(hook === useUserPostsInfinite ? 'parent_post:parent_id' : 'bot_prompt');
  });
  it.each([useUserPostsInfinite, useUserMediaInfinite])('checks only the profile owner and preserves following access', async hook => {
    await run(renderHook(()=>hook('author')).result.current);
    expect(db.calls.find(call => call.table === 'follows')?.filters).toMatchObject({ follower_id: 'author', followee_id: 'viewer' });
    expect(db.calls.find(call => call.table === 'posts')?.filters.visibility).toEqual(['public', 'following']);
  });
  it.each([useUserPostsInfinite, useUserMediaInfinite])('keeps public-only access when owner does not follow viewer', async hook => {
    db.follows = [];
    await run(renderHook(()=>hook('author')).result.current);
    expect(db.calls.find(call => call.table === 'posts')?.filters.visibility).toEqual(hook === useUserPostsInfinite ? ['public'] : 'public');
  });
  it.each([useUserLikesInfinite, useUserReactionsInfinite])('retains cross-author access checks for likes/reactions tabs', async hook => {
    await run(renderHook(()=>hook('author')).result.current);
    expect(db.calls.find(call => call.table === 'follows')?.filters).toEqual({ followee_id: 'viewer' });
  });
});

 it('mixes cloud Bluesky/Misskey snapshots with native likes while filtering inaccessible native posts',async()=>{
  const native=(id:string,visibility:string)=>({id,user_id:'other',content:'native',image_urls:[],visibility,author:{id:'other',username:'other'}});
  const external=(id:string)=>({id,userId:'external',content:'',imageUrls:['https://example.com/art.jpg'],visibility:'public',author:{id:'external',username:'artist'}});
  db.likes=[{posts:native('visible','public')},{posts:native('hidden','private')},{post_snapshot:external('bsky:at://did:plc:artist/app.bsky.feed.post/abc'),posts:null},{post_snapshot:external('misskey:https://misskey.io/notes/abc'),posts:null}];
  const rows=await run(renderHook(()=>useUserLikesInfinite('viewer')).result.current) as any[];
  expect(rows.map(row=>row.posts.id)).toEqual(['visible','bsky:at://did:plc:artist/app.bsky.feed.post/abc','misskey:https://misskey.io/notes/abc']);
  expect(rows[1].posts.imageUrls).toEqual(['https://example.com/art.jpg']);
  expect(db.calls.find(call=>call.table==='likes')?.select).not.toContain('posts!inner');
 });
