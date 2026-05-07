import { useState } from 'react';
import { Heart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/currentUser';

// ─── 数値フォーマット（PostCard と完全同一） ──────────────────────────────────
const formatDisplayCount = (count: number = 0) => {
  const n = count ?? 0;
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  return n.toLocaleString();
};

// ─── テーブル設定（type ごとに切り替え） ──────────────────────────────────────
const TABLE = {
  post:    { table: 'post_likes',    idCol: 'post_id'    },
  comment: { table: 'comment_likes', idCol: 'comment_id' },
} as const;

export function LikeButton({
  postId,       // post の場合は post ID、comment の場合は comment ID を渡す
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
  const [optimisticLiked, setOptimisticLiked] = useState(liked);
  const [optimisticCount, setOptimisticCount] = useState(count ?? 0);
  const [isPending, setIsPending] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isPending) return;

    const userId = await getCurrentUserId();
    if (!userId) return;

    // オプティミスティック UI
    const newLiked = !optimisticLiked;
    setOptimisticLiked(newLiked);
    setOptimisticCount((c) => (newLiked ? c + 1 : Math.max(0, c - 1)));
    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 300);

    setIsPending(true);
    try {
      const { table, idCol } = TABLE[type];
      if (newLiked) {
        await supabase.from(table).insert({ [idCol]: postId, user_id: userId });
      } else {
        await supabase.from(table).delete().match({ [idCol]: postId, user_id: userId });
      }
    } catch {
      // 失敗時はロールバック
      setOptimisticLiked(!newLiked);
      setOptimisticCount((c) => (newLiked ? Math.max(0, c - 1) : c + 1));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={handleClick}
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors',
        optimisticLiked
          ? 'text-primary'
          : 'text-muted-foreground hover:text-primary',
      )}
      aria-label={optimisticLiked ? 'いいねを取り消す' : 'いいねする'}
    >
      <Heart
        className={cn(
          size === 'sm' ? 'h-4 w-4' : 'h-5 w-5',
          'transition-transform group-hover:scale-110',
          isAnimating && 'scale-125',
          optimisticLiked && 'fill-current animate-heart-pop',
        )}
      />
      <span className={cn('font-bold tabular-nums', size === 'sm' ? 'text-xs' : 'text-sm')}>
        {formatDisplayCount(optimisticCount)}
      </span>
    </button>
  );
}