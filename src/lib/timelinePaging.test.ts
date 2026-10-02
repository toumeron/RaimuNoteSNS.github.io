import { describe, expect, it, vi } from 'vitest';
import type { PostWithAuthor } from '@/types';
import type { BlueskyAuthorFeedPage } from './bluesky';
import { createTimelineCursor, loadTimelinePage, type TimelineCursor, type TimelineSources } from './timelinePaging';

const post = (id: string, minute: number): PostWithAuthor => ({
  id, userId: 'author', content: id, createdAt: new Date(Date.UTC(2026, 9, 2, 0, minute)).toISOString(),
  imageUrls: [], likesCount: 3, commentsCount: 0, repostsCount: 0, likedByMe: false, repostedByMe: false,
  visibility: 'public', author: { id: 'author', username: 'author', displayName: 'Author', avatarUrl: '', coverUrl: '', bio: '', createdAt: '' },
});
const mapped = (posts: PostWithAuthor[]): BlueskyAuthorFeedPage['posts'] => posts as unknown as BlueskyAuthorFeedPage['posts'];
function sourcesFor(lime: PostWithAuthor[], bluesky: Record<string, PostWithAuthor[]>): TimelineSources {
  return {
    lime: vi.fn(async (page, limit, before) => {
      const eligible = before ? lime.filter(post => post.createdAt < before.createdAt || (post.createdAt === before.createdAt && post.id < before.id)) : lime;
      return eligible.slice(before ? 0 : page * limit, before ? limit : (page + 1) * limit);
    }),
    bluesky: vi.fn(async (handle, cursor, limit) => {
      const start = Number(cursor ?? 0), end = start + limit;
      const all = bluesky[handle] ?? [];
      return { posts: mapped(all.slice(start, end)), cursor: end < all.length ? String(end) : null };
    }),
  };
}

describe('paired chronological timeline pagination', () => {
  it('continues both sources past the third load with no lost posts or reordered earlier pages', async () => {
    const lime = Array.from({ length: 80 }, (_, i) => post(`lime-${i}`, 200 - i * 2));
    const blue = Array.from({ length: 80 }, (_, i) => post(`bsky-${i}`, 199 - i * 2));
    const sources = sourcesFor(lime, { author: blue });
    let cursor: TimelineCursor | undefined = createTimelineCursor(['author']);
    const all: PostWithAuthor[] = [];
    for (let pageIndex = 0; cursor; pageIndex++) {
      const page = await loadTimelinePage(cursor, sources);
      if (pageIndex < 8) {
        expect(page.posts.filter(post => post.id.startsWith('lime-'))).toHaveLength(10);
        expect(page.posts.filter(post => post.id.startsWith('bsky-'))).toHaveLength(10);
      }
      if (all.length && page.posts.length) expect(all[all.length - 1].createdAt >= page.posts[0].createdAt).toBe(true);
      all.push(...page.posts); cursor = page.next;
      expect(pageIndex).toBeLessThan(10);
    }
    expect(all).toHaveLength(160);
    expect(new Set(all.map(post => post.id)).size).toBe(160);
  });
  it('starts Lime and Bluesky together and does not publish the faster response alone', async () => {
    const lime = Array.from({ length: 10 }, (_, i) => post(`lime-${i}`, 40 - i * 2));
    const blue = Array.from({ length: 10 }, (_, i) => post(`bsky-${i}`, 39 - i * 2));
    let release!: (posts: PostWithAuthor[]) => void;
    const limeCall = vi.fn((page: number) => page === 0
      ? new Promise<PostWithAuthor[]>(resolve => { release = resolve; })
      : Promise.resolve([]));
    const blueCall = vi.fn(async () => ({ posts: mapped(blue), cursor: null }));
    let published = false;
    const request = loadTimelinePage(createTimelineCursor(['author']), { lime: limeCall, bluesky: blueCall }).then(page => { published = true; return page; });
    expect(limeCall).toHaveBeenCalledTimes(1); expect(blueCall).toHaveBeenCalledTimes(1);
    await Promise.resolve(); await Promise.resolve(); expect(published).toBe(false);
    release(lime); const page = await request;
    expect(page.posts).toHaveLength(20);
  });
  it('keeps enough lookahead for sources with very different dates', async () => {
    const lime = Array.from({ length: 65 }, (_, i) => post(`lime-${i}`, 200 - i));
    const blue = Array.from({ length: 65 }, (_, i) => post(`bsky-${i}`, 100 - i));
    const sources = sourcesFor(lime, { author: blue });
    let cursor: TimelineCursor | undefined = createTimelineCursor(['author']);
    const all: PostWithAuthor[] = [];
    while (cursor) { const page = await loadTimelinePage(cursor, sources); all.push(...page.posts); cursor = page.next; }
    expect(all.slice(0, 65).map(post => post.id)).toEqual(lime.map(post => post.id));
    expect(all.slice(65).map(post => post.id)).toEqual(blue.map(post => post.id));
    expect(sources.bluesky).toHaveBeenCalledTimes(7);
  });
  it('keeps paging empty filtered Bluesky pages that still have a cursor', async () => {
    const sources = sourcesFor([], {});
    sources.bluesky = vi.fn(async (_, cursor) => cursor === null
      ? { posts: [], cursor: 'next' }
      : { posts: mapped([post('bsky-valid', 1)]), cursor: null });
    const page = await loadTimelinePage(createTimelineCursor(['author']), sources);
    expect(page.posts.map(post => post.id)).toEqual(['bsky-valid']); expect(page.next).toBeUndefined();
  });
  it('does not advance the saved cursor on source failure, allowing a complete retry', async () => {
    const cursor = createTimelineCursor(['author']);
    const saved = structuredClone(cursor);
    const sources = sourcesFor([post('lime', 2)], { author: [post('blue', 1)] });
    const real = sources.lime;
    sources.lime = vi.fn(async () => { throw new Error('offline'); });
    await expect(loadTimelinePage(cursor, sources)).rejects.toThrow('offline');
    expect(cursor).toEqual(saved);
    sources.lime = real; expect((await loadTimelinePage(cursor, sources)).posts).toHaveLength(2);
  });
  it('continues Lime normally when no Bluesky accounts are configured', async () => {
    const lime = Array.from({ length: 47 }, (_, i) => post(`lime-${i}`, 100 - i));
    const sources = sourcesFor(lime, {}); let cursor: TimelineCursor | undefined = createTimelineCursor([]);
    const all: PostWithAuthor[] = [];
    while (cursor) { const page = await loadTimelinePage(cursor, sources); all.push(...page.posts); cursor = page.next; }
    expect(all).toEqual(lime); expect(sources.bluesky).not.toHaveBeenCalled();
  });
  it('merges multiple authors without skipping Lime or prematurely ending other sources', async () => {
    const lime = Array.from({ length: 22 }, (_, i) => post(`lime-${i}`, 99 - i * 3));
    const first = Array.from({ length: 23 }, (_, i) => post(`blue-a-${i}`, 98 - i * 3));
    const second = Array.from({ length: 25 }, (_, i) => post(`blue-b-${i}`, 97 - i * 3));
    const sources = sourcesFor(lime, { first, second }); let cursor: TimelineCursor | undefined = createTimelineCursor(['first', 'second']);
    const all: PostWithAuthor[] = [];
    while (cursor) { const page = await loadTimelinePage(cursor, sources); all.push(...page.posts); cursor = page.next; }
    expect(all).toHaveLength(70);
    expect(all.filter(post => post.id.startsWith('lime-'))).toEqual(lime);
    expect(all.every((post, index) => !index || all[index - 1].createdAt >= post.createdAt)).toBe(true);
  });
  it('uses a timestamp/ID boundary so new real-time inserts do not shift later Lime pages', async () => {
    const lime = Array.from({ length: 45 }, (_, i) => post(`lime-${i}`, 100 - i));
    const sources = sourcesFor(lime, {});
    const first = await loadTimelinePage(createTimelineCursor([]), sources);
    lime.unshift(post('new-realtime', 101));
    const second = await loadTimelinePage(first.next!, sources);
    expect(second.posts.map(post => post.id)).toEqual(lime.slice(21, 41).map(post => post.id));
    expect(second.posts.some(post => first.posts.some(previous => previous.id === post.id))).toBe(false);
  });
});
