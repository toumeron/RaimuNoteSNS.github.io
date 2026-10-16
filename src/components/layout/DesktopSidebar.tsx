import { useNavigate } from "react-router-dom";
import { useTrends, useHiddenTrends } from "@/hooks/useTrends";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, TrendingUp } from "lucide-react";
import { PrivateAccountBadge } from "@/components/common/OfficialBadge";
import { useSavedAccountUnreadTotal } from "@/hooks/useUnreadNotifications";
import { AccountSwitcherMenu } from "@/components/layout/AccountSwitcher";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

// TrendSection
type TrendItem = { title: string; traffic: string; rank?: number };

// Shared existing search UI, also used in the desktop timeline sidebar.
function TrendSection({ items, loading, onSelect }: {
  items: TrendItem[];
  loading: boolean;
  onSelect: (title: string) => void;
}) {
  return (
<div className="px-4">
        <div className="bg-black/[0.02] dark:bg-white/[0.03] rounded-2xl border border-black/[0.03] dark:border-white/[0.05] overflow-hidden">
          <div className="px-4 py-3 border-b border-black/[0.03] dark:border-white/[0.05] flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            <h2 className="font-extrabold text-xl">トレンド</h2>
          </div>

          {loading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="flex flex-col">
              {items.length > 0 ? (
                items.map((trend, idx) => (
                  <button
                    key={idx}
                    data-lime-sidebar-trend-title={trend.title}
                    data-lime-trend-rank={trend.rank ?? idx + 1}
                    onClick={() => onSelect(trend.title)}
                    className="px-4 py-3 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-colors border-b last:border-none border-black/[0.03] dark:border-white/[0.05] flex flex-col gap-0.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] text-[rgb(83,100,113)] dark:text-gray-400">{trend.rank ?? idx + 1} · トレンド</span>
                    </div>
                    <div className="font-bold text-[15px]">{trend.title}</div>
                  </button>
                ))
              ) : (
                <div className="px-4 py-8 text-center text-[rgb(83,100,113)] dark:text-gray-400 text-[14px]">
                  現在、トレンドを取得できません
                </div>
              )}
            </div>
          )}
        </div>
      </div>
  );
}

// DesktopSidebar
function DesktopTimelineSidebar() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data = [], isPending } = useTrends();
  const [hidden] = useHiddenTrends(user?.id ?? null);
  const visible = data.filter(item => !hidden.has(item.title)).slice(0, 6);
  return (
    <aside className="lime-desktop-discover" aria-label="トレンド">
      <TrendSection items={visible} loading={isPending} onSelect={title => navigate(`/search?q=${encodeURIComponent(title)}`)} />
    </aside>
  );
}

// DesktopAccountFooter
function DesktopAccountFooter() {
  const { user } = useAuth();
  const unreadTotal = useSavedAccountUnreadTotal();
  const { data: profile } = useQuery({
    queryKey: ['desktop-account-profile', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles')
        .select('username, display_name, avatar_url, is_official, is_private').eq('id', user!.id).single();
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
    <AccountSwitcherMenu><button type="button" className="relative w-full text-left" data-lime-sidebar-account aria-label={`ログイン中のアカウント: ${name}（アカウント切り替え）`}>
      <div className="relative shrink-0">
        <Avatar userId={user.id} className="h-11 w-11 border-0">
          <AvatarImage src={profile?.avatar_url || user.avatarUrl} alt={name} />
          <AvatarFallback>{name.slice(0, 1)}</AvatarFallback>
        </Avatar>
        {(profile?.is_private || profile?.is_official) && <span data-lime-account-avatar-badge className="items-center gap-0.5">
          {profile?.is_private && <PrivateAccountBadge className="h-4 w-4"/>}
          {profile?.is_official && <img src={badge} alt="Official" className="h-4 w-4"/>}
        </span>}
      </div>
      <div data-lime-account-info className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate text-[18px] font-extrabold">{name}</span>
          {profile?.is_private && <PrivateAccountBadge className="h-5 w-5"/>}
          {profile?.is_official && <img src={badge} alt="Official" className="h-5 w-5 shrink-0" />}
        </div>
        <div className="truncate text-[15px] text-muted-foreground">@{username}</div>
      </div>
      {unreadTotal > 0 && <span aria-label="保存済みアカウントに未読通知があります" className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" />}
    </button></AccountSwitcherMenu>
  );
}

export { DesktopTimelineSidebar };
export { TrendSection };
export type { TrendItem };
export { DesktopAccountFooter };
