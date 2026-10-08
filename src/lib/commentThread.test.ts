import { describe, expect, it } from 'vitest';
import type { CommentWithAuthor } from '@/types';
import { commentThreadUrl, getCommentAncestors, getAuthorReplyConversations } from './commentThread';

const comment = (id: string, parentCommentId: string | null = null) => ({ id, parentCommentId, postId: 'post' } as CommentWithAuthor);
describe('reply ancestry', () => {
  it('supports deep threads without recursion or a fixed depth limit', () => {
    const rows = Array.from({ length: 10000 }, (_, i) => comment(String(i), i ? String(i - 1) : null));
    const chain = getCommentAncestors(rows, '9999');
    expect(chain).toHaveLength(10000);
    expect(chain?.[0].id).toBe('0');
    expect(chain?.[9999].id).toBe('9999');
  });
  it('includes only the selected branch, not siblings', () => {
    expect(getCommentAncestors([comment('a'), comment('b', 'a'), comment('c', 'a'), comment('d', 'b')], 'd')?.map(c => c.id)).toEqual(['a', 'b', 'd']);
  });
  it('rejects cyclic and incomplete chains safely', () => {
    expect(getCommentAncestors([comment('a', 'b'), comment('b', 'a')], 'a')).toBeNull();
    expect(getCommentAncestors([comment('a', 'missing')], 'a')).toBeNull();
    expect(getCommentAncestors([], 'missing')).toBeNull();
  });
  it('links to the reply while preserving the original post route', () => {
    expect(commentThreadUrl('post', 'reply')).toBe('/post/post?reply=reply');
  });
});

describe('original author replies', () => {
  const reply = (id: string, userId: string, parentCommentId: string | null, createdAt: string) => ({ ...comment(id, parentCommentId), userId, createdAt });
  const ids = (result: ReturnType<typeof getAuthorReplyConversations>[number]) => result.branches.map(branch => branch.items.map(c => c.id));
  it('prioritizes answered roots and follows only the path to the original author', () => {
    const rows = [reply('new', 'visitor', null, '2026-10-08'), reply('question', 'visitor', null, '2026-10-01'), reply('middle', 'other', 'question', '2026-10-02'), reply('answer', 'host', 'middle', '2026-10-03'), reply('unrelated', 'other', 'question', '2026-10-04')];
    const conversations = getAuthorReplyConversations(rows, 'host');
    expect(conversations.map(c => c.root.id)).toEqual(['question', 'new']);
    expect(ids(conversations[0])).toEqual([['question', 'middle', 'answer']]);
    expect(conversations[0].hasHiddenReplies).toBe(false);
  });
  it('does not show an ancestor sibling before or after expanding the host answer', () => {
    const rows = [reply('cat', 'visitor', null, '2026-10-01'), reply('sibling', 'visitor', 'cat', '2026-10-02'), reply('host', 'host', 'cat', '2026-10-03'), reply('host-child', 'host', 'host', '2026-10-04')];
    const before = getAuthorReplyConversations(rows, 'host')[0];
    expect(ids(before)).toEqual([['cat', 'host']]);
    expect([...before.hiddenReplyIds]).toEqual(['host']);
    expect(before.branches[0].moreFor?.id).toBe('host');
    const after = getAuthorReplyConversations(rows, 'host', null, new Set(['host']))[0];
    expect(ids(after)).toEqual([['cat', 'host', 'host-child']]);
    expect(after.items.some(c => c.id === 'sibling')).toBe(false);
    expect(after.hasHiddenReplies).toBe(false);
  });
  it('does not put a button on a zero-reply host answer because its parent has other replies', () => {
    const rows = [reply('cat', 'visitor', null, '2026-10-01'), reply('host', 'host', 'cat', '2026-10-02'), reply('sibling', 'visitor', 'cat', '2026-10-03')];
    const result = getAuthorReplyConversations(rows, 'host')[0];
    expect(ids(result)).toEqual([['cat', 'host']]);
    expect(result.hasHiddenReplies).toBe(false);
    expect(result.branches[0].moreFor).toBeNull();
  });
  it('chooses one author branch rather than flattening sibling author answers', () => {
    const rows = [reply('question', 'visitor', null, '2026-10-01'), reply('late', 'host', 'question', '2026-10-03'), reply('early', 'host', 'question', '2026-10-02')];
    expect(ids(getAuthorReplyConversations(rows, 'host')[0])).toEqual([['question', 'early']]);
  });
  it('keeps third-party replies out of the automatic author conversation', () => {
    const rows = [reply('question', 'visitor', null, '2026-10-01'), reply('child', 'other', 'question', '2026-10-02')];
    const result = getAuthorReplyConversations(rows, 'host')[0];
    expect(ids(result)).toEqual([['question']]);
    expect(result.threadIds.size).toBe(0);
    expect(result.hasHiddenReplies).toBe(false);
  });
  it('expands only direct children of the selected terminal reply', () => {
    const rows = [reply('question', 'visitor', null, '2026-10-01'), reply('answer', 'host', 'question', '2026-10-02'), reply('continuation', 'host', 'answer', '2026-10-03'), reply('deep', 'host', 'continuation', '2026-10-04'), reply('unrelated', 'other', 'question', '2026-10-05')];
    const result = getAuthorReplyConversations(rows, 'host', null, new Set(['answer']))[0];
    expect(ids(result)).toEqual([['question', 'answer', 'continuation']]);
    expect([...result.hiddenReplyIds]).toEqual(['continuation']);
    expect(result.branches[0].moreFor?.id).toBe('continuation');
  });
  it('keeps multiple actual children of the expanded reply in their own branches', () => {
    const rows = [reply('root', 'visitor', null, '2026-10-01'), reply('answer', 'host', 'root', '2026-10-02'), reply('a', 'host', 'answer', '2026-10-03'), reply('b', 'host', 'answer', '2026-10-04')];
    const result = getAuthorReplyConversations(rows, 'host', null, new Set(['answer']))[0];
    expect(ids(result)).toEqual([['root', 'answer', 'a'], ['root', 'answer', 'b']]);
  });
  it('uses the original author when the selected page is a reply', () => {
    const rows = [reply('question', 'visitor', null, '2026-10-01'), reply('child', 'other', 'question', '2026-10-02'), reply('answer', 'host', 'child', '2026-10-03')];
    expect(ids(getAuthorReplyConversations(rows, 'host', 'question')[0])).toEqual([['child', 'answer']]);
  });
  it('rejects duplicate roots and avoids cycles', () => {
    const rows = [reply('question', 'visitor', null, '2026-10-01'), reply('answer', 'host', 'question', '2026-10-02'), reply('cycle', 'host', 'cycle', '2026-10-03')];
    expect(getAuthorReplyConversations([...rows, rows[0]], 'host').map(ids)).toEqual([[['question', 'answer']]]);
  });
  it('uses connector styling only through the author answer, even after expansion', () => {
    const rows = [reply('root', 'visitor', null, '2026-10-01'), reply('answer', 'host', 'root', '2026-10-02'), reply('other', 'visitor', 'answer', '2026-10-03')];
    const result = getAuthorReplyConversations(rows, 'host', null, new Set(['answer']))[0];
    expect(ids(result)).toEqual([['root', 'answer']]);
    expect(result.hasHiddenReplies).toBe(false);
    expect([...result.threadIds]).toEqual(['root', 'answer']);
    expect(result.threadIds.has('other')).toBe(false);
  });
  it('does not treat a root written by the author as an author reply to someone else', () => {
    const rows = [reply('root', 'host', null, '2026-10-01'), reply('other', 'visitor', 'root', '2026-10-02')];
    const result = getAuthorReplyConversations(rows, 'host')[0];
    expect(ids(result)).toEqual([['root']]);
    expect(result.threadIds.size).toBe(0);
    expect(result.hasHiddenReplies).toBe(false);
  });

  it('excludes a third-party-only continuation even when expansion state requests it', () => {
    const rows = [reply('cat', 'visitor', null, '2026-10-01'), reply('answer', 'host', 'cat', '2026-10-02'), reply('unrelated-sibling', 'visitor', 'cat', '2026-10-03'), reply('lime', 'other', 'answer', '2026-10-04')];
    for (const expanded of [new Set<string>(), new Set(['answer']), new Set(['cat', 'answer'])]) {
      const result = getAuthorReplyConversations(rows, 'host', null, expanded)[0];
      expect(ids(result)).toEqual([['cat', 'answer']]);
      expect(result.items.some(c => c.id === 'lime' || c.id === 'unrelated-sibling')).toBe(false);
      expect(result.hasHiddenReplies).toBe(false);
    }
  });

});
