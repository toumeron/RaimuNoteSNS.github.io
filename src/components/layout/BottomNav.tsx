import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation } from 'react-router-dom';
import { Home, User as UserIcon, Settings as SettingsIcon, Search, MessageSquare } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

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

export function BottomNav() {
  const { user } = useAuth();
  const location = useLocation();
  const timelineChrome = useTimelineChrome(location.pathname);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!user) return null;

  const useTimelineChromeDesign = timelineChrome.enabled;
  const isTimelineDark = timelineChrome.theme === 'dark';

  const items = [
    { to: '/', icon: Home, label: 'ホーム', end: true },
    { to: '/search', icon: Search, label: '検索' },
    { to: `/u/${user.username}`, icon: UserIcon, label: 'プロフ' },
    { to: '/chat', icon: MessageSquare, label: 'チャット' },
    { to: '/settings', icon: SettingsIcon, label: '設定' },
  ];

  const nav = (
    <nav
      className={cn(
        'fixed bottom-0 left-0 right-0 border-t backdrop-blur-md md:hidden',
        useTimelineChromeDesign
          ? isTimelineDark
            ? 'border-white/[0.06] bg-[#05070a]/82 text-white supports-[backdrop-filter]:bg-[#05070a]/74 backdrop-blur-2xl'
            : 'border-black/[0.08] bg-white/82 text-zinc-950 supports-[backdrop-filter]:bg-white/74 backdrop-blur-2xl'
          : 'border-border/60 bg-background/90'
      )}
      style={{
        zIndex: 2147483647,
        isolation: 'isolate',
        paddingBottom: 'calc(-15px + env(safe-area-inset-bottom))',
      }}
    >
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {items.map((it) => (
          <li key={it.to}>
            <NavLink
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-1 py-2.5 text-[10px] font-bold transition',
                  useTimelineChromeDesign
                    ? isActive
                      ? 'text-primary'
                      : isTimelineDark
                        ? 'text-white/68'
                        : 'text-zinc-700/72'
                    : isActive
                      ? 'text-primary'
                      : 'text-muted-foreground'
                )
              }
            >
              <it.icon className="h-5 w-5" />
              {it.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );

  // fixed要素でも、親要素側にtransform/filter/z-indexなどのstacking contextがあると
  // ページ内の要素に負けることがあるため、body直下へ逃がす。
  if (mounted && typeof document !== 'undefined') {
    return createPortal(nav, document.body);
  }

  return nav;
}
