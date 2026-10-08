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

// Use the already loaded thread: reveal paths to the original author's replies
// without fetching each branch separately or exposing unrelated descendants.
export function getAuthorReplyConversations(comments: CommentWithAuthor[], authorId?: string, parentCommentId: string | null = null, expandedReplies: ReadonlySet<string> = new Set()) {
  const byId = new Map(comments.map(comment => [comment.id, comment]));
  const children = new Map<string | null, CommentWithAuthor[]>();
  for (const comment of byId.values()) {
    const parent = comment.parentCommentId ?? null;
    const siblings = children.get(parent) ?? [];
    siblings.push(comment);
    children.set(parent, siblings);
  }
  const paths = new Set<string>();
  if (authorId) for (const comment of byId.values()) {
    if (comment.userId !== authorId) continue;
    let current: CommentWithAuthor | undefined = comment;
    while (current && current.id !== parentCommentId && !paths.has(current.id)) {
      paths.add(current.id);
      current = current.parentCommentId ? byId.get(current.parentCommentId) : undefined;
    }
  }
  const newest = (a: CommentWithAuthor, b: CommentWithAuthor) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id);
  const answeredByAuthor = (comment: CommentWithAuthor) => (children.get(comment.id) ?? []).some(reply => paths.has(reply.id));
  const roots = [...(children.get(parentCommentId) ?? [])].sort((a, b) => Number(answeredByAuthor(b)) - Number(answeredByAuthor(a)) || newest(a, b));
  return roots.map(root => {
    const items: CommentWithAuthor[] = [], seen = new Set<string>();
    const stack = [root];
    const hasAuthorReply = answeredByAuthor(root);
    const hiddenReplyIds = new Set<string>();
    while (stack.length) {
      const current = stack.pop()!;
      if (seen.has(current.id)) continue;
      seen.add(current.id);
      items.push(current);
      // Inline previews only contain paths leading to an author reply.
      // Expanding cannot broaden this to unrelated third-party descendants.
      const replies = (children.get(current.id) ?? []).filter(reply => paths.has(reply.id));
      const expanded = expandedReplies.has(current.id);
      const ordered = [...replies].sort(newest).reverse();
      const continuation = current.id === root.id || current.userId !== authorId ? ordered[0] : undefined;
      const visible = (reply: CommentWithAuthor) => expanded || reply.id === continuation?.id;
      if (hasAuthorReply && replies.length && !replies.some(visible)) hiddenReplyIds.add(current.id);
      // Oldest first inside a conversation so the answer follows its question.
      stack.push(...replies.filter(visible).sort(newest));
    }
    // Each visible branch carries its own ancestry. A sibling starts another
    // conversation, rather than appearing below an unrelated answer.
    const visibleIds = new Set(items.map(comment => comment.id));
    const hasVisibleChildren = (comment: CommentWithAuthor) => (children.get(comment.id) ?? []).some(child => visibleIds.has(child.id));
    const ancestry = (comment: CommentWithAuthor) => {
      const path: CommentWithAuthor[] = [], visited = new Set<string>();
      let current: CommentWithAuthor | undefined = comment;
      while (current && visibleIds.has(current.id) && !visited.has(current.id)) {
        visited.add(current.id);
        path.push(current);
        if (current.id === root.id) break;
        current = current.parentCommentId ? byId.get(current.parentCommentId) : undefined;
      }
      return path.reverse();
    };
    const branches = items.filter(comment => !hasVisibleChildren(comment)).map(comment => ({
      items: ancestry(comment), moreFor: hiddenReplyIds.has(comment.id) ? comment : null,
    }));
    const threadIds = new Set(hasAuthorReply ? items.filter(comment => paths.has(comment.id)).map(comment => comment.id) : []);
    return { root, items, branches, threadIds, hiddenReplyIds, hasHiddenReplies: hiddenReplyIds.size > 0 };
  });
}
