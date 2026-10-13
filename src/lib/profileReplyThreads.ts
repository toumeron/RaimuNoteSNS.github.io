import type { PostWithAuthor } from "@/types";
import type { PostTabFilter, PostTabSort } from "@/components/profile/PostTabMenu";

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

/** Keep the author-feed order, and reuse the native profile's parent/reply thread renderer. */
export function externalProfileReplyThread(post: PostWithAuthor) {
  const parent = post.externalReplyParent ?? null;
  const comment = {
    ...post, postId: post.externalReplyToId ?? post.id, externalPost: post,
    replyToUsername: post.externalReplyToUsername ?? parent?.author.username, reactions: [],
  };
  return { id: post.id, createdAt: post.createdAt, comment, comments: [comment], parentPost: parent, parentReactions: [] };
}

/** Original posts and repost activity are separate profile entries. */
export function profilePostIdentity(post: {id: string; profileRepostedBy?: string; profileRepostedAt?: string}): string {
  return post.profileRepostedBy
    ? `repost:${post.profileRepostedBy}:${post.id}:${post.profileRepostedAt || ''}`
    : `post:${post.id}`;
}

/** Quotes are authored posts; only reply/repost activity is excluded. */
export function selectProfilePosts<T>(items: T[], filter: PostTabFilter, sort: PostTabSort): T[] {
  const postOf = (item: any) => item.post ?? item.reply?.comment ?? item;
  const selected = items.filter((item: any) => {
    const post = postOf(item);
    return filter === 'all' || (!item.reply && !post.replyId && !post.externalReplyToId && !post.profileRepostedBy);
  });
  const time = (item: any) => Date.parse(item.sortAt ?? postOf(item).createdAt ?? postOf(item).created_at ?? '') || 0;
  const likes = (item: any) => Number(postOf(item).likesCount ?? postOf(item).likes_count ?? 0);
  const identity = (item: any) => `${postOf(item).id ?? ''}:${postOf(item).profileRepostedBy ?? ''}:${postOf(item).profileRepostedAt ?? ''}`;
  return selected.sort((a, b) => (sort === 'popular' ? likes(b) - likes(a) : 0) || time(b) - time(a) || (sort === 'latest' ? identity(b).localeCompare(identity(a)) : identity(a).localeCompare(identity(b))));
}

/** A complete ranking input: never publish a partially scanned chronological feed. */
export async function collectProfilePages<T, C>(load: (cursor: C | null) => Promise<{ posts: T[]; cursor: C | null }>, signal?: AbortSignal): Promise<T[]> {
  const posts: T[] = [];
  const seen = new Set<C>();
  let cursor: C | null = null;
  do {
    signal?.throwIfAborted();
    const page = await load(cursor);
    signal?.throwIfAborted();
    posts.push(...page.posts);
    cursor = page.cursor;
    if (cursor !== null) {
      if (seen.has(cursor)) throw new Error('投稿の取得カーソルが進みませんでした');
      seen.add(cursor);
    }
  } while (cursor !== null);
  return posts;
}
