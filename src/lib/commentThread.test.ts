import { describe, expect, it } from 'vitest';
import type { CommentWithAuthor } from '@/types';
import { commentThreadUrl, getCommentAncestors } from './commentThread';

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
