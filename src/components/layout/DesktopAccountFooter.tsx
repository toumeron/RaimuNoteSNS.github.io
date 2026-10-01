import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export function DesktopAccountFooter() {
  const { user } = useAuth();
  const { data: profile } = useQuery({
    queryKey: ['desktop-account-profile', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles')
        .select('username, display_name, avatar_url, is_official').eq('id', user!.id).single();
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
  if (!user) return null;
  const name = profile?.display_name || user.displayName || user.username || '';
  const username = profile?.username || user.username || '';
  const badge = `${import.meta.env.BASE_URL}verified.png`;
  return (
    <Link to={`/u/${username}`} data-lime-sidebar-account aria-label={`ログイン中のアカウント: ${name}`}>
      <div className="relative shrink-0">
        <Avatar className="h-11 w-11 border-0">
          <AvatarImage src={profile?.avatar_url || user.avatarUrl} alt={name} />
          <AvatarFallback>{name.slice(0, 1)}</AvatarFallback>
        </Avatar>
        {profile?.is_official && <img data-lime-account-avatar-badge src={badge} alt="Official" />}
      </div>
      <div data-lime-account-info className="min-w-0">
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate text-[18px] font-extrabold">{name}</span>
          {profile?.is_official && <img src={badge} alt="Official" className="h-5 w-5 shrink-0" />}
        </div>
        <div className="truncate text-[15px] text-muted-foreground">@{username}</div>
      </div>
    </Link>
  );
}
