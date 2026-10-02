import type { CommentWithAuthor } from '@/types';

export function commentThreadUrl(postId: string, commentId: string) {
  return `/post/${encodeURIComponent(postId)}?reply=${encodeURIComponent(commentId)}`;
}

// Iterative traversal supports arbitrary depth without a recursive render or
// one HTTP request per ancestor. Reject malformed/cyclic chains safely.
export function getCommentAncestors(comments: CommentWithAuthor[], commentId: string) {
  const byId = new Map(comments.map(comment => [comment.id, comment]));
  const chain: CommentWithAuthor[] = [];
  const seen = new Set<string>();
  let current = byId.get(commentId);
  if (!current) return null;
  while (current) {
    if (seen.has(current.id)) return null;
    seen.add(current.id);
    chain.push(current);
    if (!current.parentCommentId) break;
    current = byId.get(current.parentCommentId);
    if (!current) return null;
  }
  return chain.reverse();
}
