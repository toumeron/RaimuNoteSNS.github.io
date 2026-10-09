import { useAuth } from '@/hooks/useAuth';
import { useUnreadNotifications } from '@/hooks/useUnreadNotifications';

export function UnreadBadge({ userId, floating = true }: {userId?: string; floating?: boolean}) {
  const {user} = useAuth();
  const {data: count = 0, isError} = useUnreadNotifications(userId ?? user?.id);
  if (!count || isError) return null;
  return <span data-lime-unread-count={count} aria-label={`未読の通知${count}件`} style={{fontSize: 9, lineHeight: 1, height: 15, minWidth: 15}} className={`${floating ? 'absolute -right-1.5 -top-1' : 'shrink-0'} pointer-events-none flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-primary px-[3px] text-[9px] font-bold leading-none text-white`}>
    {count > 99 ? '99+' : count}
  </span>;
}
