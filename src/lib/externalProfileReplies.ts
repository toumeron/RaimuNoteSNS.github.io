import type { PostWithAuthor } from '@/types';
/** Keep the author-feed order, and reuse the native profile's parent/reply thread renderer. */
export function externalProfileReplyThread(post: PostWithAuthor) {
  const parent = post.externalReplyParent ?? null;
  const comment = {
    ...post, postId: post.externalReplyToId ?? post.id, externalPost: post,
    replyToUsername: post.externalReplyToUsername ?? parent?.author.username, reactions: [],
  };
  return { id: post.id, createdAt: post.createdAt, comment, comments: [comment], parentPost: parent, parentReactions: [] };
}
