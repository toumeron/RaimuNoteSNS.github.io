import type { PostWithAuthor } from '@/types';
import { recordRecommendationLike } from '@/lib/recommendations';
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Heart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/currentUser';
import { useQueryClient } from '@tanstack/react-query';
import { useIsPWA } from '@/hooks/useIsPWA';
import { updateLikeCountCache } from '@/lib/likeCountCache';
import {
  fetchBlueskyPostViewerState,
  likeBlueskyPost,
  unlikeBlueskyPost,
} from '@/lib/bluesky';

const formatDisplayCount = (count: number = 0) => {
  if (count <= 0) return '';
  const n = Number(count) || 0; // 確実に数値に変換
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  return n.toLocaleString();
};

const TABLE_CONFIG = {
  post: {
    table: 'likes',
    idCol: 'post_id',
    queryKey: 'posts',
    targetTable: 'posts',
    targetIdCol: 'id',
    countCol: 'likes_count',
  },
  comment: {
    table: 'comment_likes',
    idCol: 'comment_id',
    queryKey: 'comments',
    targetTable: 'comments',
    targetIdCol: 'id',
    countCol: 'likes_count',
  },
} as const;

const TWITTER_LIKE_STYLE_ID = 'twitter-like-button-styles';

const TWITTER_LIKE_STYLES = `
.twitter-like-effects {
  height: 40px;
  left: 50%;
  overflow: visible;
  pointer-events: none;
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 40px;
}

.twitter-like-effects .circle {
  fill: transparent;
  stroke: #CD85E7;
  stroke-width: 0;
  transform-origin: 29.5px 29.5px;
}

.twitter-like-effects .particle-group {
  opacity: 0;
}

.twitter-like-effects .oval {
  transform-origin: 0 0 0;
}

.twitter-like-effects.is-animating .circle {
  animation: twitterLikeCircle 0.25s forwards;
}

.twitter-like-effects.is-animating .grp1,
.twitter-like-effects.is-animating .grp2,
.twitter-like-effects.is-animating .grp3,
.twitter-like-effects.is-animating .grp4,
.twitter-like-effects.is-animating .grp5,
.twitter-like-effects.is-animating .grp6,
.twitter-like-effects.is-animating .grp7 {
  opacity: 1;
  transition: 0.18s opacity 0.2s;
}

.twitter-like-effects.is-animating .grp1 .oval1 {
  transform: scale(0) translate(0, -18px);
  transition: 0.2s transform 0.2s;
}

.twitter-like-effects.is-animating .grp1 .oval2 {
  transform: scale(0) translate(7px, -30px);
  transition: 0.8s transform 0.2s;
}

.twitter-like-effects.is-animating .grp2 .oval1 {
  transform: scale(0) translate(18px, -9px);
  transition: 0.2s transform 0.2s;
}

.twitter-like-effects.is-animating .grp2 .oval2 {
  transform: scale(0) translate(33px, -9px);
  transition: 0.8s transform 0.2s;
}

.twitter-like-effects.is-animating .grp3 .oval1 {
  transform: scale(0) translate(18px, 0);
  transition: 0.2s transform 0.2s;
}

.twitter-like-effects.is-animating .grp3 .oval2 {
  transform: scale(0) translate(33px, 6px);
  transition: 0.8s transform 0.2s;
}

.twitter-like-effects.is-animating .grp4 .oval1 {
  transform: scale(0) translate(18px, 9px);
  transition: 0.2s transform 0.2s;
}

.twitter-like-effects.is-animating .grp4 .oval2 {
  transform: scale(0) translate(24px, 30px);
  transition: 0.8s transform 0.2s;
}

.twitter-like-effects.is-animating .grp5 .oval1 {
  transform: scale(0) translate(-6px, 13px);
  transition: 0.2s transform 0.2s;
}

.twitter-like-effects.is-animating .grp5 .oval2 {
  transform: scale(0) translate(-33px, 18px);
  transition: 0.8s transform 0.2s;
}

.twitter-like-effects.is-animating .grp6 .oval1 {
  transform: scale(0) translate(-18px, 0);
  transition: 0.2s transform 0.2s;
}

.twitter-like-effects.is-animating .grp6 .oval2 {
  transform: scale(0) translate(-33px, -3px);
  transition: 0.8s transform 0.2s;
}

.twitter-like-effects.is-animating .grp7 .oval1 {
  transform: scale(0) translate(-18px, -9px);
  transition: 0.2s transform 0.2s;
}

.twitter-like-effects.is-animating .grp7 .oval2 {
  transform: scale(0) translate(-31px, -18px);
  transition: 0.8s transform 0.2s;
}

.twitter-like-heart.is-animating {
  animation: twitterLikeHeart 0.38s 0.18s cubic-bezier(0.16, 1, 0.3, 1) both;
  transform-origin: center;
}

.twitter-like-count {
  display: inline-grid;
  line-height: 1;
  overflow: hidden;
  position: relative;
}

.twitter-like-count-static,
.twitter-like-count-old,
.twitter-like-count-new {
  grid-area: 1 / 1;
}

.twitter-like-count-old,
.twitter-like-count-new {
  will-change: transform;
}

.twitter-like-count.is-up .twitter-like-count-old {
  animation: twitterCountOldUp 0.3s ease forwards;
}

.twitter-like-count.is-up .twitter-like-count-new {
  animation: twitterCountNewUp 0.3s ease forwards;
}

.twitter-like-count.is-down .twitter-like-count-old {
  animation: twitterCountOldDown 0.3s ease forwards;
}

.twitter-like-count.is-down .twitter-like-count-new {
  animation: twitterCountNewDown 0.3s ease forwards;
}

@keyframes twitterLikeCircle {
  from {
    transform: scale(0) translateY(-0.05px);
    stroke-width: 3px;
  }
  50% {
    transform: scale(4.6) translateY(-0.05px);
    stroke-width: 2.5px;
  }
  to {
    transform: scale(8.5) translateY(-0.05px);
    stroke-width: 0;
  }
}

@keyframes twitterLikeHeart {
  from {
    opacity: 0;
    transform: scale(0);
  }
  45% {
    opacity: 1;
    transform: scale(1.18);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes twitterCountOldUp {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(-100%);
  }
}

@keyframes twitterCountNewUp {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}

@keyframes twitterCountOldDown {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(100%);
  }
}

@keyframes twitterCountNewDown {
  from {
    transform: translateY(-100%);
  }
  to {
    transform: translateY(0);
  }
}
`;

const ensureTwitterLikeStyles = () => {
  if (typeof document === 'undefined') return;
  if (document.getElementById(TWITTER_LIKE_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = TWITTER_LIKE_STYLE_ID;
  style.textContent = TWITTER_LIKE_STYLES;
  document.head.appendChild(style);
};

// Bluesky投稿のいいねを扱う際に渡す情報。
// postUri は at://did/app.bsky.feed.post/rkey 形式。
// これが渡された場合、このボタンは Supabase の likes テーブルではなく
// 自分のBlueskyアカウント(ログイン中のセッション)経由で
// app.bsky.feed.like レコードの作成/削除を行う。
// 呼び出し側は、自分のBlueskyアカウントでログインしている場合のみ
// この prop を渡すこと(未ログイン時にこのボタンを使うとAPI呼び出しが
// 常に失敗しトースト等も出ないため、UI自体を出し分けるのは呼び出し側の責務)。
export interface LikeButtonBlueskyTarget {
  postUri: string;
  preferencePost?: PostWithAuthor;
}

export function LikeButton({
  postId,
  liked,
  count,
  size = 'md',
  type = 'post',
  bluesky,
}: {
  postId: string;
  liked: boolean;
  count: number;
  size?: 'sm' | 'md';
  type?: 'post' | 'comment';
  bluesky?: LikeButtonBlueskyTarget;
}) {
  const queryClient = useQueryClient();

  const isPWA = useIsPWA();
  const [isMobile, setIsMobile] = useState(false);
  const isPWAMobile = isPWA && isMobile;

  // 表示用の状態（楽観的更新用）
  const [displayLiked, setDisplayLiked] = useState(liked);
  const [displayCount, setDisplayCount] = useState(Number(count) || 0);
  const [previousDisplayCount, setPreviousDisplayCount] = useState(Number(count) || 0);
  const [countDirection, setCountDirection] = useState<'up' | 'down'>('up');
  const [isAnimating, setIsAnimating] = useState(false);
  const [isCountAnimating, setIsCountAnimating] = useState(false);

  const animationTimerRef = useRef<number | null>(null);
  const countTimerRef = useRef<number | null>(null);
  const lastTargetRef = useRef({ postId, type });
  const channelIdRef = useRef(Math.random().toString(36).slice(2));
  const broadcastChannelRef = useRef<any>(null);
  const hasLocalStateRef = useRef(false);
  const lastLocalActionAtRef = useRef(0);
  const countRequestRef = useRef(0);
  const hasLiveCountRef = useRef(false);

  // Bluesky投稿用: 現在の app.bsky.feed.like レコードのuriと、
  // いいね作成に必要な対象投稿のcidをここに保持する。
  const blueskyLikeUriRef = useRef<string | null>(null);
  const blueskyCidRef = useRef<string | null>(null);
  const isBluesky = Boolean(bluesky);

  // 最新の状態を常に保持するためのRef
  const stateRef = useRef({ liked, count: Number(count) || 0 });

  useLayoutEffect(() => {
    ensureTwitterLikeStyles();
  }, []);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => {
      window.removeEventListener('resize', checkMobile);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (animationTimerRef.current !== null) window.clearTimeout(animationTimerRef.current);
      if (countTimerRef.current !== null) window.clearTimeout(countTimerRef.current);
    };
  }, []);

  // props の liked が false のまま来るケースに備えて、表示初期化時だけDB上の実状態を反映する。
  // (Lime内部投稿のみ。Bluesky投稿は別のeffectで初期状態を取得する)
  useEffect(() => {
    if (isBluesky) return;

    let cancelled = false;

    const syncInitialLiked = async () => {
      const userId = await getCurrentUserId();
      if (!userId || cancelled || hasLocalStateRef.current) return;

      const config = TABLE_CONFIG[type];
      const { data, error } = await supabase
        .from(config.table)
        .select('user_id')
        .match({ [config.idCol]: postId, user_id: userId })
        .maybeSingle();

      if (cancelled || hasLocalStateRef.current) return;

      if (error) {
        console.error('Initial like state check failed:', error);
        return;
      }

      const currentLiked = Boolean(data);
      if (type === 'post') recordRecommendationLike({ id: postId, content: '' } as PostWithAuthor, currentLiked, userId);
      setDisplayLiked(currentLiked);
      stateRef.current.liked = currentLiked;
      hasLocalStateRef.current = true;
    };

    syncInitialLiked();

    return () => {
      cancelled = true;
    };
  }, [postId, type, isBluesky]);

  // Bluesky投稿用: 自分のBlueskyアカウントとして現在のいいね状態(と、
  // いいね作成に必要なcid)を取得する。
  useEffect(() => {
    if (!bluesky) return;

    let cancelled = false;

    fetchBlueskyPostViewerState(bluesky.postUri).then((state) => {
      if (cancelled) return;

      blueskyLikeUriRef.current = state.likeUri;
      blueskyCidRef.current = state.cid;

      if (!hasLocalStateRef.current) {
        const currentLiked = Boolean(state.likeUri);
        if (currentLiked && bluesky.preferencePost) {
          const post = bluesky.preferencePost;
          void getCurrentUserId().then(viewerId => recordRecommendationLike(post, true, viewerId)).catch(() => {});
        }
        setDisplayLiked(currentLiked);
        stateRef.current.liked = currentLiked;
        hasLocalStateRef.current = true;
      }
    });

    return () => {
      cancelled = true;
    };
  }, [bluesky?.postUri]);

  const animateCount = useCallback((fromCount: number, toCount: number) => {
    if (countTimerRef.current !== null) {
      window.clearTimeout(countTimerRef.current);
    }

    setPreviousDisplayCount(fromCount);
    setDisplayCount(toCount);
    setCountDirection(toCount >= fromCount ? 'up' : 'down');
    setIsCountAnimating(fromCount !== toCount);

    countTimerRef.current = window.setTimeout(() => {
      setIsCountAnimating(false);
      setPreviousDisplayCount(toCount);
      countTimerRef.current = null;
    }, 320);
  }, []);

  const applyLatestCount = useCallback((latestCount: number) => {
    if (!Number.isFinite(latestCount)) return;

    const safeLatestCount = Math.max(0, Math.trunc(latestCount));
    const currentCount = stateRef.current.count;
    updateLikeCountCache(queryClient, type, postId, safeLatestCount);
    hasLiveCountRef.current = true;
    if (safeLatestCount === currentCount) return;

    stateRef.current.count = safeLatestCount;
    animateCount(currentCount, safeLatestCount);
  }, [animateCount, postId, queryClient, type]);

  const syncLatestCount = useCallback(async () => {
    const request = ++countRequestRef.current;
    const config = TABLE_CONFIG[type];
    const { count: latestCount, error } = await supabase
      .from(config.table)
      .select(config.idCol, { count: 'exact', head: true })
      .eq(config.idCol, postId);

    if (error) {
      console.error('Sync like count failed:', error);
      return null;
    }

    if (request !== countRequestRef.current || lastTargetRef.current.postId !== postId || lastTargetRef.current.type !== type) return null;
    if (typeof latestCount !== 'number') return null;
    applyLatestCount(latestCount);
    return latestCount;
  }, [applyLatestCount, postId, type]);

  // 初期表示と、親から届いた最新件数を表示へ反映する。
  useEffect(() => {
    const targetChanged =
      lastTargetRef.current.postId !== postId || lastTargetRef.current.type !== type;
    const safeCount = Number(count) || 0;

    if (targetChanged) {
      lastTargetRef.current = { postId, type };
      hasLocalStateRef.current = false;
      hasLiveCountRef.current = false;
      lastLocalActionAtRef.current = 0;
      // 投稿が切り替わったら、前の投稿のBlueskyいいねレコード情報を持ち越さない
      blueskyLikeUriRef.current = null;
      blueskyCidRef.current = null;
    }

    if (!isBluesky && hasLiveCountRef.current && safeCount !== stateRef.current.count) {
      void syncLatestCount();
    }

    if (targetChanged || !hasLocalStateRef.current) {
      setDisplayLiked(liked);
      stateRef.current.liked = liked;
      if (!hasLiveCountRef.current) {
        setDisplayCount(safeCount);
        setPreviousDisplayCount(safeCount);
        setIsCountAnimating(false);
        stateRef.current.count = safeCount;
      }
      return;
    }

    // Once confirmed from like rows, stale posts.likes_count props must not
    // overwrite the live count (for example when a profile query refetches).
    if (!isBluesky && hasLiveCountRef.current) return;
    const recentlyClicked = Date.now() - lastLocalActionAtRef.current < 1200;
    if (!recentlyClicked && safeCount !== stateRef.current.count) {
      const currentCount = stateRef.current.count;
      stateRef.current.count = safeCount;
      animateCount(currentCount, safeCount);
    }
  }, [animateCount, postId, type, liked, count, isBluesky, syncLatestCount]);

  // リアルタイム反映(Supabase Realtime)。Bluesky投稿はLimeのテーブルに
  // 行が存在しないため、この購読自体を行わない。
  useEffect(() => {
    if (isBluesky) return;

    const config = TABLE_CONFIG[type];
    const channelSuffix = `${type}-${postId}-${channelIdRef.current}-${crypto.randomUUID()}`;
    const broadcastChannel = supabase
      .channel(`like-count-broadcast-${type}-${postId}`)
      .on(
        'broadcast',
        { event: 'count-changed' },
        ({ payload }: any) => {
          if (payload?.origin === channelIdRef.current) return;

          if (payload?.count == null) return;
          const latestCount = Number(payload.count);
          if (Number.isFinite(latestCount)) {
            countRequestRef.current += 1;
            applyLatestCount(latestCount);
          }
        }
      )
      .subscribe();

    broadcastChannelRef.current = broadcastChannel;

    const likeRowsChannel = supabase
      .channel(`like-count-rows-${channelSuffix}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: config.table,
          filter: `${config.idCol}=eq.${postId}`,
        },
        () => {
          void syncLatestCount();
        }
      )
      .subscribe((status) => {
        // Also catch up after reconnecting, when events may have been missed.
        if (status === 'SUBSCRIBED') void syncLatestCount();
      });

    // Correct stale denormalized counts on mount, without waiting for an event.
    void syncLatestCount();

    const countColumnChannel = supabase
      .channel(`like-count-target-${channelSuffix}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: config.targetTable,
          filter: `${config.targetIdCol}=eq.${postId}`,
        },
        () => {
          // An unrelated post update can carry a stale/null likes_count.
          // Read the actual like rows rather than replacing the count with zero.
          void syncLatestCount();
        }
      )
      .subscribe();

    return () => {
      countRequestRef.current += 1;
      broadcastChannelRef.current = null;
      void supabase.removeChannel(broadcastChannel);
      void supabase.removeChannel(likeRowsChannel);
      void supabase.removeChannel(countColumnChannel);
    };
  }, [applyLatestCount, postId, syncLatestCount, type, isBluesky]);

  const handleBlueskyLikeToggle = useCallback(async (willBeLiked: boolean, wasLiked: boolean, wasCount: number, nextCount: number) => {
    if (!bluesky) return;

    try {
      if (willBeLiked) {
        let cid = blueskyCidRef.current;
        let existingLikeUri = blueskyLikeUriRef.current;

        if (!cid) {
          // cidが未取得の場合は直前にもう一度確認する(取得タイミングのズレ対策)
          const state = await fetchBlueskyPostViewerState(bluesky.postUri);
          cid = state.cid;
          existingLikeUri = state.likeUri;
          blueskyCidRef.current = state.cid;
          blueskyLikeUriRef.current = state.likeUri;
        }

        if (existingLikeUri) {
          // 取得しなおした結果、既にいいね済みだったと分かった場合はそちらに合わせる
          return;
        }

        if (!cid) {
          throw new Error('投稿のcidを取得できませんでした');
        }

        const uri = await likeBlueskyPost(bluesky.postUri, cid);
        blueskyLikeUriRef.current = uri;
      } else {
        const likeUri = blueskyLikeUriRef.current;
        if (!likeUri) {
          // 解除対象のレコードが分からない場合は何もしない(既に解除済み扱い)
          return;
        }

        await unlikeBlueskyPost(likeUri);
        blueskyLikeUriRef.current = null;
      }
      if (bluesky.preferencePost) {
        const post = bluesky.preferencePost;
        void getCurrentUserId().then(viewerId => recordRecommendationLike(post, willBeLiked, viewerId)).catch(() => {});
      }
    } catch (err) {
      console.error('Bluesky Like action failed:', err);
      stateRef.current.liked = wasLiked;
      stateRef.current.count = wasCount;
      setDisplayLiked(wasLiked);
      animateCount(nextCount, wasCount);
      setIsAnimating(false);
    }
  }, [animateCount, bluesky]);

  const handleClick = useCallback(async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    ensureTwitterLikeStyles();

    const wasLiked = stateRef.current.liked;
    const wasCount = stateRef.current.count;
    const willBeLiked = !wasLiked;
    const nextCount = willBeLiked ? wasCount + 1 : Math.max(0, wasCount - 1);

    countRequestRef.current += 1;
    stateRef.current.liked = willBeLiked;
    stateRef.current.count = nextCount;
    hasLocalStateRef.current = true;
    lastLocalActionAtRef.current = Date.now();

    setDisplayLiked(willBeLiked);
    animateCount(wasCount, nextCount);

    if (animationTimerRef.current !== null) {
      window.clearTimeout(animationTimerRef.current);
    }

    setIsAnimating(willBeLiked);
    if (willBeLiked) {
      animationTimerRef.current = window.setTimeout(() => {
        setIsAnimating(false);
        animationTimerRef.current = null;
      }, 1050);
    }

    if (bluesky) {
      await handleBlueskyLikeToggle(willBeLiked, wasLiked, wasCount, nextCount);
      return;
    }

    const userId = await getCurrentUserId();
    if (!userId) {
      alert('ログインが必要です');
      stateRef.current.liked = wasLiked;
      stateRef.current.count = wasCount;
      setDisplayLiked(wasLiked);
      animateCount(nextCount, wasCount);
      setIsAnimating(false);
      return;
    }

    try {
      const config = TABLE_CONFIG[type];

      if (willBeLiked) {
        // config.table を使用して、post/comment 適切なテーブルへ insert するよう修正
        const { error } = await supabase
          .from(config.table)
          .upsert(
            { [config.idCol]: postId, user_id: userId },
            { onConflict: `${config.idCol}, user_id` }
          );
        if (error && error.code !== '23505') throw error;
      } else {
        const { error } = await supabase
          .from(config.table)
          .delete()
          .match({ [config.idCol]: postId, user_id: userId });

        if (error) throw error;
      }

      if (type === 'post') recordRecommendationLike({ id: postId, content: '' } as PostWithAuthor, willBeLiked, userId);

      // DB反映を待つ
      const latestCount = await syncLatestCount();

      if (typeof latestCount === 'number') {
        await broadcastChannelRef.current?.send({
          type: 'broadcast',
          event: 'count-changed',
          payload: {
            count: latestCount,
            origin: channelIdRef.current,
          },
        });
      }

      await queryClient.invalidateQueries({ queryKey: [config.queryKey] });
    } catch (err: any) {
      console.error('Like action failed:', err);
      // 失敗時のみ元の状態に戻す
      stateRef.current.liked = wasLiked;
      stateRef.current.count = wasCount;
      setDisplayLiked(wasLiked);
      animateCount(nextCount, wasCount);
      setIsAnimating(false);
    }
  }, [animateCount, bluesky, handleBlueskyLikeToggle, postId, queryClient, syncLatestCount, type]);

  return (
    <button
      type="button"
      data-lime-post-action="like"
      onClick={handleClick}
      className={cn(
        'group inline-flex items-center rounded-full transition-colors outline-none select-none overflow-visible',
        isMobile
          ? 'gap-1.5 px-2 py-1 text-[13px] h-full'
          : 'gap-1.5 px-2.5 py-1',
        isPWAMobile && 'min-h-[32px]',
        displayLiked ? 'text-pink-500' : 'text-muted-foreground hover:text-pink-500'
      )}
    >
      <span className="relative inline-flex items-center justify-center overflow-visible pointer-events-none">
        <svg
          aria-hidden="true"
          className={cn('twitter-like-effects', isAnimating && displayLiked && 'is-animating')}
          viewBox="0 0 58 57"
          xmlns="http://www.w3.org/2000/svg"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <g fill="none" fillRule="evenodd">
            <circle className="circle" cx="29.5" cy="29.5" r="1.5" />

            <g className="particle-group grp7" transform="translate(7 6)">
              <circle className="oval oval1" fill="#9CD8C3" cx="2" cy="6" r="2" />
              <circle className="oval oval2" fill="#8CE8C3" cx="5" cy="2" r="2" />
            </g>

            <g className="particle-group grp6" transform="translate(0 28)">
              <circle className="oval oval1" fill="#CC8EF5" cx="2" cy="7" r="2" />
              <circle className="oval oval2" fill="#91D2FA" cx="3" cy="2" r="2" />
            </g>

            <g className="particle-group grp3" transform="translate(52 28)">
              <circle className="oval oval2" fill="#9CD8C3" cx="2" cy="7" r="2" />
              <circle className="oval oval1" fill="#8CE8C3" cx="4" cy="2" r="2" />
            </g>

            <g className="particle-group grp2" transform="translate(44 6)">
              <circle className="oval oval2" fill="#CC8EF5" cx="5" cy="6" r="2" />
              <circle className="oval oval1" fill="#CC8EF5" cx="2" cy="2" r="2" />
            </g>

            <g className="particle-group grp5" transform="translate(14 50)">
              <circle className="oval oval1" fill="#91D2FA" cx="6" cy="5" r="2" />
              <circle className="oval oval2" fill="#91D2FA" cx="2" cy="2" r="2" />
            </g>

            <g className="particle-group grp4" transform="translate(35 50)">
              <circle className="oval oval1" fill="#F48EA7" cx="6" cy="5" r="2" />
              <circle className="oval oval2" fill="#F48EA7" cx="2" cy="2" r="2" />
            </g>

            <g className="particle-group grp1" transform="translate(24)">
              <circle className="oval oval1" fill="#9FC7FA" cx="2.5" cy="3" r="2" />
              <circle className="oval oval2" fill="#9FC7FA" cx="7.5" cy="2" r="2" />
            </g>
          </g>
        </svg>

        <Heart
          className={cn(
            isMobile
              ? 'h-5 w-5'
              : size === 'sm'
                ? 'h-4 w-4'
                : 'h-5 w-5',
            'twitter-like-heart transition-transform duration-200 group-hover:scale-110 pointer-events-none',
            isAnimating && displayLiked && 'is-animating',
            displayLiked && 'fill-current'
          )}
          strokeWidth={displayLiked ? 0 : 2}
        />
      </span>

      <span
        className={cn(
          'font-bold tabular-nums pointer-events-none',
          isMobile
            ? 'text-[15px]'
            : size === 'sm'
              ? 'text-sm'
              : 'text-sm'
        )}
      >
        <span
          className={cn(
            'twitter-like-count',
            isCountAnimating && (countDirection === 'up' ? 'is-up' : 'is-down')
          )}
        >
          {isCountAnimating ? (
            <>
              <span className="twitter-like-count-old">{formatDisplayCount(previousDisplayCount)}</span>
              <span className="twitter-like-count-new">{formatDisplayCount(displayCount)}</span>
            </>
          ) : (
            <span className="twitter-like-count-static">{formatDisplayCount(displayCount)}</span>
          )}
        </span>
      </span>
    </button>
  );
}
