import { useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useComments } from '@/hooks/useComments';
import { useAuth } from '@/hooks/useAuth';
import { useDesktopLayout } from '@/components/layout/DesktopLayoutContext';
import { PostCard } from '@/components/feed/PostCard';
import { CommentCard, CommentList } from '@/components/post/CommentList';
import { CommentForm } from '@/components/post/CommentForm';
import { ReplyChain } from '@/components/post/ReplyChain';
import { Skeleton } from '@/components/ui/skeleton';
import { getCommentAncestors } from '@/lib/commentThread';
import type { PostWithAuthor } from '@/types';

export function ReplyDetail({ commentId, post, mobileFlat }: { commentId: string; post: PostWithAuthor; mobileFlat: boolean }) {
  const { user } = useAuth();
  const desktopLayout = useDesktopLayout();
  const comments = useComments(post.id);
  const chain = getCommentAncestors(comments.data ?? [], commentId);
  const selected = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  const ready = !!chain;
  useLayoutEffect(() => {
    if (!ready || scrolled.current || !selected.current) return;
    scrolled.current = true;
    const host = selected.current.closest('[data-lime-reply-chain]') ?? selected.current;
    let anchoring = true;
    const align = () => { if (anchoring) selected.current?.scrollIntoView({ block: 'center', behavior: 'auto' }); };
    const resize = new ResizeObserver(align);
    resize.observe(host);
    // Keep the target visible while ancestor media obtains its natural size.
    // Stop as soon as the user interacts, so browsing is never pulled back.
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
  }, [ready]);

  if (comments.isLoading) return <Skeleton className="h-40 w-full rounded-3xl" />;
  if (!chain) return <p className="p-6 text-center text-muted-foreground">返信を読み込めませんでした。削除されたか、表示する権限がありません。</p>;

  return (
    <div>
      <style>{`
        [data-lime-reply-chain] [data-lime-thread-item] {
          padding: 12px 0 !important;
          margin: 0 !important;
          border: 0 !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          max-width: none !important;
        }
        [data-lime-reply-chain] [data-lime-reply-detail] {
          padding-bottom: 0 !important;
        }
      `}</style>
      <div style={{ '--reply-frame-padding': mobileFlat ? '16px' : '24px' } as CSSProperties} className={mobileFlat ? 'post-detail-mobile-article' : 'rounded-3xl border border-border/60 bg-card p-6 shadow-soft'}>
      <ReplyChain>
        <PostCard post={post} thread />
        {chain.map((comment, index) => (
          <div key={comment.id} ref={index === chain.length - 1 ? selected : undefined} data-lime-selected-reply={index === chain.length - 1 || undefined}>
            <CommentCard comment={{ ...comment, likesCount: Number(comment.likes_count ?? 0), likedByMe: !!comment.likedByMe }} currentUserId={user?.id ?? null} mobileFlat={mobileFlat} thread detail={index === chain.length - 1} />
          </div>
        ))}
      </ReplyChain>
      </div>
      {(!mobileFlat || desktopLayout) && <CommentForm key={commentId} postId={post.id} parentCommentId={commentId} variant={desktopLayout ? 'desktopReply' : 'default'} />}
      <div className={mobileFlat ? 'post-detail-mobile-comments-shell' : ''}>
        <CommentList postId={post.id} parentCommentId={commentId} mobileFlat={mobileFlat} />
      </div>
    </div>
  );
}
