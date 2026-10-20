import { DesktopLayoutContext } from "./DesktopLayoutContext";
import React, { useEffect, useState, useCallback, useRef, type ReactElement, forwardRef } from "react";
import { Outlet, Navigate, useLocation, NavLink as BottomNavNavLink, useNavigate, NavLinkProps, Link } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { useAuth } from "@/hooks/useAuth";
import { CallSessionProvider } from "@/components/chat/CallSessionProvider";

import { PageCompanion } from "@/components/ai/PageCompanion";
import { Skeleton, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/button";
import { PrivateAccountBadge, Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { isIpad, cn } from "@/lib/utils";
import { UnreadBadge } from "@/components/search/SearchExploreContent";
import { createPortal } from "react-dom";
import { Bell, Home, User as UserIcon, Settings as SettingsIcon, Search, MessageSquare, Loader2, TrendingUp, Check, CircleEllipsis, Plus, X } from "lucide-react";
import { CommentForm } from "@/components/post/CommentForm";
import { useTrends, useHiddenTrends } from "@/hooks/useTopics";
import { useSavedAccountUnreadTotal } from "@/hooks/useOSNotification";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Drawer } from "vaul";
import { toast } from "sonner";
import { type SavedAccount } from "@/lib/savedAccounts";

import { SUSPENSION_EVENT, SUSPENSION_MESSAGE } from "@/lib/accountSuspension";

// BottomNav
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

    let frame=0,lastInset=0;
    const commit=(next:number)=>{if(next!==lastInset){lastInset=next;setKeyboardInset(next);}};
    const measure = () => {
      frame=0;
      const isMobileWidth = window.innerWidth < 768;

      if (!isMobileWidth || !viewport) {
        commit(0);
        return;
      }

      const editing = document.activeElement instanceof HTMLElement && (document.activeElement.matches('input, textarea') || document.activeElement.isContentEditable);
      const heightDiff = editing ? window.innerHeight - viewport.height : 0;
      commit(heightDiff > 120 ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0);
    };

    const update=()=>{if(!frame)frame=requestAnimationFrame(measure);};
    measure();

    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.addEventListener('focusin', update);
    window.addEventListener('focusout', update);

    return () => {
      if(frame)cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.removeEventListener('focusin', update);
      window.removeEventListener('focusout', update);
    };
  }, []);

  return { isKeyboardOpen: keyboardInset > 0, keyboardInset };
}

function BottomNav() {
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
    { to: '/notifications', icon: Bell, label: '通知' },
    { to: '/messages', icon: MessageSquare, label: 'チャット' },
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
        borderBottomLeftRadius: 'var(--lime-mobile-drawer-radius, 0px)',
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

      <ul hidden={isKeyboardOpen} className={cn("mx-auto max-w-md grid-cols-6", isKeyboardOpen ? "hidden" : "grid")}>
        {items.map((it) => (
          <li key={it.to}>
            <BottomNavNavLink
              to={it.to}
              aria-label={it.label}
              end={it.end}
              onClick={it.onClick}
              className={({ isActive }) =>
                cn(
                  'flex h-14 items-center justify-center transition-colors',
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
              <span className="relative inline-flex"><it.icon className="h-6 w-6" />{it.to === "/notifications" && <UnreadBadge />}</span>
            </BottomNavNavLink>
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

// DesktopSidebar
// AccountSwitcher
function AccountAvatar({ account, small = false }: { account: SavedAccount; small?: boolean }) {
  return <Avatar className={small ? 'h-8 w-8 border-0' : 'h-11 w-11 shrink-0 border-0'}>
    <AvatarImage src={account.avatarUrl} alt="" />
    <AvatarFallback>{(account.displayName || account.username).slice(0, 1)}</AvatarFallback>
  </Avatar>;
}
function SavedAccountList({ onDone, managing = false, mobile = false }: { onDone?: () => void; managing?: boolean; mobile?: boolean }) {
  const { user, accounts = [], switching = false, switchAccount, forgetAccount } = useAuth();
  const navigate = useNavigate();
  const ids = [...new Set([...accounts.map(account => account.id), ...(user ? [user.id] : [])])].sort();
  const { data: profiles = [] } = useQuery({
    queryKey: ['saved-account-profiles', ids], enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, username, display_name, avatar_url, is_official, is_private').in('id', ids);
      if (error) throw error;
      return data ?? [];
    }, staleTime: 60_000,
  });
  const list = [...accounts];
  if (user && !list.some(account => account.id === user.id)) list.unshift({ id: user.id, username: user.username ?? '', displayName: user.displayName ?? '', avatarUrl: user.avatarUrl ?? '', isOfficial: user.isOfficial, isPrivate: user.isPrivate, needsLogin: false });
  const resolved = list.map(account => {
    const profile = profiles.find(row => row.id === account.id);
    return profile ? { ...account, username: profile.username ?? account.username, displayName: profile.display_name ?? account.displayName, avatarUrl: profile.avatar_url ?? account.avatarUrl, isOfficial: !!profile.is_official, isPrivate: !!profile.is_private } : account;
  });
  return <div className={mobile ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y' : 'max-h-[min(55dvh,400px)] overflow-y-auto overscroll-contain'} data-lime-account-list>
    {resolved.map(account => <div key={account.id} className="flex items-center">
      <button type="button" disabled={switching} aria-label={`${account.displayName} @${account.username}${account.id === user?.id ? '（ログイン中）' : 'に切り替える'}`} aria-pressed={account.id === user?.id}
        className={`flex min-w-0 flex-1 items-center gap-3 px-4 text-left transition-colors hover:bg-muted/60 disabled:opacity-50 ${mobile ? 'py-4' : 'py-3'}`}
        onClick={async () => {
          if (account.needsLogin) { onDone?.(); navigate('/auth?add=1'); return; }
          try { await switchAccount(account.id); onDone?.(); navigate('/'); }
          catch (error) { toast.error(error instanceof Error ? error.message : 'アカウントの切り替えに失敗しました'); }
        }}>
        <AccountAvatar account={account} />
        <span className="min-w-0 flex-1"><span className={`flex min-w-0 items-center gap-1 font-bold ${mobile ? "text-base" : "text-[15px]"}`}><span className="truncate">{account.displayName}</span>{account.isPrivate && <PrivateAccountBadge/>}{account.isOfficial && <img src={`${import.meta.env.BASE_URL}verified.png`} alt="認証済み" className="h-4 w-4 shrink-0" />}</span><span className="block truncate text-sm text-muted-foreground">@{account.username}</span>{account.needsLogin && <span className="text-xs text-muted-foreground">再ログイン</span>}</span>
        <UnreadBadge userId={account.id} floating={false} />
        {account.id === user?.id && <Check className={`h-5 w-5 shrink-0 ${mobile ? "rounded-full bg-primary p-1 text-primary-foreground" : "text-green-500"}`} aria-label="ログイン中" />}
      </button>
      {managing && account.id !== user?.id && <button type="button" disabled={switching} aria-label={`@${account.username}をこの端末の保存から削除`} className="mr-3 rounded-full p-2 text-muted-foreground hover:bg-muted" onClick={() => forgetAccount(account.id)}><X className="h-4 w-4" /></button>}
    </div>)}
  </div>;
}
function AccountActions({ onDone }: { onDone: () => void }) {
  const { user, logout, switching = false } = useAuth();
  const navigate = useNavigate();
  return <div className="shrink-0 border-t border-border py-1">
    <button type="button" disabled={switching} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-bold hover:bg-muted/60" onClick={() => { onDone(); navigate('/auth?add=1'); }}><Plus className="h-4 w-4" />既存のアカウントを追加</button>
    {user && <button type="button" disabled={switching} className="w-full px-4 py-3 text-left text-sm font-bold hover:bg-muted/60" onClick={async () => {
      try { await logout(); onDone(); navigate('/auth'); }
      catch { toast.error('ログアウトに失敗しました'); }
    }}>@{user.username}からログアウト</button>}
  </div>;
}
function AccountSwitcherMenu({ children, onDone }: { children: ReactElement; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const done = () => { setOpen(false); onDone?.(); };
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>{children}</PopoverTrigger>
    <PopoverContent side="top" align="start" sideOffset={10} collisionPadding={12} className="z-[500] w-[min(340px,calc(100vw-24px))] overflow-hidden rounded-2xl border-0 p-0 shadow-[0_8px_40px_rgba(0,0,0,0.35)] dark:shadow-[0_0_24px_rgba(255,255,255,0.2),0_12px_40px_rgba(0,0,0,0.6)]" aria-label="アカウント切り替え" data-lime-account-switcher>
      <SavedAccountList onDone={done} />
      <AccountActions onDone={done} />
    </PopoverContent>
  </Popover>;
}
function MobileAccountSwitcher({ children, onDone }: { children: ReactElement; onDone: () => void }) {
  const { switching = false } = useAuth();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const done = () => { setOpen(false); setEditing(false); onDone(); };
  return <Drawer.Root open={open} onOpenChange={value => { setOpen(value); if (!value) setEditing(false); }} shouldScaleBackground={false} handleOnly>
    <Drawer.Trigger asChild>{children}</Drawer.Trigger>
    <Drawer.Portal>
      <Drawer.Overlay className="fixed inset-0 z-[2147483199] bg-black/60" />
      <Drawer.Content aria-describedby={undefined} data-lime-account-switcher data-lime-mobile-account-sheet className="fixed inset-x-0 bottom-0 z-[2147483200] flex h-[min(88dvh,850px)] flex-col overflow-hidden rounded-t-[28px] border-0 bg-popover dark:bg-black text-popover-foreground outline-none pb-[env(safe-area-inset-bottom)]">
        <Drawer.Handle aria-label="アカウント一覧を閉じる" className="mx-auto mt-2 h-1 w-11 shrink-0 bg-muted-foreground/40" />
        <div className="relative flex shrink-0 items-center justify-center px-5 py-4">
          <button type="button" disabled={switching} className="absolute left-5 text-sm disabled:opacity-50" onClick={() => setEditing(!editing)}>{editing ? '完了' : '編集'}</button>
          <Drawer.Title className="text-base font-bold">アカウント</Drawer.Title>
        </div>
        <SavedAccountList onDone={done} managing={editing} mobile />
        <AccountActions onDone={done} />
      </Drawer.Content>
    </Drawer.Portal>
  </Drawer.Root>;
}
function MobileAccountShortcuts({ onDone }: { onDone: () => void }) {
  const { user, accounts = [], switching = false } = useAuth();
  const others = accounts.filter(account => account.id !== user?.id);
  return <div className="ml-auto flex shrink-0 items-center gap-1" data-lime-mobile-account-shortcuts>
    <MobileAccountSwitcher onDone={onDone}>
      <button type="button" disabled={switching} aria-label="アカウント一覧を開く" className="flex items-center gap-1 rounded-full p-1 disabled:opacity-50">
        {switching ? <Loader2 className="h-5 w-5 animate-spin" /> : others.length ? others.slice(0, 2).map(account => <AccountAvatar key={account.id} account={account} small />) : null}
        {!switching && <CircleEllipsis className="ml-2 h-6 w-6" />}
      </button>
    </MobileAccountSwitcher>
  </div>;
}

// DesktopSidebar
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

// NavLink
interface NavLinkCompatProps extends Omit<NavLinkProps, "className"> {
  className?: string;
  activeClassName?: string;
  pendingClassName?: string;
}

const NavLink = forwardRef<HTMLAnchorElement, NavLinkCompatProps>(
  ({ className, activeClassName, pendingClassName, to, ...props }, ref) => {
    return (
      <BottomNavNavLink
        ref={ref}
        to={to}
        className={({ isActive, isPending }) =>
          cn(className, isActive && activeClassName, isPending && pendingClassName)
        }
        {...props}
      />
    );
  },
);

NavLink.displayName = "NavLink";

// Logo
type LimeProStatusEvent = CustomEvent<{
  hasLimePro: boolean;
}>;

function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const {user}=useAuth();
  const queryClient=useQueryClient();
  const sizes = {
    sm: { text: 'text-lg', icon: 'h-5 w-5' },
    md: { text: 'text-2xl', icon: 'h-6 w-6' },
    lg: { text: 'text-4xl', icon: 'h-9 w-9' },
  } as const;

  const s = sizes[size];

  const mountedRef = useRef(true);
  const statusRef = useRef<boolean | null>(null);
  const localChangeVersionRef = useRef(0);

  const readCachedStatus = () => {
    const cached = localStorage.getItem('limepro_status');

    if (cached === 'true') return true;
    if (cached === 'false') return false;

    return null;
  };

  const [hasLimePro, setHasLimePro] = useState<boolean | null>(() => {
    const cached = readCachedStatus();
    statusRef.current = cached;
    return cached;
  });

  useEffect(() => {
    mountedRef.current = true;
    let active=true;

    let broadcastChannel: BroadcastChannel | null = null;

    const applyLimeProStatus = (nextStatus: boolean, fromLocalChange = false) => {
      if (fromLocalChange) {
        localChangeVersionRef.current += 1;
        if(user)queryClient.setQueryData(['limepro-status',user.id],{data:nextStatus?{feature:'limepro'}:null,error:null});
      }

      statusRef.current = nextStatus;
      localStorage.setItem('limepro_status', String(nextStatus));

      if (mountedRef.current) {
        setHasLimePro(nextStatus);
      }
    };

    const syncFromLocalStorage = () => {
      const cached = readCachedStatus();

      if (typeof cached === 'boolean' && cached !== statusRef.current) {
        applyLimeProStatus(cached, true);
      }
    };

    const fetchLimeProStatus = async () => {
      const versionAtStart = localChangeVersionRef.current;

      if (!user) {
        if (versionAtStart === localChangeVersionRef.current) {
          applyLimeProStatus(false);
        }
        return;
      }

      const { data, error } = await queryClient.fetchQuery({
        queryKey:['limepro-status',user.id],staleTime:60_000,
        queryFn:()=>supabase
        .from('user_entitlements')
        .select('feature')
        .eq('user_id', user.id)
        .eq('feature', 'limepro')
        .maybeSingle(),
      });

      if (error) {
        console.error('Fetch Logo LimePro Status Error:', error);
        return;
      }

      if (!active || versionAtStart !== localChangeVersionRef.current) {
        return;
      }

      applyLimeProStatus(!!data);
    };

    const handleLocalLimeProChange = (event: Event) => {
      const customEvent = event as LimeProStatusEvent;
      const nextStatus = customEvent.detail?.hasLimePro;

      if (typeof nextStatus === 'boolean') {
        applyLimeProStatus(nextStatus, true);
      }
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== 'limepro_status') return;
      syncFromLocalStorage();
    };

    const handleFocusOrVisible = () => {
      if(document.visibilityState==='hidden')return;
      syncFromLocalStorage();
      fetchLimeProStatus();
    };

    window.addEventListener('limepro-status-changed', handleLocalLimeProChange);
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('focus', handleFocusOrVisible);
    document.addEventListener('visibilitychange', handleFocusOrVisible);

    if ('BroadcastChannel' in window) {
      broadcastChannel = new BroadcastChannel('limepro-status');

      broadcastChannel.onmessage = (event) => {
        const nextStatus = event.data?.hasLimePro;

        if (typeof nextStatus === 'boolean') {
          applyLimeProStatus(nextStatus, true);
        }
      };
    }

    fetchLimeProStatus();

    return () => {
      active=false;
      mountedRef.current = false;

      window.removeEventListener('limepro-status-changed', handleLocalLimeProChange);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('focus', handleFocusOrVisible);
      document.removeEventListener('visibilitychange', handleFocusOrVisible);

      if (broadcastChannel) {
        broadcastChannel.close();
      }
    };
  }, [user?.id,queryClient]);

  return (
    <Link data-lime-brand-logo to="/" style={{'--gradient-primary':'linear-gradient(135deg, hsl(340 90% 70%), hsl(340 85% 58%))'} as React.CSSProperties} className="inline-flex items-center gap-2 font-display font-black">
      <span className={`${s.text} bg-gradient-primary bg-clip-text text-transparent`}>
        Lime
      </span>
      <span className={`${s.text} text-accent ${hasLimePro === null ? 'invisible' : ''}`}>
        {hasLimePro ? 'Pro' : 'Note'}
      </span>
    </Link>
  );
}

// AppLayout
function AppLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [mapSidebarClosed, setMapSidebarClosed] = useState(false);
  useEffect(() => {
    const toggle = (event: Event) => setMapSidebarClosed((event as CustomEvent<boolean>).detail === true);
    window.addEventListener('lime-maps-sidebar-toggle', toggle);
    return () => window.removeEventListener('lime-maps-sidebar-toggle', toggle);
  }, []);
  useEffect(() => setMapSidebarClosed(false), [location.pathname]);
  const [desktopSidebarContainer, setDesktopSidebarContainer] = useState<HTMLDivElement | null>(null);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 640px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 640px)');
    const update = () => setIsDesktop(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  // ルーティング（パス）が変更されるたびに、強制的にページトップへスクロールする
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const isDirectMessagesPage = location.pathname === '/messages' || location.pathname.startsWith('/messages/');
  const isAccountAboutPage = /^\/u\/[^/]+\/about$/.test(location.pathname);
  const isPostActivityPage = /^\/post\/[^/]+\/activity$/.test(location.pathname);
  const isPostDetailPage = /^\/post\/[^/]+$/.test(location.pathname);
  // 大文字小文字を区別せず /limepro または /LimePro にマッチさせる判定
  const isLimeProPage = /^\/limepro$/i.test(location.pathname);

  if (loading) {
    return (
      <div className="min-h-screen p-8">
        <Skeleton className="h-16 w-48" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" state={{ from: location }} replace />;

  // ページのパスに応じてメインコンテナのクラス名を切り替える
  let mainClassName = 'mx-auto max-w-2xl px-4 py-6';
  if (location.pathname === '/maps' || location.pathname === '/notifications' || (location.pathname === '/topics' || location.pathname === '/lists' || location.pathname.startsWith('/lists/')) || location.pathname === '/settings' || location.pathname.startsWith('/news')) mainClassName = 'w-full max-w-none px-0 py-0';
  if (/^\/u\/[^/]+$/.test(location.pathname)) mainClassName = 'mx-auto max-w-2xl px-4 py-6 max-sm:pt-0';
  if (/^\/u\/[^/]+\/followers_following\/?$/.test(location.pathname)) mainClassName = 'mx-auto max-w-2xl px-0 py-0';
  if (isPostActivityPage) mainClassName = 'mx-auto max-w-2xl px-0 py-0';
  if (isAccountAboutPage) mainClassName = 'mx-auto max-w-2xl px-0 py-0';

  if (isLimeProPage) {
    // LimeProページの場合は最大幅制限を解除し、パディングもゼロにする（フルスクリーン対応）
    mainClassName = 'w-full max-w-none px-0 py-0';
  } else if (location.pathname === '/bookmarks' || location.pathname === '/search') {
    mainClassName = 'mx-auto max-w-2xl px-0 py-0';
  } else if (isPostDetailPage) {
    mainClassName = 'mx-auto max-w-2xl px-4 pb-6 pt-0';
  }

  if (isDirectMessagesPage) mainClassName = 'w-full max-w-none p-0';

  if (isDesktop) {
    const isWorkspacePage = isDirectMessagesPage || location.pathname === '/chat' || location.pathname.startsWith('/media');
    const hideHeader = isDirectMessagesPage || location.pathname === '/maps' || (location.pathname.startsWith('/u/') && !isAccountAboutPage) || ['/search', '/settings', '/chat', '/bookmarks'].includes(location.pathname) || location.pathname.startsWith('/media') || isPostDetailPage;
    const showRightSidebar = !isDirectMessagesPage && !['/chat', '/settings', '/maps'].includes(location.pathname);
    const isEdgePage = isPostActivityPage || location.pathname === '/maps' || location.pathname.startsWith('/news') || location.pathname === '/settings' || location.pathname === '/notifications' || (location.pathname === '/topics' || location.pathname === '/lists' || location.pathname.startsWith('/lists/')) || isWorkspacePage || location.pathname === '/bookmarks' || location.pathname === '/' || location.pathname.startsWith('/u/') || isPostDetailPage;
    return (
      <CallSessionProvider>
        {!isDirectMessagesPage && <PageCompanion userId={user.id} />}
        <DesktopLayoutContext.Provider value={true}>
        <div className="lime-app-shell" data-lime-page={location.pathname}
          data-lime-map-sidebar-collapsed={location.pathname === '/maps' && mapSidebarClosed && !isIpad() || undefined}
          data-lime-ipad={isIpad() || undefined}
          data-lime-workspace={isDirectMessagesPage || location.pathname === '/chat' || undefined}
          data-lime-direct-workspace={isDirectMessagesPage || undefined}
          data-lime-hide-header={hideHeader || undefined}
          data-lime-edge={isEdgePage || undefined}
          data-lime-timeline={location.pathname === '/' || undefined}>
          <div className="lime-desktop-menu" ref={setDesktopSidebarContainer} />
          <div className="lime-desktop-column">
            <Header desktopLayout desktopSidebarContainer={desktopSidebarContainer} />
            <main className="lime-desktop-main"><Outlet /></main>
          </div>
          {showRightSidebar && <DesktopTimelineSidebar />}
        </div>
        </DesktopLayoutContext.Provider>
      </CallSessionProvider>
    );
  }

  return (
    // LimeProページの場合はボトムナビゲーション用の余白(pb-20)を削除する
    <CallSessionProvider>
        {!isDirectMessagesPage && <PageCompanion userId={user.id} />}
      <div className={`min-h-screen ${isDirectMessagesPage || isLimeProPage || location.pathname === '/maps' ? 'pb-0' : (location.pathname === '/topics' || location.pathname === '/lists' || location.pathname.startsWith('/lists/')) ? 'pb-[var(--lime-bottom-nav-height,64px)] md:pb-0' : 'pb-20 md:pb-0'}`}>

        {/* LimeProページ以外でのみヘッダーを表示する */}
        {!isLimeProPage && location.pathname !== '/bookmarks' && <Header />}

        <main className={mainClassName}>
          <Outlet />
        </main>

        {/* LimeProページ以外でのみボトムナビゲーションを表示する */}
        {!isLimeProPage && <BottomNav />}

      </div>
    </CallSessionProvider>
  );
}

// ScrollToTop
const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    // ページ（パス）が変わるたびに、スクロール位置を 0, 0 (左上) に戻す
    window.scrollTo(0, 0);
  }, [pathname]);

  return null; // 何も表示しない
};

// AccountSuspension
function SuspensionNotice({profile = false}: {profile?: boolean}) {
  return <section className={profile ? "mx-auto max-w-xl px-8 py-20 sm:px-12 sm:py-28" : "border-b border-border px-6 py-10 sm:px-10 sm:py-12"} aria-label="アカウントの停止">
    <h1 className={`${profile ? "text-3xl" : "text-2xl"} font-extrabold leading-tight sm:text-4xl`}>{profile ? 'アカウントは停止されています' : 'ご利用のアカウントは停止されています'}</h1>
    <p className="mt-5 text-base leading-relaxed text-muted-foreground sm:text-lg">{profile ? 'LimeNoteでは、利用規約に違反しているアカウントを停止しています' : 'ご利用のアカウントは読み取り専用になっています。ポスト、返信、リポスト、いいね、フォロー、メッセージの送信などの操作はできません。'}<Link to="/terms" className="text-primary hover:underline">利用規約</Link></p>
  </section>;
}
function AccountSuspensionFeedback() {
  const {user} = useAuth();
  const [visible,setVisible] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const show = () => {setVisible(true);clearTimeout(timer);timer=setTimeout(()=>setVisible(false),7000);};
    window.addEventListener(SUSPENSION_EVENT,show);
    return () => {window.removeEventListener(SUSPENSION_EVENT,show);clearTimeout(timer);};
  },[]);
  useEffect(()=>{setVisible(false);},[user?.id]);
  return visible ? <div role="alert" className="fixed bottom-24 left-1/2 z-[2147483500] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 rounded-lg bg-primary px-5 py-4 text-primary-foreground shadow-lg sm:bottom-8"><p className="text-sm sm:text-base">{SUSPENSION_MESSAGE}</p></div> : null;
}

export { AppLayout };
export { ScrollToTop };
export { BottomNav };
export { DesktopTimelineSidebar };
export { TrendSection };
export type { TrendItem };
export { DesktopAccountFooter };
export { SavedAccountList };
export { AccountSwitcherMenu };
export { MobileAccountSwitcher };
export { MobileAccountShortcuts };
export { NavLink };
export { Logo };
export { SuspensionNotice };
export { AccountSuspensionFeedback };
