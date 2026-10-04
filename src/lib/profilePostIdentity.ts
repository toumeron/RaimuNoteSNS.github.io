/** Original posts and repost activity are separate profile entries. */
export function profilePostIdentity(post: {id: string; profileRepostedBy?: string; profileRepostedAt?: string}): string {
  return post.profileRepostedBy
    ? `repost:${post.profileRepostedBy}:${post.id}:${post.profileRepostedAt || ''}`
    : `post:${post.id}`;
}
