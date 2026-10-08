import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Home, User as UserIcon, Settings as SettingsIcon, Search, MessageSquare } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { CommentForm } from '@/components/post/CommentForm';

type TimelineChromeTheme = 'light' | 'dark';

type TimelineChromeState = {
  theme: TimelineChromeTheme;
  hasTimelineBackground: boolean;
};

// 検索ボタンをダブルタップ/ダブルクリックしたときに、検索ページ(SearchPage.tsx)へ
// 「検索前のトップ画面へ戻る」ことを伝えるイベント。SearchPage.tsx側でこれを監視して
// 検索語・入力欄をリセットする。
const SEARCH_HOME_REQUESTED_EVENT = 'lime-search-home-requested';
// Header.tsx(モバイルの検索バー)側と共通のイベント。query が空文字のとき、
// Headerは検索欄をクリアして未検索状態に戻す。
const SEARCH_QUERY_CHANGED_EVENT = 'lime-search-query-changed';
// ダブルタップとみなす最大間隔(ms)。
const SEARCH_DOUBLE_TAP_INTERVAL_MS = 350;

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

/**
 * モバイルSafari(iOS)対策:
 * どこかの入力欄にフォーカスしてソフトキーボードが開くと、
 * position:fixedで最下部に固定しているこのナビが、
 * ブラウザの自動スクロールと噛み合わずに画面中央あたりへ
 * 「浮いて」表示されてしまうことがある（モバイルのみで発生）。
 *
 * window.visualViewport のサイズを監視し、実際に見えている高さが
 * window.innerHeight よりも大幅に小さくなった（＝キーボードが開いた）
 * と判定できる間は、ナビリンクを隠す。返信フォームはアンマウントせず
 * キーボード上へ移動し、入力のフォーカスを維持する。
 */
function useIsMobileKeyboardOpen() {
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const viewport = window.visualViewport;

    const update = () => {
      const isMobileWidth = window.innerWidth < 768;

      if (!isMobileWidth || !viewport) {
        setKeyboardInset(0);
        return;
      }

      const heightDiff = window.innerHeight - viewport.height;
      setKeyboardInset(heightDiff > 120 ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0);
    };

    update();

    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);

    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return { isKeyboardOpen: keyboardInset > 0, keyboardInset };
}

export function BottomNav() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const timelineChrome = useTimelineChrome(location.pathname);
  const [mounted, setMounted] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);
  const { isKeyboardOpen, keyboardInset } = useIsMobileKeyboardOpen();
  // 検索ボタンを最後にタップした時刻。ダブルタップ/ダブルクリック判定用。
  const lastSearchTapAtRef = useRef(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  const postDetailId = getPostDetailId(location.pathname);
  const showPostCommentForm = Boolean(postDetailId);

  // 検索ボタンのダブルタップ/ダブルクリック: 検索トップ(検索前のメイン画面)へ戻す。
  // 1回目のタップは通常どおり NavLink による /search への遷移に任せる。
  // 350ms以内の2回目のタップで、検索語・入力欄・ヘッダーの検索欄をリセットする。
  const handleSearchNavClick = useCallback(() => {
    const now = Date.now();
    const isDoubleTap = now - lastSearchTapAtRef.current <= SEARCH_DOUBLE_TAP_INTERVAL_MS;

    if (!isDoubleTap) {
      lastSearchTapAtRef.current = now;
      return;
    }

    // 3回連続タップで意図せず再発火しないよう、判定をリセットする。
    lastSearchTapAtRef.current = 0;

    // SearchPage.tsx: 検索語・入力欄をリセットして検索前の画面へ戻す。
    window.dispatchEvent(new CustomEvent(SEARCH_HOME_REQUESTED_EVENT));
    // Header.tsx: 検索欄のクリアと、未検索状態(ヘッダーのスクロール開閉が有効な状態)への復帰。
    window.dispatchEvent(new CustomEvent(SEARCH_QUERY_CHANGED_EVENT, { detail: { query: '' } }));

    window.scrollTo({ top: 0, behavior: 'auto' });

    // 検索結果の ?q= が残らないよう、履歴を置き換えて /search へ移動する。
    // resetSearchHome は SearchPage.tsx が navigation state 経由でも「検索トップへ戻る」ことを
    // 検知できるようにするための目印(イベントが届かなかった場合の保険)。毎回異なる値にする。
    navigate('/search', { replace: true, state: { resetSearchHome: Date.now() } });
  }, [navigate]);

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
  }, [mounted, location.pathname, showPostCommentForm, isKeyboardOpen]);

  if (!user) return null;

  // モバイルでソフトキーボードが開いている間は、ナビが画面中央に
  // 返信入力欄はアンマウントせず、キーボードの上に維持する。
  if (isKeyboardOpen && !showPostCommentForm) return null;

  const useTimelineChromeDesign = timelineChrome.enabled;
  const isTimelineDark = timelineChrome.theme === 'dark';
  const hideTopBorder = isBottomNavTopBorderHiddenPath(location.pathname);

  const items: Array<{
    to: string;
    icon: typeof Home;
    label: string;
    end?: boolean;
    onClick?: () => void;
  }> = [
    { to: '/', icon: Home, label: 'ホーム', end: true },
    { to: '/search', icon: Search, label: '検索', onClick: handleSearchNavClick },
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
        data-lime-bottom-nav-root="true"
        data-lime-post-detail-bottom-nav={hideTopBorder ? 'true' : undefined}
        className={cn(
          'fixed bottom-0 left-0 right-0 md:hidden',
        hideTopBorder ? '!border-t-0' : 'border-t',
        useTimelineChromeDesign
          ? isTimelineDark
            ? 'border-white/[0.06] bg-background/80 text-white supports-[backdrop-filter]:bg-background/70 backdrop-blur-md backdrop-blur-2xl'
            : 'border-black/[0.08] bg-white/82 text-zinc-950 supports-[backdrop-filter]:bg-white/74 backdrop-blur-md backdrop-blur-2xl'
          : 'border-border/60 bg-background',
      )}
      style={{
        zIndex: 120,
        isolation: 'isolate',
        borderTop: hideTopBorder ? '0 solid transparent' : undefined,
        borderTopWidth: hideTopBorder ? 0 : undefined,
        borderTopColor: hideTopBorder ? 'transparent' : undefined,
        bottom: isKeyboardOpen ? keyboardInset : 0,
        paddingBottom: isKeyboardOpen ? 0 : 'max(0px, env(safe-area-inset-bottom))',
        // HeaderのモバイルDrawer開閉に合わせてBottomNavも同じだけ追従させる。
        // z-indexはDrawerより下、rootの通常stacking contextより上に置く。
        transform: 'translate3d(var(--lime-mobile-drawer-shift, 0px), 0, 0)',
        transition: 'var(--lime-mobile-drawer-transition, none)',
        willChange: 'transform',
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
            <CommentForm key={`${postDetailId}-${location.search}`} postId={postDetailId} parentCommentId={new URLSearchParams(location.search).get('reply')} variant="bottomNav" />
          </div>
        </div>
      )}

      <ul hidden={isKeyboardOpen} className={cn("mx-auto max-w-md grid-cols-5", isKeyboardOpen ? "hidden" : "grid")}>
        {items.map((it) => (
          <li key={it.to}>
            <NavLink
              to={it.to}
              end={it.end}
              onClick={it.onClick}
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
