import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  follows: [] as { follower_id: string; followee_id: string }[],
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
      then: (resolve: (value: unknown) => void) => {
        db.calls.push(call);
        const data = table === 'follows'
          ? db.follows.filter(row => (!call.filters.follower_id || row.follower_id === call.filters.follower_id)
            && row.followee_id === call.filters.followee_id)
          : [];
        return Promise.resolve({ data, error: null }).then(resolve);
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
  db.follows = [{ follower_id: 'author', followee_id: 'viewer' }];
});

describe('profile permission request scope', () => {
  it.each([useUserPostsInfinite, useUserMediaInfinite])('skips follower lookup for own profile', async hook => {
    await run(hook('viewer'));
    expect(db.calls.some(call => call.table === 'follows')).toBe(false);
    expect(db.calls.find(call => call.table === 'posts')?.filters.visibility).toBeUndefined();
    expect(db.calls.find(call => call.table === 'posts')?.select).not.toContain('author:user_id(*)');
    expect(db.calls.find(call => call.table === 'posts')?.select).toContain('bot_prompt');
  });
  it.each([useUserPostsInfinite, useUserMediaInfinite])('checks only the profile owner and preserves following access', async hook => {
    await run(hook('author'));
    expect(db.calls.find(call => call.table === 'follows')?.filters).toEqual({ follower_id: 'author', followee_id: 'viewer' });
    expect(db.calls.find(call => call.table === 'posts')?.filters.visibility).toEqual(['public', 'following']);
  });
  it.each([useUserPostsInfinite, useUserMediaInfinite])('keeps public-only access when owner does not follow viewer', async hook => {
    db.follows = [];
    await run(hook('author'));
    expect(db.calls.find(call => call.table === 'posts')?.filters.visibility).toBe('public');
  });
  it.each([useUserLikesInfinite, useUserReactionsInfinite])('retains cross-author access checks for likes/reactions tabs', async hook => {
    await run(hook('author'));
    expect(db.calls.find(call => call.table === 'follows')?.filters).toEqual({ followee_id: 'viewer' });
  });
});
