import type { PostTabFilter, PostTabSort } from '@/components/profile/PostTabMenu';
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
  return selected.sort((a, b) => (sort === 'popular' ? likes(b) - likes(a) : 0) || time(b) - time(a) || identity(a).localeCompare(identity(b)));
}
