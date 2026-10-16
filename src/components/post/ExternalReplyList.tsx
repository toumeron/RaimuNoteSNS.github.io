import { useEffect, useState, useLayoutEffect, useRef, type CSSProperties } from "react";
import { useAuth } from "@/hooks/useAuth";
import { CommentConversations, ExternalReplyCard } from "@/components/post/CommentList";
import { PostCardSkeleton } from "@/components/feed/PostCardSkeleton";
import { type BlueskyMappedPost } from "@/lib/bluesky";
import { type CommentWithAuthor, type PostWithAuthor } from "@/types/index";
import { PostCard } from "@/components/feed/PostCard";
import { ReplyChain } from "@/components/post/ReplyChain";

// ExternalReplyList
/** External replies use the same presentation as LimeNote comments, with external IDs intact. */
function ExternalReplyList({ parent, replies, isLoading, isError, mobileFlat }: {
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

// ExternalReplyDetail
function ExternalReplyDetail({ post, mobileFlat }: { post: PostWithAuthor; mobileFlat: boolean }) {
  const selected = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!selected.current) return;
    const host = selected.current.closest('[data-lime-reply-chain]') ?? selected.current;
    let anchoring = true;
    const align = () => { if (anchoring) selected.current?.scrollIntoView({ block: 'center', behavior: 'auto' }); };
    const resize = new ResizeObserver(align);
    resize.observe(host);
    const stop = () => { anchoring = false; resize.disconnect(); };
    const interactions = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    interactions.forEach(event => window.addEventListener(event, stop, { passive: true }));
    host.addEventListener('load', align, true);
    align();
    return () => {
      stop();
      host.removeEventListener('load', align, true);
      interactions.forEach(event => window.removeEventListener(event, stop));
    };
  }, [post.id]);
  const parents:PostWithAuthor[]=[],seen=new Set([post.id]);let parent=post.externalReplyParent;
  while(parent&&!seen.has(parent.id)&&parents.length<20){seen.add(parent.id);parents.unshift(parent);parent=parent.externalReplyParent;}
  return <div style={{ '--reply-frame-padding': mobileFlat ? '16px' : '24px' } as CSSProperties}
    className={mobileFlat ? 'post-detail-mobile-article' : 'rounded-3xl border border-border/60 bg-card p-6 shadow-soft'}>
    <style>{`[data-lime-reply-chain] [data-lime-reply-detail] { padding-bottom: 0 !important; }`}</style>
    <ReplyChain>
      {parents.map(parent=><PostCard key={parent.id} post={parent} thread />)}
      <div ref={selected} data-lime-selected-reply>
        <ExternalReplyCard post={post} detail thread mobileFlat={mobileFlat} />
      </div>
    </ReplyChain>
  </div>;
}

export { ExternalReplyList };
export { ExternalReplyDetail };
