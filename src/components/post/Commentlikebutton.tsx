// src/components/comment/CommentLikeButton.tsx
// PostカードのLikeButtonと同じUXをコメント用に実装

import { useState } from 'react';
import { Heart } from 'lucide-react';
import { supabase } from '@/lib/supabase'; // パスはプロジェクトに合わせて
import { getCurrentUserId } from '@/lib/currentUser';

interface CommentLikeButtonProps {
  commentId: string;
  liked: boolean;
  count: number | string;
}

export function Commentlikebutton({ commentId, liked: initialLiked, count: initialCount }: CommentLikeButtonProps) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(
    typeof initialCount === 'string' ? parseInt(initialCount.replace(/[^0-9]/g, ''), 10) || 0 : initialCount
  );
  const [isAnimating, setIsAnimating] = useState(false);

  const handleLike = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const userId = await getCurrentUserId();
    if (!userId) return;

    // オプティミスティックUI
    const newLiked = !liked;
    setLiked(newLiked);
    setCount(c => newLiked ? c + 1 : c - 1);
    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 300);

    if (newLiked) {
      await supabase.from('comment_likes').insert({ comment_id: commentId, user_id: userId });
    } else {
      await supabase.from('comment_likes').delete().match({ comment_id: commentId, user_id: userId });
    }
  };

const formatCount = (count: number | undefined | null) => {
  if (count === undefined || count === null) return "0";
  return count.toLocaleString();
};

  return (
    <button
      onClick={handleLike}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors
        ${liked
          ? 'text-rose-500 hover:text-rose-600'
          : 'text-muted-foreground hover:text-rose-400'
        }`}
    >
      <Heart
        className={`h-4 w-4 transition-transform ${isAnimating ? 'scale-125' : 'scale-100'}`}
        fill={liked ? 'currentColor' : 'none'}
        strokeWidth={liked ? 0 : 2}
      />
      <span className="font-bold tabular-nums">{formatCount(count)}</span>
    </button>
  );
}