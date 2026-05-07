import { useState, useEffect, useRef, useCallback } from 'react';
import { Heart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/currentUser';
import { useQueryClient } from '@tanstack/react-query'; // 追加

interface CommentlikebuttonProps {
  commentId: string;
  liked: boolean;
  count: number;
}

const formatDisplayCount = (count: number = 0) => {
  const n = count ?? 0;
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  return n.toLocaleString();
};

export function Commentlikebutton({ 
  commentId, 
  liked: initialLiked, 
  count: initialCount 
}: CommentlikebuttonProps) {
  const queryClient = useQueryClient();
  const [displayLiked, setDisplayLiked] = useState(initialLiked);
  const [displayCount, setDisplayCount] = useState(initialCount ?? 0);
  const [isPending, setIsPending] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  // 正常なボタンと同じく「liked, count, 進行状況」をRefで一括管理
  const stateRef = useRef({ 
    liked: initialLiked, 
    count: initialCount ?? 0, 
    isProcessing: false 
  });

  useEffect(() => {
    // 通信中でない場合のみ、キャッシュ等からのProps更新を反映
    if (!stateRef.current.isProcessing) {
      setDisplayLiked(initialLiked);
      setDisplayCount(initialCount ?? 0);
      stateRef.current.liked = initialLiked;
      stateRef.current.count = initialCount ?? 0;
    }
  }, [initialLiked, initialCount]);

  const handleLike = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 1. 物理ロック
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

    // 2. 楽観的UI更新
    setDisplayLiked(willBeLiked);
    setDisplayCount(prev => willBeLiked ? prev + 1 : Math.max(0, prev - 1));
    stateRef.current.liked = willBeLiked;

    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 300);

    try {
      if (willBeLiked) {
        const { error } = await supabase
          .from('comment_likes')
          .insert({ comment_id: commentId, user_id: userId });
        
        // 【重要】409(Conflict/23505)は「既にいいね済み」なので無視。
        // これをエラーにしないことで、画面の数字が戻るのを防ぐ。
        if (error && error.code !== '23505') throw error;
      } else {
        const { error } = await supabase
          .from('comment_likes')
          .delete()
          .match({ comment_id: commentId, user_id: userId });
        
        if (error) throw error;
      }

      // 3. 【重要】キャッシュの無効化（投稿ボタンと同じ処理）
      // DB側のトリガーが計算した「本当の数値」を再フェッチさせる
      await queryClient.invalidateQueries({ queryKey: ['comments'] });

    } catch (error: any) {
      console.error('Comment like action failed:', error);
      // 409以外の本当のエラー時のみ、Refに保存してある元の数値に戻す
      setDisplayLiked(wasLiked);
      setDisplayCount(stateRef.current.count);
      stateRef.current.liked = wasLiked;
    } finally {
      // 連続クリックを防止するために0.5秒のクールダウン
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
        'group inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors outline-none select-none',
        displayLiked ? 'text-pink-500' : 'text-muted-foreground hover:text-pink-500',
        isPending && 'pointer-events-none opacity-60'
      )}
    >
      <Heart
        className={cn(
          'h-4 w-4 transition-transform group-hover:scale-110 pointer-events-none',
          isAnimating && 'scale-125',
          displayLiked && 'fill-current animate-heart-pop'
        )}
        strokeWidth={displayLiked ? 0 : 2}
      />
      <span className="text-xs font-bold tabular-nums pointer-events-none">
        {formatDisplayCount(displayCount)}
      </span>
    </button>
  );
}