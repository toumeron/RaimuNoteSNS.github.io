import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { CommentConversations } from './CommentList';
import { PostCardSkeleton } from '@/components/feed/PostCardSkeleton';
import type { BlueskyMappedPost } from '@/lib/bluesky';
import type { CommentWithAuthor, PostWithAuthor } from '@/types';

/** External replies use the same presentation as LimeNote comments, with external IDs intact. */
export function ExternalReplyList({ parent, replies, isLoading, isError, mobileFlat }: {
  parent: PostWithAuthor;
  replies: BlueskyMappedPost[];
  isLoading: boolean;
  isError: boolean;
  mobileFlat: boolean;
}) {
  const { user } = useAuth();
  const [expandedReplies, setExpandedReplies] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => { setExpandedReplies(new Set()); }, [parent.id]);
  if (isLoading) return <PostCardSkeleton />;
  if (isError) return <div className="rounded-3xl border border-destructive/40 bg-destructive/5 p-6 text-center"><p className="text-sm text-destructive">返信の読み込みに失敗しました。</p></div>;
  if (!replies.length) return <div className={mobileFlat ? 'p-8 text-center text-muted-foreground' : 'rounded-3xl border border-border/60 bg-card p-8 text-center text-muted-foreground'}>まだ返信はありません。</div>;
  const replyIds = new Set(replies.map(reply => reply.id));
  const comments = replies.map(reply => {
    const post: PostWithAuthor = { repostsCount: 0, repostedByMe: false, ...reply, author: { coverUrl: '', ...reply.author } };
    // External pages can omit a deleted/hidden parent or return a child before
    // its parent. Keep that reply visible until the parent arrives on a later page.
    return { ...post, postId: parent.id, parentCommentId: post.externalReplyToId && post.externalReplyToId !== parent.id && replyIds.has(post.externalReplyToId) ? post.externalReplyToId : null, externalPost: post } as CommentWithAuthor & { externalPost: PostWithAuthor };
  });
  return <CommentConversations comments={comments} currentUserId={user?.id ?? null} mobileFlat={mobileFlat}
    threadAuthorId={parent.userId ?? parent.author.id} expandedReplies={expandedReplies}
    onExpand={id => setExpandedReplies(previous => new Set([...previous, id]))} />;
}
