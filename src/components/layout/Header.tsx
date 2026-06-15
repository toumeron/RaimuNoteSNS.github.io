import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Logo } from './Logo';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import {
  LogOut,
  Settings as SettingsIcon,
  User as UserIcon,
  Search,
  Bell,
  MessageSquare,
  Images,
} from 'lucide-react';

type TimelineChromeTheme = 'light' | 'dark';

type TimelineChromeState = {
  theme: TimelineChromeTheme;
  hasTimelineBackground: boolean;
};

function isTimelinePath(pathname: string) {
  return (
    pathname === '/' ||
    pathname === '/RaimuNoteSNS.github.io' ||
    pathname === '/RaimuNoteSNS.github.io/'
  );
}

function readTimelineChromeState(): TimelineChromeState {
  if (typeof window === 'undefined') {
    return { theme: 'dark', hasTimelineBackground: false };
  }

  const rawTheme = localStorage.getItem('lime_timeline_visual_theme');
  const theme: TimelineChromeTheme = rawTheme === 'light' ? 'light' : 'dark';
  const hasTimelineBackground =
    localStorage.getItem('lime_timeline_background_enabled') === 'true' ||
    Boolean(localStorage.getItem('lime_timeline_background_url'));

  return { theme, hasTimelineBackground };
}

function useTimelineChrome(pathname: string) {
  const [state, setState] = useState<TimelineChromeState>(() => readTimelineChromeState());

  useEffect(() => {
    const syncFromStorage = () => {
      setState(readTimelineChromeState());
    };

    const handleThemeEvent = (event: Event) => {
      const detail = (event as CustomEvent<Partial<TimelineChromeState>>).detail;

      if (!detail) {
        syncFromStorage();
        return;
      }

      setState({
        theme: detail.theme === 'light' ? 'light' : 'dark',
        hasTimelineBackground: Boolean(detail.hasTimelineBackground),
      });
    };

    window.addEventListener('timeline-visual-theme-changed', handleThemeEvent);
    window.addEventListener('storage', syncFromStorage);

    let channel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel('timeline-visual-theme');
      channel.onmessage = (event) => {
        const data = event.data as Partial<TimelineChromeState> | undefined;
        if (!data) return;

        setState({
          theme: data.theme === 'light' ? 'light' : 'dark',
          hasTimelineBackground: Boolean(data.hasTimelineBackground),
        });
      };
    }

    syncFromStorage();

    return () => {
      window.removeEventListener('timeline-visual-theme-changed', handleThemeEvent);
      window.removeEventListener('storage', syncFromStorage);
      channel?.close();
    };
  }, []);

  return {
    enabled: isTimelinePath(pathname) && state.hasTimelineBackground,
    theme: state.theme,
  };
}

export const Header = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const timelineChrome = useTimelineChrome(location.pathname);

  const isSearchPage = location.pathname === '/u/LimeBiz';
  const useTimelineChromeDesign = timelineChrome.enabled;
  const isTimelineDark = timelineChrome.theme === 'dark';

  const handleLogoClick = () => {
    window.location.href = import.meta.env.BASE_URL;
  };

  const notices = [
    '【お知らせ】いつもLimeNoteをご利用いただきありがとうございます。より快適にサービスをご利用いただけるよう、システムの軽微な調整および表示改善を実施いたしました。これに伴い、一部画面の表示速度や操作感が向上しております。今後も皆さまに安心してご利用いただけるサービス運営に努めてまいります。引き続きLimeNoteをよろしくお願いいたします。',
  ];

  const menuItemClass = useTimelineChromeDesign
    ? isTimelineDark
      ? 'focus:bg-zinc-800 focus:text-zinc-50'
      : 'focus:bg-zinc-100 focus:text-zinc-950'
    : 'dark:focus:text-black';

  const dropdownClass = useTimelineChromeDesign
    ? isTimelineDark
      ? 'z-[2147483647] w-56 rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-50 shadow-xl'
      : 'z-[2147483647] w-56 rounded-xl border border-zinc-200 bg-white text-zinc-950 shadow-xl'
    : 'z-[60] w-56 rounded-xl border-border/60 bg-popover text-popover-foreground shadow-xl';

  const separatorClass = useTimelineChromeDesign
    ? isTimelineDark
      ? 'bg-zinc-800'
      : 'bg-zinc-200'
    : undefined;

  return (
    <header
      className={cn(
        'sticky top-0 z-[2147483646] border-b backdrop-blur-md',
        useTimelineChromeDesign
          ? isTimelineDark
            ? 'border-white/[0.06] bg-[#090b10]/78 text-white supports-[backdrop-filter]:bg-[#090b10]/70 backdrop-blur-2xl'
            : 'border-black/[0.08] bg-white/78 text-zinc-950 supports-[backdrop-filter]:bg-white/70 backdrop-blur-2xl'
          : 'z-50 border-border/40 bg-background/80'
      )}
    >
      <style>
        {`
          @keyframes notice-scroll {
            0% { transform: translateX(0); }
            100% { transform: translateX(-50%); }
          }

          .notice-scroll {
            animation: notice-scroll 28s linear infinite;
          }

          .notice-scroll:hover {
            animation-play-state: paused;
          }
        `}
      </style>

      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
        <div onClick={handleLogoClick} className="cursor-pointer">
          <Logo />
        </div>

        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-full ring-2 ring-transparent transition hover:ring-primary/40 outline-none">
                <Avatar className="h-10 w-10 border-2 border-primary/30">
                  <AvatarImage src={user.avatarUrl} alt={user.displayName} />
                  <AvatarFallback>{user.displayName?.slice(0, 1)}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align="end"
              className={dropdownClass}
              style={{ zIndex: 2147483647 }}
            >
              <DropdownMenuItem onClick={() => navigate('/search')} className={menuItemClass}>
                <Search className="mr-2 h-4 w-4" /> 検索
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => navigate('/notifications')} className={menuItemClass}>
                <Bell className="mr-2 h-4 w-4" /> 通知
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => navigate('/chat')} className={menuItemClass}>
                <MessageSquare className="mr-2 h-4 w-4" /> チャット
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => navigate('/media')} className={menuItemClass}>
                <Images className="mr-2 h-4 w-4" /> フォト(Beta)
              </DropdownMenuItem>

              <DropdownMenuSeparator className={separatorClass} />

              <DropdownMenuItem onClick={() => navigate(`/u/${user.username}`)} className={menuItemClass}>
                <UserIcon className="mr-2 h-4 w-4" /> プロフィール
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => navigate('/settings')} className={menuItemClass}>
                <SettingsIcon className="mr-2 h-4 w-4" /> 設定
              </DropdownMenuItem>

              <DropdownMenuSeparator className={separatorClass} />

              <DropdownMenuItem
                onClick={() => {
                  logout();
                  navigate('/auth');
                }}
                className={cn(
                  'text-destructive focus:bg-destructive/10',
                  useTimelineChromeDesign && isTimelineDark
                    ? 'focus:bg-red-950/60 focus:text-red-200'
                    : 'dark:focus:bg-destructive dark:focus:text-white'
                )}
              >
                <LogOut className="mr-2 h-4 w-4" /> ログアウト
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button asChild size="sm" className="rounded-full px-6 font-bold">
            <Link to="/auth">はじめる</Link>
          </Button>
        )}
      </div>

      {isSearchPage && (
        <div className="w-full overflow-hidden bg-green-600 text-white">
          <div className="notice-scroll flex w-max whitespace-nowrap py-1 text-sm font-bold">
            {[...notices, ...notices].map((notice, index) => (
              <span key={index} className="mx-8">
                {notice}
              </span>
            ))}
          </div>
        </div>
      )}
    </header>
  );
};
