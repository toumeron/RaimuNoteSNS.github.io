import { useState, useEffect, useRef, useCallback } from 'react';
import { Heart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/currentUser';
import { useQueryClient } from '@tanstack/react-query';
import { useIsPWA } from '@/hooks/useIsPWA';

const formatDisplayCount = (count: number = 0) => {
  const n = Number(count) || 0; // 確実に数値に変換
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  return n.toLocaleString();
};

const TABLE_CONFIG = {
  post: { table: 'likes', idCol: 'post_id', queryKey: 'posts' },
  comment: { table: 'comment_likes', idCol: 'comment_id', queryKey: 'comments' },
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
  animation: twitterLikeHeart 0.25s 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275) both;
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
    transform: scale(0.2);
  }
  to {
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

export function LikeButton({
  postId,
  liked,
  count,
  size = 'md',
  type = 'post',
}: {
  postId: string;
  liked: boolean;
  count: number;
  size?: 'sm' | 'md';
  type?: 'post' | 'comment';
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
  const hasLocalStateRef = useRef(false);

  // 最新の状態を常に保持するためのRef
  const stateRef = useRef({ liked, count: Number(count) || 0 });

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById(TWITTER_LIKE_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = TWITTER_LIKE_STYLE_ID;
    style.textContent = TWITTER_LIKE_STYLES;
    document.head.appendChild(style);
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

  // クリックまたは初期DB確認の前だけPropsと同期する。
  useEffect(() => {
    const targetChanged =
      lastTargetRef.current.postId !== postId || lastTargetRef.current.type !== type;

    if (targetChanged) {
      lastTargetRef.current = { postId, type };
      hasLocalStateRef.current = false;
    }

    if (targetChanged || !hasLocalStateRef.current) {
      const safeCount = Number(count) || 0;
      setDisplayLiked(liked);
      setDisplayCount(safeCount);
      setPreviousDisplayCount(safeCount);
      setIsCountAnimating(false);
      stateRef.current.liked = liked;
      stateRef.current.count = safeCount;
    }
  }, [postId, type, liked, count]);

  // props の liked が false のまま来るケースに備えて、表示初期化時だけDB上の実状態を反映する。
  useEffect(() => {
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
      setDisplayLiked(currentLiked);
      stateRef.current.liked = currentLiked;
      hasLocalStateRef.current = true;
    };

    syncInitialLiked();

    return () => {
      cancelled = true;
    };
  }, [postId, type]);

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

  const handleClick = useCallback(async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const wasLiked = stateRef.current.liked;
    const wasCount = stateRef.current.count;
    const willBeLiked = !wasLiked;
    const nextCount = willBeLiked ? wasCount + 1 : Math.max(0, wasCount - 1);

    stateRef.current.liked = willBeLiked;
    stateRef.current.count = nextCount;
    hasLocalStateRef.current = true;

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

      // DB反映を待つ
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
  }, [animateCount, postId, queryClient, type]);

  return (
    <button
      type="button"
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
