import { describe, expect, it } from 'vitest';
import { buildProfileReplyThreads } from './profileReplyThreads';
const posts = new Map([['old-post', { id: 'old-post', author: 'original author' }], ['new-post', { id: 'new-post', author: 'someone else' }]]);
const reply = (id: string, postId: string, createdAt: string, parentCommentId: string | null = null) => ({ id, postId, createdAt, parentCommentId });
describe('profile replies', () => {
  it('orders each reply by when it was sent rather than grouping by the original post', () => {
    const comments = [reply('first', 'old-post', '2026-10-01'), reply('second', 'new-post', '2026-10-02'), reply('third', 'old-post', '2026-10-03')];
    const threads = buildProfileReplyThreads(comments, posts, new Map(), new Map(), new Map());
    expect(threads.map(t => t.id)).toEqual(['third', 'second', 'first']);
    expect(threads.every(t => t.comments.length === 1)).toBe(true);
  });
  it('shows the actual parent reply, including another author, for a reply to a reply', () => {
    const parent = { ...reply('parent', 'old-post', '2026-10-01'), author: 'actual recipient' };
    const [thread] = buildProfileReplyThreads([reply('child', 'old-post', '2026-10-03', 'parent')], posts, new Map([['parent', parent]]), new Map(), new Map([['parent', ['reaction']]]));
    expect(thread.parentPost).toEqual(posts.get('old-post')); expect(thread.comments.map(c => c.id)).toEqual(['parent', 'child']);
  });
  it('never presents sibling replies as replies to each other', () => {
    const threads = buildProfileReplyThreads([reply('a', 'old-post', '2026-10-01'), reply('b', 'old-post', '2026-10-02')], posts, new Map(), new Map(), new Map());
    expect(threads.map(t => t.parentPost)).toEqual([posts.get('old-post'), posts.get('old-post')]);
  });
  it('does not substitute the original author for an unavailable parent reply', () => {
    const [thread] = buildProfileReplyThreads([reply('child', 'old-post', '2026-10-03', 'missing')], posts, new Map(), new Map(), new Map());
    expect(thread.parentPost).toBeNull(); expect(thread.comments.map(c => c.id)).toEqual(['child']);
  });
  it('keeps every ancestor in order across authors without including another branch', () => {
    const ancestors = [reply('a', 'old-post', '2026-10-01'), reply('b', 'old-post', '2026-10-02', 'a'), reply('c', 'old-post', '2026-10-03', 'b'), reply('sibling', 'old-post', '2026-10-03', 'a')];
    const [thread] = buildProfileReplyThreads([reply('d', 'old-post', '2026-10-04', 'c')], posts, new Map(ancestors.map(c => [c.id, c])), new Map(), new Map());
    expect(thread.comments.map(c => c.id)).toEqual(['a', 'b', 'c', 'd']); expect(thread.createdAt).toBe('2026-10-04');
  });
  it('does not expose a reply whose original post failed the visibility check', () => {
    expect(buildProfileReplyThreads([reply('child', 'hidden', '2026-10-03')], posts, new Map(), new Map(), new Map())).toEqual([]);
  });
});
