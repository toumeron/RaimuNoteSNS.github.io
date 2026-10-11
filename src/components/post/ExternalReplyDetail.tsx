import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { PostCard } from '@/components/feed/PostCard';
import { ExternalReplyCard } from './ExternalReplyCard';
import { ReplyChain } from './ReplyChain';
import type { PostWithAuthor } from '@/types';

export function ExternalReplyDetail({ post, mobileFlat }: { post: PostWithAuthor; mobileFlat: boolean }) {
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
  return <div style={{ '--reply-frame-padding': mobileFlat ? '16px' : '24px' } as CSSProperties}
    className={mobileFlat ? 'post-detail-mobile-article' : 'rounded-3xl border border-border/60 bg-card p-6 shadow-soft'}>
    <style>{`[data-lime-reply-chain] [data-lime-reply-detail] { padding-bottom: 0 !important; }`}</style>
    <ReplyChain>
      {post.externalReplyParent && <PostCard post={post.externalReplyParent} thread />}
      <div ref={selected} data-lime-selected-reply>
        <ExternalReplyCard post={post} detail thread mobileFlat={mobileFlat} />
      </div>
    </ReplyChain>
  </div>;
}
