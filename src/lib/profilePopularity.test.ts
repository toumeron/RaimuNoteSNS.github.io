import { expect, it, vi } from 'vitest';
import { collectProfilePages } from './profilePopularity';
import { selectProfilePosts } from './profilePostOptions';

it.each(['lime', 'bsky', 'misskey'])('%s ranks older popular posts before revealing stable pages', async provider => {
  const newest = Array.from({ length: 20 }, (_, i) => ({ id: `${provider}:new-${i}`, likesCount: 1, createdAt: '2026-10-11' }));
  const older = { id: `${provider}:older-popular`, likesCount: 100, createdAt: '2026-10-01' };
  const load = vi.fn(async (cursor: string | null) => cursor === null
    ? { posts: newest, cursor: 'older' }
    : { posts: [older], cursor: null });
  const snapshot = await collectProfilePages(load);
  const ranked = selectProfilePosts(snapshot, 'all', 'popular');
  const firstPage = ranked.slice(0, 20);
  expect(firstPage[0]).toEqual(older);
  expect(ranked.slice(0, 40).slice(0, 20)).toEqual(firstPage);
  expect(load).toHaveBeenCalledTimes(2);
});
it('continues past pages containing only hidden or filtered posts', async () => {
  const load = vi.fn(async (cursor: string | null) => cursor === null
    ? { posts: [] as string[], cursor: 'next' }
    : { posts: ['public'], cursor: null });
  expect(await collectProfilePages(load)).toEqual(['public']);
});
it('does not publish an incomplete ranking after a later page fails', async () => {
  const load = vi.fn().mockResolvedValueOnce({ posts: ['new'], cursor: 'next' }).mockRejectedValueOnce(new Error('offline'));
  await expect(collectProfilePages(load)).rejects.toThrow('offline');
});
it('rejects a stalled cursor rather than fetching forever', async () => {
  const load = vi.fn().mockResolvedValue({ posts: [], cursor: 'same' });
  await expect(collectProfilePages(load)).rejects.toThrow('カーソル');
  expect(load).toHaveBeenCalledTimes(2);
});
it('stops before fetching the next page when cancelled', async () => {
  const controller = new AbortController();
  const load = vi.fn(async () => { controller.abort(); return { posts: ['new'], cursor: 'next' }; });
  await expect(collectProfilePages(load, controller.signal)).rejects.toThrow();
  expect(load).toHaveBeenCalledTimes(1);
});
