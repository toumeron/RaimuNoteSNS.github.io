import { CommentCard } from './CommentList';
import { useAuth } from '@/hooks/useAuth';
import type { PostWithAuthor } from '@/types';
export function ExternalReplyCard({ post, parentId, replyToUsername, mobileFlat = true, detail = false, thread = false, embedded = false, repostedByLabel }: {
  post: PostWithAuthor; parentId?: string; replyToUsername?: string; mobileFlat?: boolean;
  detail?: boolean; thread?: boolean; embedded?: boolean; repostedByLabel?: string;
}) {
  const { user } = useAuth();
  return <CommentCard comment={{ ...post, postId: parentId ?? post.externalReplyToId ?? post.id }} externalPost={post}
    currentUserId={user?.id ?? null} mobileFlat={mobileFlat} detail={detail} thread={thread} embedded={embedded}
    repostedByLabel={repostedByLabel} replyToUsername={replyToUsername ?? post.externalReplyToUsername} />;
}
