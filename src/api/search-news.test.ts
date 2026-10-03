import { beforeEach, expect, it, vi } from 'vitest';
const lookup = vi.hoisted(() => vi.fn());
vi.mock('./posts', () => ({getPostById: lookup}));
import { getNewsSources, type SearchNewsItem } from './search-news';
const news = (id: string, refs: unknown): SearchNewsItem => ({id, title: 'ニュース', content: '', category: 'ニュース', created_at: '', related_post_ids: refs});
beforeEach(() => {lookup.mockReset();});
it('uses quoted originals, deduplicates requests and authors, and counts visible posts', async () => {
  const a = {id: 'a', displayName: 'A'}, b = {id: 'b', displayName: 'B'};
  lookup.mockImplementation(async id => ({author: id === 'second' ? b : a}));
  const result = await getNewsSources([news('one', ['first', 'second', 'first']), news('two', ['first', 'third'])]);
  expect(lookup).toHaveBeenCalledTimes(3);
  expect(result.one).toEqual({authors: [a, b], postsCount: 2});
  expect(result.two).toEqual({authors: [a], postsCount: 2});
});
it('excludes inaccessible and failed originals instead of using saved snapshot avatars', async () => {
  lookup.mockImplementation(async id => {if (id === 'failed') throw new Error('unavailable'); return id === 'private' ? null : {author: {id: 'visible'}};});
  const item = {...news('one', ['private', 'failed', 'public']), related_posts: [{id: 'private', author: {id: 'private-author', avatarUrl: 'private-avatar'}}]};
  expect(await getNewsSources([item])).toEqual({one: {authors: [{id: 'visible'}], postsCount: 1}});
});
it('accepts source object arrays and missing references without inventing avatars', async () => {
  lookup.mockResolvedValue({author: {id: 'a'}});
  expect(await getNewsSources([{...news('one', null), related_posts: [{id: 'first'}, null, {}, 4]}, news('two', undefined)])).toEqual({one: {authors: [{id: 'a'}], postsCount: 1}, two: {authors: [], postsCount: 0}});
});
