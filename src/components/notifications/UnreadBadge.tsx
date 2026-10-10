import { useAuth } from '@/hooks/useAuth';
import { useUnreadNotifications } from '@/hooks/useUnreadNotifications';

export function UnreadBadge({ userId, floating = true }: {userId?: string; floating?: boolean}) {
  const {user} = useAuth();
  const {data: count = 0, isError} = useUnreadNotifications(userId ?? user?.id);
  if (!count || isError) return null;
  return <span data-lime-unread-count={count} aria-label={`未読の通知${count}件`} style={{fontFamily:'system-ui, sans-serif',fontSize:13,fontWeight:400,lineHeight:1,height:19,minWidth:19,border:'1px solid hsl(var(--background))',padding:'0 2px',...(floating?{position:'absolute',right:2,top:1,transform:'translate(50%, -50%)'}: {})}} className="pointer-events-none flex shrink-0 items-center justify-center rounded-full bg-primary text-white">
    {count > 99 ? '99+' : count}
  </span>;
}
