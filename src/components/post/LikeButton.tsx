import { Heart } from 'lucide-react';
import { useToggleLike } from '@/hooks/useFeed';
import { cn } from '@/lib/utils';

export function LikeButton({
  postId,
  liked,
  count,
  size = 'md',
}: {
  postId: string;
  liked: boolean;
  count: number;
  size?: 'sm' | 'md';
}) {
  const { mutate, isPending } = useToggleLike();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        mutate(postId);
      }}
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors',
        liked ? 'text-primary' : 'text-muted-foreground hover:text-primary',
      )}
      aria-label={liked ? 'いいねを取り消す' : 'いいねする'}
    >
      <Heart
        className={cn(
          size === 'sm' ? 'h-4 w-4' : 'h-5 w-5',
          'transition-transform group-hover:scale-110',
          liked && 'fill-current animate-heart-pop',
        )}
      />
      <span className={cn('font-bold tabular-nums', size === 'sm' ? 'text-xs' : 'text-sm')}>{count}</span>
    </button>
  );
}
