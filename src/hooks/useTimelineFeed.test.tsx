import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { PostWithAuthor } from '@/types';

const db = vi.hoisted(() => ({
  handles: ['author'],
  lime: [] as PostWithAuthor[],
  blue: [] as PostWithAuthor[],
  following: [] as PostWithAuthor[],
  initialLime: null as Promise<PostWithAuthor[]> | null,
  initialBlue: null as Promise<{ posts: PostWithAuthor[]; cursor: string | null }> | null,
  limeCalls: vi.fn(), blueCalls: vi.fn(), followingCalls: vi.fn(),
}));
vi.mock('@/api/posts', () => ({
  getFeed: async (page: number, limit: number, before?: { createdAt: string; id: string }) => {
    db.limeCalls(page);
    if (db.initialLime) { const pending = db.initialLime; db.initialLime = null; return pending; }
    const rows = before ? db.lime.filter(row => row.createdAt < before.createdAt || (row.createdAt === before.createdAt && row.id < before.id)) : db.lime;
    return rows.slice(before ? 0 : page * limit, before ? limit : (page + 1) * limit);
  },
  getFollowingFeed: async (page: number, limit: number, before?: { createdAt: string }) => {
    db.followingCalls(page);
    const rows = before ? db.following.filter(row => row.createdAt < before.createdAt) : db.following;
    return rows.slice(before ? 0 : page * limit, before ? limit : (page + 1) * limit);
  },
}));
vi.mock('@/lib/bluesky', () => ({
  getConfiguredBlueskyHandles: () => db.handles,
  fetchBlueskyAuthorFeed: async ({ cursor, limit }: { cursor?: string | null; limit: number }) => {
    db.blueCalls(cursor);
    if (db.initialBlue) { const pending = db.initialBlue; db.initialBlue = null; return pending; }
    const start = Number(cursor ?? 0), end = start + limit;
    return { posts: db.blue.slice(start, end), cursor: end < db.blue.length ? String(end) : null };
  },
}));
import { useTimelineFeed } from './useTimelineFeed';
const post = (id: string, minute: number): PostWithAuthor => ({
  id, userId: 'author', content: id, createdAt: new Date(Date.UTC(2026, 9, 2, 0, minute)).toISOString(),
  imageUrls: [], likesCount: 4, commentsCount: 0, repostsCount: 0, likedByMe: false, repostedByMe: false,
  visibility: 'public', author: { id: 'author', username: 'author', displayName: 'Author', avatarUrl: '', coverUrl: '', bio: '', createdAt: '' },
});
function mount(tab: 'all' | 'following' = 'all') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...renderHook(({ tab }) => ({ ...useTimelineFeed(tab) }), { wrapper, initialProps: { tab } }), client };
}
beforeEach(() => {
  db.handles = ['author']; db.initialLime = null; db.initialBlue = null;
  db.lime = Array.from({ length: 80 }, (_, i) => post(`lime-${i}`, 200 - i * 2));
  db.blue = Array.from({ length: 80 }, (_, i) => post(`bsky-${i}`, 199 - i * 2));
  db.following = [post('followed-lime', 205)];
  db.limeCalls.mockClear(); db.blueCalls.mockClear(); db.followingCalls.mockClear();
});
afterEach(cleanup);

describe('timeline query publication', () => {
  it('does not publish Bluesky before the Lime response on the initial load', async () => {
    let release!: (posts: PostWithAuthor[]) => void;
    db.initialLime = new Promise(resolve => { release = resolve; });
    const view = mount();
    await waitFor(() => expect(db.blueCalls).toHaveBeenCalled());
    expect(view.result.current.data).toBeUndefined();
    expect(view.result.current.isLoading).toBe(true);
    await act(async () => { release(db.lime.slice(0, 10)); });
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(view.result.current.data!.pages[0].posts).toHaveLength(20);
  });
  it('does not publish Lime before the slower Bluesky response either', async () => {
    let release!: (page: { posts: PostWithAuthor[]; cursor: string | null }) => void;
    db.initialBlue = new Promise(resolve => { release = resolve; });
    const view = mount(); await waitFor(() => expect(db.limeCalls).toHaveBeenCalled());
    expect(view.result.current.data).toBeUndefined();
    await act(async () => { release({ posts: db.blue.slice(0, 10), cursor: '10' }); });
    await waitFor(() => expect(view.result.current.data?.pages[0].posts).toHaveLength(20));
  });
  it('keeps both sources in the fourth and fifth query pages', async () => {
    const view = mount(); await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    for (let i = 1; i < 5; i++) {
      await act(async () => { await view.result.current.fetchNextPage(); });
      await waitFor(() => expect(view.result.current.data?.pages).toHaveLength(i + 1));
    }
    expect(view.result.current.data!.pages).toHaveLength(5);
    for (const page of view.result.current.data!.pages) {
      expect(page.posts.filter(row => row.id.startsWith('lime-'))).toHaveLength(10);
      expect(page.posts.filter(row => row.id.startsWith('bsky-'))).toHaveLength(10);
    }
  });
  it('keeps a separate source cursor for the following tab', async () => {
    const view = mount(); await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    view.rerender({ tab: 'following' });
    await waitFor(() => expect(db.followingCalls).toHaveBeenCalledWith(0));
    await waitFor(() => expect(view.result.current.data?.pages[0].posts.some(row => row.id === 'followed-lime')).toBe(true));
    expect(view.result.current.data!.pages.flatMap(page => page.posts).some(row => row.id.startsWith('lime-'))).toBe(false);
  });
  it('preserves the loaded page if an additional Lime read fails rather than publishing Bluesky alone', async () => {
    const view = mount(); await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    const previous = view.result.current.data;
    // Simulate a read failure before either source can commit a new page.
    db.initialLime = Promise.reject(new Error('Lime offline'));
    await act(async () => { await view.result.current.fetchNextPage(); });
    await waitFor(() => expect(view.result.current.isFetchNextPageError).toBe(true));
    expect(view.result.current.data).toBe(previous);
  });
});
