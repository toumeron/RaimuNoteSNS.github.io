import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation } from 'react-router-dom';
import { Home, User as UserIcon, Settings as SettingsIcon, Search, MessageSquare } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { CommentForm } from '@/components/post/CommentForm';

type TimelineChromeTheme = 'light' | 'dark';

type TimelineChromeState = {
  theme: TimelineChromeTheme;
  hasTimelineBackground: boolean;
};

function normalizeAppPath(pathname: string) {
  const normalized = pathname.replace(/^\/RaimuNoteSNS\.github\.io(?=\/|$)/, '') || '/';
  return normalized === '' ? '/' : normalized;
}

function isTimelineVisualPath(pathname: string) {
  const normalizedPath = normalizeAppPath(pathname);

  return (
    normalizedPath === '/' ||
    normalizedPath.startsWith('/post/')
  );
}

function getNormalizedCurrentPath(pathname: string) {
  if (typeof window === 'undefined') {
    return normalizeAppPath(pathname);
  }

  return normalizeAppPath(window.location.pathname || pathname);
}

function getPostDetailId(pathname: string) {
  const normalizedPath = getNormalizedCurrentPath(pathname);
  const match = normalizedPath.match(/^\/post\/([^/?#]+)\/?$/);
  return match?.[1] ?? null;
}

function isBottomNavTopBorderHiddenPath(pathname: string) {
  const normalizedPath = getNormalizedCurrentPath(pathname);

  return /^\/post\/[^/?#]+\/?$/.test(normalizedPath);
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
    enabled: isTimelineVisualPath(pathname) && state.hasTimelineBackground,
    theme: state.theme,
  };
}

export function BottomNav() {
  const { user } = useAuth();
  const location = useLocation();
  const timelineChrome = useTimelineChrome(location.pathname);
  const [mounted, setMounted] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const postDetailId = getPostDetailId(location.pathname);
  const showPostCommentForm = Boolean(postDetailId);

  useEffect(() => {
    if (!mounted || typeof window === 'undefined') return;

    let frameId = 0;

    const updateBottomNavHeight = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const height = navRef.current?.getBoundingClientRect().height ?? 0;
        document.documentElement.style.setProperty(
          '--lime-bottom-nav-height',
          `${Math.ceil(height)}px`
        );
      });
    };

    updateBottomNavHeight();

    let resizeObserver: ResizeObserver | null = null;
    if (navRef.current && 'ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(updateBottomNavHeight);
      resizeObserver.observe(navRef.current);
    }

    window.addEventListener('resize', updateBottomNavHeight);
    window.addEventListener('orientationchange', updateBottomNavHeight);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateBottomNavHeight);
      window.removeEventListener('orientationchange', updateBottomNavHeight);
      document.documentElement.style.removeProperty('--lime-bottom-nav-height');
    };
  }, [mounted, location.pathname, showPostCommentForm]);

  if (!user) return null;

  const useTimelineChromeDesign = timelineChrome.enabled;
  const isTimelineDark = timelineChrome.theme === 'dark';
  const hideTopBorder = isBottomNavTopBorderHiddenPath(location.pathname);

  const items = [
    { to: '/', icon: Home, label: 'ホーム', end: true },
    { to: '/search', icon: Search, label: '検索' },
    { to: `/u/${user.username}`, icon: UserIcon, label: 'プロフ' },
    { to: '/chat', icon: MessageSquare, label: 'チャット' },
    { to: '/settings', icon: SettingsIcon, label: '設定' },
  ];

  const postDetailBorderStyles = hideTopBorder ? (
    <style>{`
      @media (max-width: 767px) {
        nav[data-lime-post-detail-bottom-nav="true"] {
          border-top: 0 !important;
          border-top-width: 0 !important;
          border-top-color: transparent !important;
        }

        nav[data-lime-post-detail-bottom-nav="true"] > [data-lime-post-comment-shell="true"] {
          border-top-width: 1px !important;
          border-top-style: solid !important;
          border-bottom: 0 !important;
        }
      }
    `}</style>
  ) : null;

  const nav = (
    <>
      {postDetailBorderStyles}
      <nav
        ref={navRef}
        data-lime-post-detail-bottom-nav={hideTopBorder ? 'true' : undefined}
        className={cn(
          'fixed bottom-0 left-0 right-0 md:hidden',
        hideTopBorder ? '!border-t-0' : 'border-t',
        useTimelineChromeDesign
          ? isTimelineDark
            ? 'border-white/[0.06] bg-[#05070a]/82 text-white supports-[backdrop-filter]:bg-[#05070a]/74 backdrop-blur-md backdrop-blur-2xl'
            : 'border-black/[0.08] bg-white/82 text-zinc-950 supports-[backdrop-filter]:bg-white/74 backdrop-blur-md backdrop-blur-2xl'
          : 'border-border/60 bg-background',
      )}
      style={{
        zIndex: 120,
        isolation: 'isolate',
        borderTop: hideTopBorder ? '0 solid transparent' : undefined,
        borderTopWidth: hideTopBorder ? 0 : undefined,
        borderTopColor: hideTopBorder ? 'transparent' : undefined,
        paddingBottom: 'max(0px, env(safe-area-inset-bottom))',
      }}
    >
        {showPostCommentForm && postDetailId && (
          <div
            data-lime-post-comment-shell="true"
            className={cn(
              'px-3 pb-2 pt-2',
              hideTopBorder && 'border-t',
              !hideTopBorder && 'border-b',
              useTimelineChromeDesign
                ? isTimelineDark
                  ? 'border-white/[0.06]'
                  : 'border-black/[0.08]'
                : 'border-border/60'
            )}
          >
          <div className="mx-auto max-w-md">
            <CommentForm postId={postDetailId} variant="bottomNav" />
          </div>
        </div>
      )}

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
    </>
  );

  // fixed要素でも、親要素側にtransform/filter/z-indexなどのstacking contextがあると
  // ページ内の要素に負けることがあるため、body直下へ逃がす。
  if (mounted && typeof document !== 'undefined') {
    return createPortal(nav, document.body);
  }

  return nav;
}
