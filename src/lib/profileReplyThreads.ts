interface Reply { id: string; postId: string; createdAt: string; parentCommentId?: string | null }
/** Preserve the selected reply's feed position and its complete ancestor path. */
export function buildProfileReplyThreads<C extends Reply, P, R>(comments: C[], posts: Map<string, P>, parents: Map<string, C>, postReactions: Map<string, R[]>, _commentReactions: Map<string, R[]>) {
  const byId = new Map([...parents, ...comments.map(comment => [comment.id, comment] as const)]);
  return comments.filter(comment => posts.has(comment.postId)).map(comment => {
    const chain: C[] = [];
    const seen = new Set<string>();
    let current: C | undefined = comment;
    let complete = true;
    while (current) {
      if (seen.has(current.id) || current.postId !== comment.postId) { complete = false; break; }
      seen.add(current.id); chain.push(current);
      if (!current.parentCommentId) break;
      current = byId.get(current.parentCommentId);
      if (!current) complete = false;
    }
    return {
      id: comment.id, createdAt: comment.createdAt, comment,
      comments: complete ? chain.reverse() : [comment],
      parentPost: complete ? posts.get(comment.postId) ?? null : null,
      parentReactions: complete ? postReactions.get(comment.postId) ?? [] : [],
    };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
