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
  post:    { table: 'likes',         idCol: 'post_id',    queryKey: 'posts' },
  comment: { table: 'comment_likes', idCol: 'comment_id', queryKey: 'comments' },
} as const;

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
  const [isPending, setIsPending] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  // 最新の状態を常に保持するためのRef
  const stateRef = useRef({ liked, count: Number(count) || 0, isProcessing: false });

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

  // Propsが外部から更新されたら、処理中でない場合のみ同期
  useEffect(() => {
    if (!stateRef.current.isProcessing) {
      const safeCount = Number(count) || 0;
      setDisplayLiked(liked);
      setDisplayCount(safeCount);
      stateRef.current.liked = liked;
      stateRef.current.count = safeCount;
    }
  }, [liked, count]);

  const handleClick = useCallback(async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    // 1. 物理ロック
    if (stateRef.current.isProcessing) return;
    
    stateRef.current.isProcessing = true;
    setIsPending(true);

    const userId = await getCurrentUserId();
    if (!userId) {
      alert("ログインが必要です");
      stateRef.current.isProcessing = false;
      setIsPending(false);
      return;
    }

    // 現在の状態から次の状態を計算
    const wasLiked = stateRef.current.liked;
    const willBeLiked = !wasLiked;
    
    // 状態を更新（RefとState両方）
    stateRef.current.liked = willBeLiked;
    setDisplayLiked(willBeLiked);
    setDisplayCount(prev => willBeLiked ? prev + 1 : Math.max(0, prev - 1));
    
    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 300);

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
      setDisplayLiked(wasLiked);
      setDisplayCount(stateRef.current.count);
      stateRef.current.liked = wasLiked;
    } finally {
      // 連続クリック防止のためのクールダウン
      setTimeout(() => {
        stateRef.current.isProcessing = false;
        setIsPending(false);
      }, 500);
    }
  }, [postId, queryClient, type]);

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={handleClick}
      className={cn(
        'group inline-flex items-center rounded-full transition-colors outline-none select-none',
        isMobile
          ? 'gap-1.5 px-2 py-1 text-[13px] h-full'
          : 'gap-1.5 px-2.5 py-1',
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
          displayLiked && 'fill-current animate-heart-pop',
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