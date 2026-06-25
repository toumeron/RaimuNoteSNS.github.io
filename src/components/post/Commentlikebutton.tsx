import { useState, useEffect, useRef, useCallback } from 'react';
import { Heart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/currentUser';
import { useQueryClient } from '@tanstack/react-query';
import { useIsPWA } from '@/hooks/useIsPWA';

interface CommentlikebuttonProps {
  commentId: string;
  liked: boolean;
  count: number;
  size?: 'sm' | 'md';
}

const formatDisplayCount = (count: number = 0) => {
  const n = Number(count) || 0;
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  return n.toLocaleString();
};

export function Commentlikebutton({
  commentId,
  liked: initialLiked,
  count: initialCount,
  size = 'md',
}: CommentlikebuttonProps) {
  const queryClient = useQueryClient();
  const isPWA = useIsPWA();
  const [isMobile, setIsMobile] = useState(false);
  const isPWAMobile = isPWA && isMobile;

  const [displayLiked, setDisplayLiked] = useState(initialLiked);
  const [displayCount, setDisplayCount] = useState(Number(initialCount) || 0);
  const [isPending, setIsPending] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  const stateRef = useRef({
    liked: initialLiked,
    count: Number(initialCount) || 0,
    isProcessing: false,
  });

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
    if (!stateRef.current.isProcessing) {
      const safeCount = Number(initialCount) || 0;
      setDisplayLiked(initialLiked);
      setDisplayCount(safeCount);
      stateRef.current.liked = initialLiked;
      stateRef.current.count = safeCount;
    }
  }, [initialLiked, initialCount]);

  const handleLike = useCallback(async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (stateRef.current.isProcessing) return;

    stateRef.current.isProcessing = true;
    setIsPending(true);

    const userId = await getCurrentUserId();
    if (!userId) {
      alert('ログインが必要です');
      stateRef.current.isProcessing = false;
      setIsPending(false);
      return;
    }

    const wasLiked = stateRef.current.liked;
    const willBeLiked = !wasLiked;

    stateRef.current.liked = willBeLiked;
    setDisplayLiked(willBeLiked);
    setDisplayCount((prev) => (willBeLiked ? prev + 1 : Math.max(0, prev - 1)));

    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 300);

    try {
      if (willBeLiked) {
        const { error } = await supabase
          .from('comment_likes')
          .upsert(
            { comment_id: commentId, user_id: userId },
            { onConflict: 'comment_id, user_id' }
          );

        if (error && error.code !== '23505') throw error;
      } else {
        const { error } = await supabase
          .from('comment_likes')
          .delete()
          .match({ comment_id: commentId, user_id: userId });

        if (error) throw error;
      }

      await queryClient.invalidateQueries({ queryKey: ['comments'] });
    } catch (err: any) {
      console.error('Comment like action failed:', err);
      setDisplayLiked(wasLiked);
      setDisplayCount(stateRef.current.count);
      stateRef.current.liked = wasLiked;
    } finally {
      setTimeout(() => {
        stateRef.current.isProcessing = false;
        setIsPending(false);
      }, 500);
    }
  }, [commentId, queryClient]);

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={handleLike}
      className={cn(
        'group inline-flex items-center rounded-full transition-colors outline-none select-none',
        isMobile
          ? 'gap-1.5 px-2 py-1 text-[13px] h-full'
          : 'gap-1.5 px-2.5 py-1',
        isPWAMobile && 'min-h-[32px]',
        displayLiked ? 'text-pink-500' : 'text-muted-foreground hover:text-pink-500',
        isPending && 'pointer-events-none opacity-70'
      )}
    >
      <Heart
        className={cn(
          isMobile
            ? 'h-5 w-5'
            : size === 'sm'
              ? 'h-4 w-4'
              : 'h-5 w-5',
          'transition-transform duration-200 group-hover:scale-110 pointer-events-none',
          isAnimating && 'scale-125',
          displayLiked && 'fill-current animate-heart-pop'
        )}
        strokeWidth={displayLiked ? 0 : 2}
      />
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
        {formatDisplayCount(displayCount)}
      </span>
    </button>
  );
}
