import { Loader2, UserCheck, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFollowStats, useToggleFollow } from '@/hooks/useProfile';
import { cn } from '@/lib/utils';

export function FollowButton({ userId }: { userId: string }) {
  const { data } = useFollowStats(userId);
  const { mutate, isPending } = useToggleFollow(userId);
  const followed = data?.followedByMe ?? false;

  return (
    <Button
      onClick={() => mutate()}
      disabled={isPending}
      className={cn(
        'rounded-full px-5 font-bold shadow-soft transition',
        followed
          ? 'bg-secondary text-secondary-foreground hover:bg-destructive/10 hover:text-destructive'
          : 'bg-gradient-primary text-primary-foreground hover:shadow-pop',
      )}
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : followed ? (
        <>
          <UserCheck className="mr-1.5 h-4 w-4" /> フォロー中
        </>
      ) : (
        <>
          <UserPlus className="mr-1.5 h-4 w-4" /> フォロー
        </>
      )}
    </Button>
  );
}
