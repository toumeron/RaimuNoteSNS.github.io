import { useState, useEffect, useRef, useCallback } from 'react';
import { Heart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/currentUser';
import { useQueryClient } from '@tanstack/react-query';

const formatDisplayCount = (count: number = 0) => {
  const n = count ?? 0;
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
  
  // 表示用の状態（楽観的更新用）
  const [displayLiked, setDisplayLiked] = useState(liked);
  const [displayCount, setDisplayCount] = useState(count);
  const [isPending, setIsPending] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  // 最新の状態を常に保持するためのRef（関数の外側から値を参照する）
  const stateRef = useRef({ liked, count, isProcessing: false });

  // Propsが外部から更新されたら、処理中でない場合のみ同期
  useEffect(() => {
    if (!stateRef.current.isProcessing) {
      setDisplayLiked(liked);
      setDisplayCount(count);
      stateRef.current.liked = liked;
      stateRef.current.count = count;
    }
  }, [liked, count]);

  const handleClick = useCallback(async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    // 1. 物理ロック（ここを通れるのは1回のリクエストサイクルで一度だけ）
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
        // すでに存在する場合のエラーを考慮して insert
        const { error } = await supabase
          .from(config.table)
          .insert({ [config.idCol]: postId, user_id: userId });
        
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
    // 依存関係から displayLiked や count を外し、関数の再生成を抑える
  }, [postId, queryClient, type]);

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={handleClick}
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors outline-none select-none',
        displayLiked ? 'text-pink-500' : 'text-muted-foreground hover:text-pink-500',
        isPending && 'pointer-events-none opacity-70'
      )}
    >
      <Heart
        className={cn(
          size === 'sm' ? 'h-4 w-4' : 'h-5 w-5',
          'transition-transform duration-200 group-hover:scale-110 pointer-events-none',
          isAnimating && 'scale-125',
          displayLiked && 'fill-current animate-heart-pop',
        )}
        strokeWidth={displayLiked ? 0 : 2}
      />
      <span className={cn('font-bold tabular-nums pointer-events-none', size === 'sm' ? 'text-xs' : 'text-sm')}>
        {formatDisplayCount(displayCount)}
      </span>
    </button>
  );
}