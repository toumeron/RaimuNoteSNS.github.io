import { DesktopAccountFooter } from './DesktopAccountFooter';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Logo } from './Logo';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { searchBluesky } from '@/lib/bluesky';
import type { User } from '@/types';
import {
  LogOut,
  Settings as SettingsIcon,
  User as UserIcon,
  Search,
  Bell,
  MessageSquare,
  Images,
  UserRound,
  X,
  Clock,
  Home,
} from 'lucide-react';

type TimelineChromeTheme = 'light' | 'dark';

type TimelineChromeState = {
  theme: TimelineChromeTheme;
  hasTimelineBackground: boolean;
};

// 最新/フォロー中/トレンドタブの選択状態。タブUI自体はFeed.tsxから移設してここに置く。
// Feed.tsx側は 'lime-active-feed-tab-changed' イベントとこのlocalStorageキーを
// 監視するだけで、実際の切り替えはこちら(Header)が起点になる。
type FeedTabValue = 'all' | 'following' | 'trending';

const ACTIVE_FEED_TAB_STORAGE_KEY = 'lime_active_feed_tab';
const ACTIVE_FEED_TAB_CHANGED_EVENT = 'lime-active-feed-tab-changed';

// タブの定義。デザインはProfile.tsxのタブ(profile-tabs-trigger / 中央グリッドの
// segmented control)をそのまま踏襲している。
const FEED_TABS: Array<{ value: FeedTabValue; label: string }> = [
  { value: 'all', label: '最新' },
  { value: 'following', label: 'フォロー中' },
  { value: 'trending', label: 'トレンド' },
];


type FeedTabViewTransition = {
  finished: Promise<void>;
  skipTransition?: () => void;
};

type FeedTabViewTransitionDocument = Document & {
  startViewTransition?: (updateCallback: () => void | Promise<void>) => FeedTabViewTransition;
};

// 下線の左右に足す余白(px)。文字幅ぴったりだと窮屈に見えるため少し広げる。
const TAB_UNDERLINE_PADDING = 10;

// ヘッダーの検索バー(旧SearchPage.tsxの検索入力欄をここに移設したもの)の
// 「Blueskyの投稿を含めない」設定を保持するlocalStorageキー。
// SearchPage.tsx側もこのキーとイベントを監視して、ヘッダーでの変更を反映する。
const SEARCH_EXCLUDE_BLUESKY_STORAGE_KEY = 'lime_search_exclude_bluesky';
const SEARCH_EXCLUDE_BLUESKY_CHANGED_EVENT = 'lime-search-exclude-bluesky-changed';
const SEARCH_QUERY_CHANGED_EVENT = 'lime-search-query-changed';

function readExcludeBlueskyPosts(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(SEARCH_EXCLUDE_BLUESKY_STORAGE_KEY) === 'true';
}

// 検索ページ(モバイル)の「話題/最新/ユーザー/メディア」タブの選択状態。
// SearchPage.tsx の SEARCH_TABS / SearchTab と同じ値・同じ並び順にしている。
// タブUI自体はSearchPage.tsxからここ(Header)に移設し、SearchPage.tsx側は
// このキー/イベントを監視して自身のTabsコンポーネントの表示を切り替えるだけにする。
type SearchPageTabValue = 'top' | 'latest' | 'users' | 'media';
const SEARCH_PAGE_TABS: Array<{ value: SearchPageTabValue; label: string }> = [
  { value: 'top', label: '話題' },
  { value: 'latest', label: '最新' },
  { value: 'users', label: 'ユーザー' },
  { value: 'media', label: 'メディア' },
];
const SEARCH_PAGE_TAB_STORAGE_KEY = 'lime_search_page_tab';
const SEARCH_PAGE_TAB_CHANGED_EVENT = 'lime-search-page-tab-changed';

// SearchPage.tsx の normalizeStoredSearchTab と同じ読み替え(旧バージョンの 'posts' は '最新' 扱い)。
function normalizeSearchPageTab(value: string | null | undefined): SearchPageTabValue {
  if (value === 'top' || value === 'latest' || value === 'users' || value === 'media') return value;
  if (value === 'posts') return 'latest';
  return 'top';
}

function readStoredSearchPageTab(): SearchPageTabValue {
  if (typeof window === 'undefined') return 'top';
  try {
    return normalizeSearchPageTab(localStorage.getItem(SEARCH_PAGE_TAB_STORAGE_KEY));
  } catch {
    return 'top';
  }
}

function readStoredActiveFeedTab(): FeedTabValue {
  if (typeof window === 'undefined') return 'all';
  const stored = localStorage.getItem(ACTIVE_FEED_TAB_STORAGE_KEY);
  return stored === 'following' ? 'following' : stored === 'trending' ? 'trending' : 'all';
}

// --- 検索サジェスト(モバイル・ヘッダー検索バー用) ---------------------------------
// SearchPage.tsx のPC版サジェスト(検索履歴 + ユーザー候補)と同等のロジックを
// ここに移植する。PC版と同じlocalStorageキー('search:recent')を使うため、
// PC/モバイルどちらで検索しても履歴は共有される。
const kataToHira = (s: string) =>
  s.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

const normalizeForSearch = (s: string) => {
  if (!s) return '';
  let n = s.normalize('NFKC').toLowerCase();
  n = kataToHira(n);
  return n;
};

const SEARCH_HISTORY_KEY = 'search:recent';
const SEARCH_HISTORY_MAX = 8;

function loadSearchHistory(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, SEARCH_HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function saveSearchHistory(list: string[]) {
  try {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(list.slice(0, SEARCH_HISTORY_MAX)));
  } catch {
    // noop
  }
}

// Bluesky側の検索は "@handle" ではなく "handle" 形式のクエリを期待するため、
// 先頭の "@" を取り除いてから渡す
function normalizeBlueskySuggestQuery(query: string) {
  return query.trim().replace(/^@+/, '');
}

// 検索コマンド(from: / -単語 / OR / "フレーズ" / since: など)を除いた「検索語」だけを取り出す。
// SearchPage.tsx の getSearchFreeText(parseSearchQuery)と同じ結果になるようにしてあり、
// モバイルのサジェスト(ユーザー候補・Blueskyユーザー候補)がコマンド入りの入力でも
// PC版と同じように動くようにするためのもの。
const SEARCH_COMMAND_KEYS = new Set([
  'from', 'to', 'since', 'after', 'until', 'before',
  'min_faves', 'min_likes', 'min_retweets', 'min_reposts',
  'max_faves', 'max_likes', 'filter', 'has', 'source',
]);

function getSuggestFreeText(raw: string): string {
  const tokens = raw.trim().match(/-?"[^"]*"?|[^\s\u3000]+/g) ?? [];

  if (tokens.length === 1 && /^@[^\s:"]+$/.test(tokens[0])) return tokens[0];

  const words: string[] = [];
  const fromNames: string[] = [];

  for (const token of tokens) {
    if (token === 'OR') continue;

    const neg = token.length > 1 && token.startsWith('-');
    const body = neg ? token.slice(1) : token;

    if (body.startsWith('"')) {
      const phrase = body.replace(/^"/, '').replace(/"$/, '').trim();
      if (phrase && !neg) words.push(phrase);
      continue;
    }

    const m = body.match(/^([A-Za-z_]+):(.*)$/);
    if (m && SEARCH_COMMAND_KEYS.has(m[1].toLowerCase())) {
      const key = m[1].toLowerCase();
      const value = m[2].trim();
      if (!value) continue;
      if (key === 'to') {
        const name = value.replace(/^@+/, '');
        if (name && !neg) words.push(`@${name}`);
      } else if (key === 'from' && !neg) {
        const name = value.replace(/^@+/, '');
        if (name) fromNames.push(name);
      }
      continue;
    }

    if (neg) continue;
    words.push(body);
  }

  return [...words, ...fromNames].join(' ').trim();
}

type HeaderSuggestionRow =
  | { type: 'search'; value: string }
  | { type: 'user'; value: string; user: User };
// ------------------------------------------------------------------------------------

function normalizeAppPath(pathname: string) {
  const normalized = pathname.replace(/^\/RaimuNoteSNS\.github\.io(?=\/|$)/, '') || '/';
  return normalized === '' ? '/' : normalized;
}

function hasGithubPagesBasePath(pathname: string) {
  return /^\/RaimuNoteSNS\.github\.io(?=\/|$)/.test(pathname);
}

function isProfilePath(pathname: string) {
  return /^\/u\/[^/]+\/?$/.test(normalizeAppPath(pathname));
}

// ポスト詳細ページ(/post/:id)かどうかの判定。モバイルではこのページ専用の
// ヘッダー(戻る・タイトル・もっと見る)をPostDetail.tsx側で表示するため、
// アプリ共通のHeaderは重複表示を避けるためにモバイルでのみ非表示にする。
function isPostDetailPath(pathname: string) {
  return /^\/post\/[^/]+\/?$/.test(normalizeAppPath(pathname));
}

function getBrowserPathname() {
  if (typeof window === 'undefined') {
    return '';
  }

  return window.location.pathname;
}

function isGithubPagesProfilePath(pathname: string) {
  const browserPathname = getBrowserPathname();
  const hasBasePath = hasGithubPagesBasePath(pathname) || hasGithubPagesBasePath(browserPathname);

  if (!hasBasePath) {
    return false;
  }

  return isProfilePath(pathname) || isProfilePath(browserPathname);
}

function isTimelineVisualPath(pathname: string) {
  const normalizedPath = normalizeAppPath(pathname);

  return (
    normalizedPath === '/' ||
    normalizedPath.startsWith('/post/')
  );
}

// 最新/フォロー中/トレンドタブは「タイムライン(ホーム画面)のみ」に表示する。
// isTimelineVisualPath は投稿詳細ページ(/post/...)も含むため、
// タブの表示条件はそれより狭い「ホーム('/')のみ」の専用判定にする。
function isHomeTimelinePath(pathname: string) {
  return normalizeAppPath(pathname) === '/';
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

// Feed.tsx から移設した最新/フォロー中/トレンドタブの選択状態を管理するフック。
// 他タブ(ブラウザの別タブ)やFeed側からの変更もlocalStorage経由で拾う。
function useActiveFeedTab() {
  const [activeFeedTab, setActiveFeedTab] = useState<FeedTabValue>(() => readStoredActiveFeedTab());

  useEffect(() => {
    const syncFromStorage = (event?: StorageEvent) => {
      if (event && event.key !== ACTIVE_FEED_TAB_STORAGE_KEY) return;
      setActiveFeedTab(readStoredActiveFeedTab());
    };

    window.addEventListener('storage', syncFromStorage);

    return () => {
      window.removeEventListener('storage', syncFromStorage);
    };
  }, []);

  const changeActiveFeedTab = (value: FeedTabValue) => {
    setActiveFeedTab(value);
    localStorage.setItem(ACTIVE_FEED_TAB_STORAGE_KEY, value);
    window.dispatchEvent(
      new CustomEvent(ACTIVE_FEED_TAB_CHANGED_EVENT, { detail: { tab: value } })
    );
  };

  return { activeFeedTab, changeActiveFeedTab };
}

// タブごとのスクロール位置を、このHeaderが生きている間だけメモリ上で保持する。
// localStorageは使わないため、ページを再読み込みするとリセットされる。
// タブを切り替えたときは、戻ってきたタブの最後の位置をそのまま復元し、
// 初めて開くタブだけは先頭(0px)から開始する。
function useFeedTabScrollMemory(
  activeFeedTab: FeedTabValue,
  changeActiveFeedTab: (value: FeedTabValue) => void,
) {
  const positionsRef = useRef<Partial<Record<FeedTabValue, number>>>({});
  const activeTabRef = useRef(activeFeedTab);
  const restoreVersionRef = useRef(0);

  activeTabRef.current = activeFeedTab;

  useEffect(() => {
    // 現在開いているタブの初期位置を記録する。
    if (positionsRef.current[activeFeedTab] === undefined) {
      positionsRef.current[activeFeedTab] = window.scrollY;
    }
  }, [activeFeedTab]);

  useEffect(() => {
    const rememberScrollPosition = () => {
      positionsRef.current[activeTabRef.current] = window.scrollY;
    };

    window.addEventListener('scroll', rememberScrollPosition, { passive: true });
    rememberScrollPosition();

    return () => {
      window.removeEventListener('scroll', rememberScrollPosition);
    };
  }, []);

  useEffect(() => {
    const savedPosition = positionsRef.current[activeFeedTab];
    if (savedPosition === undefined) return;

    const version = ++restoreVersionRef.current;
    let frame1: number | null = null;
    let frame2: number | null = null;

    // Feed側のタブ内容更新を1フレーム待ってから復元する。
    // 2フレーム目でもう一度適用し、表示内容の更新とスクロール復元の順序差を吸収する。
    frame1 = window.requestAnimationFrame(() => {
      frame1 = null;
      if (version !== restoreVersionRef.current) return;

      frame2 = window.requestAnimationFrame(() => {
        frame2 = null;
        if (version !== restoreVersionRef.current) return;
        window.scrollTo({ top: savedPosition, behavior: 'auto' });
      });
    });

    return () => {
      if (frame1 !== null) window.cancelAnimationFrame(frame1);
      if (frame2 !== null) window.cancelAnimationFrame(frame2);
    };
  }, [activeFeedTab]);

  const changeActiveFeedTabWithScrollMemory = useCallback(
    (value: FeedTabValue) => {
      if (value === activeTabRef.current) return;

      // 切り替え前の位置を確定保存。
      positionsRef.current[activeTabRef.current] = window.scrollY;

      // まだ一度も開いていないタブはトップから開始。位置0も記憶しておく。
      const hasVisitedTab = positionsRef.current[value] !== undefined;
      if (!hasVisitedTab) {
        positionsRef.current[value] = 0;
      }

      if (typeof document !== 'undefined') {
        const root = document.documentElement;

        // 入口の「ふわっと浮かび上がる」アニメーションは、ページを再読み込みした
        // 直後の最初のタブ表示だけ許可する。いったん別タブへ切り替えた後は、
        // その後どのタブへ戻っても入口アニメーションを再発火させない。
        // この属性はメモリ上だけで、再読み込み時にDOMごと消える。
        root.setAttribute('data-lime-feed-tab-switched', 'true');
        root.dispatchEvent(
          new CustomEvent('lime-feed-tab-change-animation', {
            detail: { tab: value, returning: hasVisitedTab },
          })
        );
      }

      changeActiveFeedTab(value);
      return positionsRef.current[value] ?? 0;
    },
    [changeActiveFeedTab],
  );

  return { changeActiveFeedTabWithScrollMemory };
}

// モバイルのタイムラインを左右にスワイプしたとき、Twitter/Xのように
// 「最新 → フォロー中 → トレンド」を前後へ切り替える。
// 縦スクロール・ボタン操作・横スクロール対応UIとは競合しないよう、
// 横方向が十分優勢になったときだけジェスチャーを確定する。
function useMobileFeedTabSwipe(
  enabled: boolean,
  disabled: boolean,
  activeFeedTab: FeedTabValue,
  changeActiveFeedTab: (value: FeedTabValue) => void,
) {
  const gestureRef = useRef({
    active: false,
    horizontal: false,
    startedAtX: 0,
    startedAtY: 0,
  });

  useEffect(() => {
    if (typeof document === 'undefined' || !enabled || disabled) return;

    const resetGesture = () => {
      gestureRef.current = {
        active: false,
        horizontal: false,
        startedAtX: 0,
        startedAtY: 0,
      };
    };

    const isInteractiveTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      return Boolean(
        target.closest(
          'button, a, input, textarea, select, option, [role="button"], [data-radix-collection-item], [data-lime-mobile-sidebar="true"]'
        )
      );
    };

    const isInsideHorizontalScroller = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;

      let el: Element | null = target;
      while (el && el !== document.body) {
        if (el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1) {
          const style = window.getComputedStyle(el);
          if (style.overflowX === 'auto' || style.overflowX === 'scroll') return true;
        }
        el = el.parentElement;
      }
      return false;
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || isInteractiveTarget(event.target)) {
        resetGesture();
        return;
      }

      if (isInsideHorizontalScroller(event.target)) {
        resetGesture();
        return;
      }

      const touch = event.touches[0];
      const FEED_EDGE_ZONE = 32;
      // 画面端からのスワイプはサイドバー用に予約する。
      if (touch.clientX <= FEED_EDGE_ZONE) {
        resetGesture();
        return;
      }

      gestureRef.current = {
        active: true,
        horizontal: false,
        startedAtX: touch.clientX,
        startedAtY: touch.clientY,
      };
    };

    const handleTouchMove = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      if (!gesture.active || event.touches.length !== 1) return;

      const touch = event.touches[0];
      const dx = touch.clientX - gesture.startedAtX;
      const dy = touch.clientY - gesture.startedAtY;

      if (!gesture.horizontal) {
        const directionThreshold = 12;
        const horizontalDominanceRatio = 1.35;

        if (Math.abs(dx) < directionThreshold && Math.abs(dy) < directionThreshold) return;

        if (Math.abs(dy) * horizontalDominanceRatio >= Math.abs(dx)) {
          resetGesture();
          return;
        }

        gesture.horizontal = true;
      }

      // 水平スワイプ中はブラウザの横方向スクロール/戻るジェスチャーを止める。
      if (event.cancelable) event.preventDefault();
    };

    const handleTouchEnd = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      if (!gesture.active || !gesture.horizontal || event.changedTouches.length !== 1) {
        resetGesture();
        return;
      }

      const touch = event.changedTouches[0];
      const dx = touch.clientX - gesture.startedAtX;
      const dy = touch.clientY - gesture.startedAtY;
      const SWIPE_THRESHOLD = 56;

      resetGesture();

      if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy) * 1.25) return;

      const currentIndex = FEED_TABS.findIndex((tab) => tab.value === activeFeedTab);
      if (currentIndex < 0) return;

      // 左スワイプ → 次のタブ、右スワイプ → 前のタブ。
      const nextIndex = dx < 0 ? currentIndex + 1 : currentIndex - 1;
      if (nextIndex < 0 || nextIndex >= FEED_TABS.length) return;

      changeActiveFeedTab(FEED_TABS[nextIndex].value);
    };

    const handleTouchCancel = () => resetGesture();

    document.addEventListener('touchstart', handleTouchStart, { passive: true, capture: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true, capture: true });
    document.addEventListener('touchcancel', handleTouchCancel, { passive: true, capture: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart, true);
      document.removeEventListener('touchmove', handleTouchMove, true);
      document.removeEventListener('touchend', handleTouchEnd, true);
      document.removeEventListener('touchcancel', handleTouchCancel, true);
    };
  }, [enabled, disabled]);
}

// タブ文字列の実測幅(px)を計測し、下線の幅を文字数に応じて伸縮させるためのフック。
// ref経由でDOM上のラベル<span>の offsetWidth を読み取るだけなので、フォントや
// 文字種(かな/カナ/英数字混在)が変わっても実際の見た目通りの幅になる。
// Macのトラックパッド等の横スクロール(wheel)でも、モバイルのタッチスワイプと同じように
// タイムラインのタブを切り替える。Safari/Chromeではトラックパッドの2本指横スクロールが
// WheelEvent の deltaX として届くため、それを「1ジェスチャー=1タブ切り替え」にまとめる。
function useFeedTabWheelSwipe(
  enabled: boolean,
  disabled: boolean,
  activeFeedTab: FeedTabValue,
  changeActiveFeedTab: (value: FeedTabValue) => void,
) {
  const wheelRef = useRef({
    accumulatedX: 0,
    triggered: false,
    resetTimer: null as number | null,
    lastDirection: 0,
  });
  const activeFeedTabRef = useRef(activeFeedTab);
  const changeActiveFeedTabRef = useRef(changeActiveFeedTab);
  activeFeedTabRef.current = activeFeedTab;
  changeActiveFeedTabRef.current = changeActiveFeedTab;

  useEffect(() => {
    if (typeof window === 'undefined' || !enabled || disabled) return;

    const resetGesture = () => {
      const state = wheelRef.current;
      state.accumulatedX = 0;
      state.triggered = false;
      state.lastDirection = 0;
      if (state.resetTimer !== null) {
        window.clearTimeout(state.resetTimer);
        state.resetTimer = null;
      }
    };

    const isInteractiveTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      return Boolean(
        target.closest(
          'button, a, input, textarea, select, option, [role="button"], [data-radix-collection-item], [data-lime-mobile-sidebar="true"]'
        )
      );
    };

    const isInsideHorizontalScroller = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;

      let el: Element | null = target;
      while (el && el !== document.body) {
        if (el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1) {
          const style = window.getComputedStyle(el);
          if (style.overflowX === 'auto' || style.overflowX === 'scroll') return true;
        }
        el = el.parentElement;
      }
      return false;
    };

    const normalizeDeltaX = (event: WheelEvent) => {
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaX * 16;
      if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaX * window.innerWidth;
      return event.deltaX;
    };

    const handleWheel = (event: WheelEvent) => {
      if (disabled || !enabled) return;
      if (isInteractiveTarget(event.target)) return;
      if (isInsideHorizontalScroller(event.target)) return;

      const deltaX = normalizeDeltaX(event);
      const deltaY = event.deltaY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      // Macトラックパッドの横フリックを検出。通常の縦スクロールや、
      // ほぼ同量の斜めスクロールでは反応させない。
      if (absX < 4 || absX <= absY * 1.25) return;

      const direction = deltaX < 0 ? -1 : 1;
      const state = wheelRef.current;

      // 同じジェスチャー中に発生する大量の慣性スクロール(deltaX)で、
      // タブが連続して複数枚切り替わらないよう1回だけ確定する。
      if (state.lastDirection !== 0 && state.lastDirection !== direction) {
        state.accumulatedX = 0;
        state.triggered = false;
      }
      state.lastDirection = direction;
      state.accumulatedX += deltaX;

      if (state.resetTimer !== null) window.clearTimeout(state.resetTimer);
      state.resetTimer = window.setTimeout(resetGesture, 180);

      const WHEEL_SWIPE_THRESHOLD = 72;
      if (state.triggered || Math.abs(state.accumulatedX) < WHEEL_SWIPE_THRESHOLD) return;

      state.triggered = true;

      const currentIndex = FEED_TABS.findIndex((tab) => tab.value === activeFeedTabRef.current);
      if (currentIndex < 0) return;

      const nextIndex = direction > 0 ? currentIndex + 1 : currentIndex - 1;
      if (nextIndex < 0 || nextIndex >= FEED_TABS.length) return;

      // Macトラックパッドの自然な横スワイプ方向に合わせて反転。
      // 左スワイプ → 次のタブ、右スワイプ → 前のタブ。
      // 横方向のページスクロールはタブ切り替えとして消費する。
      if (event.cancelable) event.preventDefault();
      changeActiveFeedTabRef.current(FEED_TABS[nextIndex].value);
    };

    window.addEventListener('wheel', handleWheel, { passive: false, capture: true });

    return () => {
      window.removeEventListener('wheel', handleWheel, true);
      const state = wheelRef.current;
      if (state.resetTimer !== null) {
        window.clearTimeout(state.resetTimer);
        state.resetTimer = null;
      }
    };
  }, [enabled, disabled, activeFeedTab, changeActiveFeedTab]);
}

function useFeedTabUnderlineWidths() {
  const labelRefs = useRef<Partial<Record<FeedTabValue, HTMLSpanElement | null>>>({});
  const [widths, setWidths] = useState<Partial<Record<FeedTabValue, number>>>({});

  const registerLabelRef = (value: FeedTabValue) => (el: HTMLSpanElement | null) => {
    labelRefs.current[value] = el;
  };

  useLayoutEffect(() => {
    const measure = () => {
      setWidths((prev) => {
        let changed = false;
        const next = { ...prev };

        FEED_TABS.forEach((tab) => {
          const el = labelRefs.current[tab.value];
          const measuredWidth = el?.offsetWidth ?? 0;

          if (measuredWidth > 0 && prev[tab.value] !== measuredWidth) {
            next[tab.value] = measuredWidth;
            changed = true;
          }
        });

        return changed ? next : prev;
      });
    };

    measure();

    window.addEventListener('resize', measure);

    // フォント読み込み完了後に再計測(初回はフォールバック幅で描画されるため)。
    let cancelled = false;
    if ('fonts' in document) {
      document.fonts.ready.then(() => {
        if (!cancelled) measure();
      });
    }

    return () => {
      cancelled = true;
      window.removeEventListener('resize', measure);
    };
  }, []);

  return { registerLabelRef, widths };
}

// ヘッダー全体をスクロール方向で開閉する(モバイルのみ・ホーム画面のみで有効化される)。
// - ページ上部から HIDE_AFTER px 以内は常に表示する(閉じない)。
// - それより下にいるときは、まとまった量(DIRECTION_THRESHOLD px)下スクロールしたら隠す、
//   逆に上スクロールしたら再表示する。
// この「遊び」を持たせることで、少しスクロールしただけで即座に閉じてしまう
// (＝早すぎる開閉)のを防いでいる。
function useMobileHeaderVisibility(enabled: boolean, disabled: boolean = false) {
  const [isHidden, setIsHidden] = useState(false);

  useEffect(() => {
    if (!enabled || disabled) {
      setIsHidden(false);
      return;
    }

    const HIDE_AFTER = 96;
    const DIRECTION_THRESHOLD = 12;

    let lastScrollY = window.scrollY;
    let rafId: number | null = null;

    const update = () => {
      rafId = null;
      const currentScrollY = window.scrollY;
      const delta = currentScrollY - lastScrollY;

      if (currentScrollY <= HIDE_AFTER) {
        setIsHidden(false);
      } else if (delta > DIRECTION_THRESHOLD) {
        setIsHidden(true);
      } else if (delta < -DIRECTION_THRESHOLD) {
        setIsHidden(false);
      }

      lastScrollY = currentScrollY;
    };

    const handleScroll = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(update);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener('scroll', handleScroll);
    };
  }, [enabled, disabled]);

  return isHidden;
}

// サイドバー(aside)本体を data 属性で参照するためのセレクタ。
// aside は createPortal で document.body 直下に置かれているため、
// React の state 更新(1フレーム遅れる)を待たずに、ドラッグ中でも
// 直接 DOM を触って追従表示させるためにこれで探す。
const MOBILE_SIDEBAR_SELECTOR = '[data-lime-mobile-sidebar="true"]';

// rootを直接transformして動かすと、環境によっては(overflow/clip-pathをrootと
// 同じ要素に同時指定した場合の描画上の都合などで)角丸クリップが実際の描画に
// 反映されないことがある。そこで、「動かす」要素と「角丸にクリップする」要素を
// 分離した二重ラッパー構造にする。
//   body > moveWrapper(transform: translateXのみ) > clipWrapper(border-radius +
//   overflow:hiddenのみ、transformなし) > #root
// clipWrapper自身はtransformを持たないが、transformを持つ祖先(moveWrapper)の
// 内側にいるため、見た目上はmoveWrapperと一緒に動く。したがって角丸の位置は
// 常に実際の露出境界(サイドバーとの境目)に追従しつつ、「transform」と
// 「overflow/border-radius」が同一要素に同時指定される状況そのものは発生しない。
const ROOT_MOVE_WRAPPER_ATTR = 'data-lime-root-move-wrapper';
const ROOT_CLIP_WRAPPER_ATTR = 'data-lime-root-clip-wrapper';

function ensureRootShiftWrappers(
  root: HTMLElement
): { moveWrapper: HTMLElement; clipWrapper: HTMLElement } | null {
  const existingClipWrapper = root.parentElement;
  const existingMoveWrapper = existingClipWrapper?.parentElement ?? null;

  if (
    existingClipWrapper?.getAttribute(ROOT_CLIP_WRAPPER_ATTR) === 'true' &&
    existingMoveWrapper?.getAttribute(ROOT_MOVE_WRAPPER_ATTR) === 'true'
  ) {
    return { moveWrapper: existingMoveWrapper, clipWrapper: existingClipWrapper };
  }

  const parent = root.parentNode;
  if (!parent) return null;

  const moveWrapper = document.createElement('div');
  moveWrapper.setAttribute(ROOT_MOVE_WRAPPER_ATTR, 'true');
  // #root の "html, body, #root { height: 100% }" のような高さの連鎖を
  // 壊さないよう、ラッパー自体は見た目に影響しないサイズ指定だけ行う。
  moveWrapper.style.width = '100%';
  moveWrapper.style.height = '100%';
  moveWrapper.style.minHeight = '100%';

  const clipWrapper = document.createElement('div');
  clipWrapper.setAttribute(ROOT_CLIP_WRAPPER_ATTR, 'true');
  clipWrapper.style.width = '100%';
  clipWrapper.style.height = '100%';
  clipWrapper.style.minHeight = '100%';

  parent.insertBefore(moveWrapper, root);
  moveWrapper.appendChild(clipWrapper);
  clipWrapper.appendChild(root);

  return { moveWrapper, clipWrapper };
}

function useMobileDrawerMotion(
  isOpen: boolean,
  onOpenChange: (open: boolean) => void,
  // 画面端以外(本文のどこか)からの右スワイプでも開いてよいか。
  // ホームの「最新」タブ以外では、左右スワイプはタブ切り替えに使うので false にする。
  openFromBody: boolean,
) {
  const rootRef = useRef<HTMLElement | null>(null);
  // 「動かす」ラッパーと「角丸にクリップする」ラッパーへの参照。
  const moveWrapperRef = useRef<HTMLElement | null>(null);
  const clipWrapperRef = useRef<HTMLElement | null>(null);
  const gestureRef = useRef({
    active: false,
    startedAtX: 0,
    startedAtY: 0,
    startShift: 0,
    horizontal: false,
    startedAtEdge: false,
    // フリック速度の判定用。
    startedAtTime: 0,
  });
  // ドラッグ開始時点のスクロール位置。ドラッグでサイドバーを開いた場合でも
  // 閉じたときに元の位置へ戻せるよう保持しておく。
  const scrollLockYRef = useRef(0);
  // サイドバーDOM要素のキャッシュ。touchmoveの度にquerySelectorし直すと
  // (頻度が高いイベントのため)無駄なDOM探索コストがかかり体感の遅延に
  // つながるので、一度見つけたら使い回す。
  const sidebarElRef = useRef<HTMLElement | null>(null);
  // touchmoveをrequestAnimationFrameでまとめて反映するためのバッファ。
  // touchmoveは1フレームに何度も発火し得るため、都度同期的にスタイルを
  // 書き換えるとレイアウト処理が詰まって「ワンテンポ遅れる」体感になる。
  const pendingShiftRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const getDrawerWidth = () => {
    if (typeof window === 'undefined') return 0;
    // サイドバー自体の表示幅を従来より広く確保する(全画面にはしない)。
    return Math.min(Math.max(window.innerWidth * 0.78, 300), 420);
  };

  const getSidebarEl = () => {
    if (sidebarElRef.current && document.body.contains(sidebarElRef.current)) {
      return sidebarElRef.current;
    }
    const el = document.querySelector(MOBILE_SIDEBAR_SELECTOR);
    sidebarElRef.current = el instanceof HTMLElement ? el : null;
    return sidebarElRef.current;
  };

  const cancelScheduledVisualUpdate = () => {
    if (rafIdRef.current !== null) {
      window.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pendingShiftRef.current = null;
  };

  const setRootVisual = (shift: number, animate: boolean) => {
    const root = rootRef.current;
    if (!(root instanceof HTMLElement)) return;

    const moveWrapper = moveWrapperRef.current;
    const clipWrapper = clipWrapperRef.current;

    const width = getDrawerWidth();
    const clamped = Math.max(0, Math.min(width, shift));
    const isRevealed = clamped > 0;

    // 「動かす」のはmoveWrapper。clipWrapperはmoveWrapperの子なので、
    // 自身はtransformを持たなくても見た目上は一緒に動く。これにより、
    // 角丸の位置は常に実際の露出境界に追従しつつ、transformとoverflow/
    // border-radiusが同一要素に同時指定される状況を避けられる。
    if (moveWrapper) {
      moveWrapper.style.transition = animate
        ? 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)'
        : 'none';
      moveWrapper.style.transform = `translateX(${clamped}px)`;
      // will-change: transform は独立した合成レイヤーへの昇格を促し、
      // ブラウザによってはこの合成レイヤー化がクリップ表現(角丸)と
      // 干渉することがあるため、明示的なwill-changeの指定はしない。
      moveWrapper.style.willChange = 'auto';
      // サイドバーを開いている間はタイムライン側の縦スクロールを停止する。
      // touch-action:none はクリック/タップ自体は維持しつつ、スクロールジェスチャーだけを止める。
      moveWrapper.style.touchAction = isRevealed ? 'none' : 'auto';
      moveWrapper.style.overscrollBehavior = isRevealed ? 'none' : 'auto';
    }

    // root自身は過去のバージョンで直接スタイルを付けていたことがあるので、
    // 念のため毎回掃除しておく(移動・クリップの責務は上の2要素に一本化する)。
    root.style.removeProperty('transform');
    root.style.removeProperty('transition');
    root.style.removeProperty('will-change');
    root.style.removeProperty('touch-action');
    root.style.removeProperty('overscroll-behavior');
    root.style.removeProperty('border-radius');
    root.style.removeProperty('overflow');
    root.style.removeProperty('clip-path');
    root.style.removeProperty('-webkit-clip-path');
    root.style.removeProperty('box-shadow');

    // 角丸のクリップと影は、transformを持たないclipWrapper側で行う。
    if (clipWrapper) {
      clipWrapper.style.transition = animate
        ? 'border-radius 320ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 320ms cubic-bezier(0.22, 1, 0.36, 1)'
        : 'none';
      clipWrapper.style.borderRadius = isRevealed ? '42px 0 0 42px' : '0px';
      // overflow:hidden にすると、スクロール位置が下にあるとき
      // sticky のヘッダーまで祖先要素のクリップ領域に閉じ込められて
      // タイムラインのタブが画面外へ消える。境界の横あふれは html の
      // overflow-x:hidden で抑え、ここでは overflow を visible のままにする。
      clipWrapper.style.overflow = 'visible';
      clipWrapper.style.boxShadow = isRevealed ? '-10px 0 28px rgba(0,0,0,0.34)' : 'none';
    }

    // Body直下へportalされるBottomNavも同じ距離だけ右へ追従させる。
    // root自体にz-index/isolationを付けないことで、BottomNavのクリックを遮断しない。
    document.documentElement.style.setProperty(
      '--lime-mobile-drawer-shift',
      `${clamped}px`,
    );
    document.documentElement.style.setProperty(
      '--lime-mobile-drawer-transition',
      animate
        ? 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)'
        : 'none',
    );

    // aside(サイドバー本体)もReactのstate更新を待たずに直接見た目を追従させる。
    // これをしないと、ドラッグ中は state(isOpen) がまだ false のままなので
    // React側のvisibility/pointer-eventsが更新されず、指を動かしても
    // 「何も見えないまま」になってしまう。
    const sidebar = getSidebarEl();
    if (sidebar) {
      sidebar.style.visibility = isRevealed ? 'visible' : 'hidden';
      sidebar.style.pointerEvents = isRevealed ? 'auto' : 'none';
    }
  };

  // touchmove中の見た目の更新はrequestAnimationFrameで1フレームに1回だけ
  // まとめて行う。指を動かすたびに同期でDOMを書き換えるより滑らかで、
  // 「反応が一拍遅れる」体感を減らせる。
  const scheduleVisualUpdate = (shift: number) => {
    pendingShiftRef.current = shift;
    if (rafIdRef.current !== null) return;

    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = null;
      if (pendingShiftRef.current !== null) {
        setRootVisual(pendingShiftRef.current, false);
        pendingShiftRef.current = null;
      }
    });
  };

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const root = document.getElementById('root') ?? document.body.firstElementChild;
    if (!(root instanceof HTMLElement)) return;
    rootRef.current = root;

    const isMobile = window.matchMedia('(max-width: 639px)').matches;
    const html = document.documentElement;
    const previousOverflowX = html.style.overflowX;

    if (isMobile) {
      const wrappers = ensureRootShiftWrappers(root);
      moveWrapperRef.current = wrappers?.moveWrapper ?? null;
      clipWrapperRef.current = wrappers?.clipWrapper ?? null;
      html.style.overflowX = 'hidden';
      setRootVisual(isOpen ? getDrawerWidth() : 0, true);
    } else {
      root.style.removeProperty('transform');
      root.style.removeProperty('transition');
      root.style.removeProperty('will-change');
      root.style.removeProperty('touch-action');
      root.style.removeProperty('overscroll-behavior');
      root.style.removeProperty('border-radius');
      root.style.removeProperty('overflow');
      root.style.removeProperty('clip-path');
      root.style.removeProperty('-webkit-clip-path');
      root.style.removeProperty('box-shadow');

      const moveWrapper = moveWrapperRef.current;
      if (moveWrapper) {
        moveWrapper.style.removeProperty('transform');
        moveWrapper.style.removeProperty('transition');
        moveWrapper.style.removeProperty('will-change');
        moveWrapper.style.removeProperty('touch-action');
        moveWrapper.style.removeProperty('overscroll-behavior');
      }

      const clipWrapper = clipWrapperRef.current;
      if (clipWrapper) {
        clipWrapper.style.removeProperty('border-radius');
        clipWrapper.style.removeProperty('overflow');
        clipWrapper.style.removeProperty('box-shadow');
        clipWrapper.style.removeProperty('transition');
      }

      document.documentElement.style.removeProperty('--lime-mobile-drawer-shift');
      document.documentElement.style.removeProperty('--lime-mobile-drawer-transition');
      html.style.overflowX = previousOverflowX;
    }

    return () => {
      html.style.overflowX = previousOverflowX;
      document.documentElement.style.removeProperty('--lime-mobile-drawer-shift');
      document.documentElement.style.removeProperty('--lime-mobile-drawer-transition');
      root.style.removeProperty('transform');
      root.style.removeProperty('transition');
      root.style.removeProperty('will-change');
      root.style.removeProperty('touch-action');
      root.style.removeProperty('overscroll-behavior');
      root.style.removeProperty('border-radius');
      root.style.removeProperty('overflow');
      root.style.removeProperty('clip-path');
      root.style.removeProperty('-webkit-clip-path');
      root.style.removeProperty('box-shadow');

      const moveWrapper = moveWrapperRef.current;
      if (moveWrapper) {
        moveWrapper.style.removeProperty('transform');
        moveWrapper.style.removeProperty('transition');
        moveWrapper.style.removeProperty('will-change');
        moveWrapper.style.removeProperty('touch-action');
        moveWrapper.style.removeProperty('overscroll-behavior');
      }

      const clipWrapper = clipWrapperRef.current;
      if (clipWrapper) {
        clipWrapper.style.removeProperty('border-radius');
        clipWrapper.style.removeProperty('overflow');
        clipWrapper.style.removeProperty('box-shadow');
        clipWrapper.style.removeProperty('transition');
      }
    };
  }, [isOpen]);

  // サイドバーが開いている間、背後のタイムラインを指で縦スクロールできないようにする。
  // body を position:fixed にすると、現在の scrollY が body の top に吸収されて
  // sticky ヘッダーまで通常のスクロール位置に戻ってしまい、下までスクロールした状態で
  // サイドバーを開いた瞬間に「最新/フォロー中/トレンド」タブが消える原因になる。
  // そこで body のスクロール座標はそのまま維持し、メイン領域への touchmove だけを
  // preventDefault してロックする。サイドバー内部の nav は通常通りスクロール可能にする。
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!window.matchMedia('(max-width: 639px)').matches) return;
    if (!isOpen) return;

    const handleTouchMove = (event: TouchEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(MOBILE_SIDEBAR_SELECTOR)) {
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true });

    return () => {
      document.removeEventListener('touchmove', handleTouchMove, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const root = rootRef.current;
    if (!(root instanceof HTMLElement)) return;

    const isMobile = () => window.matchMedia('(max-width: 639px)').matches;
    const resetGesture = () => {
      gestureRef.current = {
        active: false,
        startedAtX: 0,
        startedAtY: 0,
        startShift: 0,
        horizontal: false,
        startedAtEdge: false,
        startedAtTime: 0,
      };
    };

    // 「画面端」とみなす範囲。従来の32pxは狭くて掴みにくかったため少し広げた。
    // この範囲から始めた場合は、少しの移動量で反応する軽いジェスチャーとして扱う。
    const EDGE_ZONE = 40;
    // タップとみなす指のブレ許容量(px)。
    const TAP_SLOP = 10;

    // ドロワー操作の開始をそもそも許可しない要素。
    // 以前は button / a も全部除外していたため、
    //  - 開いているサイドバーは項目(button)だらけで、ドラッグして閉じられない
    //  - 投稿カード(リンク/ボタン)の上から始めると開けない
    // という問題があった。button/a は「横に動いて方向が確定するまで」は何も奪わないので、
    // 開始を許可して問題ない(縦スクロール・タップ・クリックはそのまま通る)。
    // BottomNavはbody直下のportalなので、ここでtouchmoveを奪わない。
    const BLOCKED_START_SELECTOR =
      'input, textarea, select, [role="slider"], nav[data-lime-bottom-nav-root="true"]';

    // 対象要素(またはその祖先)が横スクロール可能なコンテナかどうかを調べる。
    // 画像ギャラリーなど、要素自体が横スワイプを必要とするUIの内部では、
    // ドロワー用のジェスチャーとして横方向の動きを奪わないようにするため。
    const isInsideHorizontalScroller = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;

      let el: Element | null = target;
      while (el && el !== document.body) {
        if (el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1) {
          const style = window.getComputedStyle(el);
          if (style.overflowX === 'auto' || style.overflowX === 'scroll') {
            return true;
          }
        }
        el = el.parentElement;
      }

      return false;
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (!isMobile()) return;

      if (event.touches.length !== 1) {
        resetGesture();
        return;
      }

      const target = event.target;
      if (target instanceof Element && target.closest(BLOCKED_START_SELECTOR)) {
        resetGesture();
        return;
      }

      // 開いている間は、サイドバー内・右側の本文(=オーバーレイ)のどこからでも
      // 閉じるドラッグ/タップを受け付ける。(以前は clientX <= width の範囲だけで、
      // 本文側から左へスワイプして閉じる自然な操作が一切効かなかった)
      // 閉じている間だけ、横スクロールUI(画像ギャラリー等)の内部からは開始しない。
      if (!isOpen && isInsideHorizontalScroller(target)) {
        resetGesture();
        return;
      }

      const touch = event.touches[0];
      const width = getDrawerWidth();
      const startedAtEdge = touch.clientX <= EDGE_ZONE;

      // 閉じているとき:画面端からは常に開始可。
      // 本文の途中からは openFromBody が true のページ(ホームの「最新」タブ、
      // およびタブスワイプを使わないページ)だけ開始可。
      if (!isOpen && !startedAtEdge && !openFromBody) {
        resetGesture();
        return;
      }

      gestureRef.current = {
        active: true,
        startedAtX: touch.clientX,
        startedAtY: touch.clientY,
        startShift: isOpen ? width : 0,
        horizontal: false,
        startedAtEdge,
        startedAtTime: Date.now(),
      };
      if (moveWrapperRef.current) {
        moveWrapperRef.current.style.transition = 'none';
      }
    };

    const handleTouchMove = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      if (!gesture.active || event.touches.length === 0) return;

      const touch = event.touches[0];
      const dx = touch.clientX - gesture.startedAtX;
      const dy = touch.clientY - gesture.startedAtY;

      if (!gesture.horizontal) {
        // 方向を確定させるまでの「遊び」。
        // 画面端(またはサイドバーを閉じる操作)から始めた場合は軽い動きで反応させる。
        // 本文から開く場合は縦スクロールとの誤判定を避けるため少しだけ厳しくするが、
        // 以前(18px / 縦横比2.2)ほど厳しくはしない。
        const isLenient = gesture.startedAtEdge || isOpen;
        const DIRECTION_LOCK_THRESHOLD = isLenient ? 6 : 12;
        const HORIZONTAL_DOMINANCE_RATIO = isLenient ? 1 : 1.6;

        if (Math.abs(dx) < DIRECTION_LOCK_THRESHOLD && Math.abs(dy) < DIRECTION_LOCK_THRESHOLD) {
          return;
        }

        if (Math.abs(dy) * HORIZONTAL_DOMINANCE_RATIO >= Math.abs(dx)) {
          // 縦方向の動き(または横方向が十分優勢でない動き)だと判定。
          // この時点ではまだroot側の見た目を一切変更していないので、
          // 巻き戻すアニメーションは不要(通常の縦スクロールとして
          // 素直にブラウザへ委ねる)。
          resetGesture();
          return;
        }

        // 閉じている状態での「左スワイプ」は開く操作ではない。
        // (タブ切り替えや他のUIに任せ、誤ってドロワーが反応しないようにする)
        if (!isOpen && dx < 0) {
          resetGesture();
          return;
        }

        gesture.horizontal = true;
      }

      // 横方向のドラッグだと判定した最初のtouchmoveの時点で明示的に
      // preventDefaultする。これを早く行うほど、Safari等の「画面端
      // スワイプで戻る」システムジェスチャーがこのタッチ列を先に
      // 奪ってしまう(その結果スワイプが反応しない)のを防ぎやすい。
      if (event.cancelable) {
        event.preventDefault();
      }

      const width = getDrawerWidth();
      const nextShift = Math.max(0, Math.min(width, gesture.startShift + dx));
      scheduleVisualUpdate(nextShift);
    };

    const handleTouchEnd = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      if (!gesture.active || event.changedTouches.length === 0) return;

      const touch = event.changedTouches[0];
      const width = getDrawerWidth();
      const deltaX = touch.clientX - gesture.startedAtX;
      const deltaY = touch.clientY - gesture.startedAtY;
      const elapsed = Math.max(1, Date.now() - gesture.startedAtTime);
      const startX = gesture.startedAtX;
      const startedAtEdge = gesture.startedAtEdge;

      cancelScheduledVisualUpdate();

      // 横ドラッグにならなかった場合
      if (!gesture.horizontal) {
        const wasTap = Math.abs(deltaX) <= TAP_SLOP && Math.abs(deltaY) <= TAP_SLOP;
        resetGesture();

        // 開いている状態で、右側の本文(サイドバーの外)をタップしたら閉じる。
        if (isOpen && wasTap && startX > width) {
          onOpenChange(false);
          return;
        }

        setRootVisual(isOpen ? width : 0, true);
        return;
      }

      const currentShift = Math.max(0, Math.min(width, gesture.startShift + deltaX));
      // px/ms。負なら左向き、正なら右向き。
      const velocity = deltaX / elapsed;

      let nextOpen: boolean;
      if (isOpen) {
        // 閉じる:ある程度左へ動かした、素早く左へはじいた、または半分以上戻した。
        // (以前は「deltaX > -34」という逆向きの条件が入っていて、閉じにくかった)
        nextOpen = !(deltaX < -40 || velocity < -0.4 || currentShift < width * 0.6);
      } else {
        // 開く:一定以上引き出した、または素早く右へはじいた。
        const openRatio = startedAtEdge ? 0.3 : 0.38;
        nextOpen = currentShift >= width * openRatio || (deltaX > 40 && velocity > 0.45);
      }

      resetGesture();
      setRootVisual(nextOpen ? width : 0, true);
      onOpenChange(nextOpen);
    };

    const handleTouchCancel = () => {
      cancelScheduledVisualUpdate();
      resetGesture();
      setRootVisual(isOpen ? getDrawerWidth() : 0, true);
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true, capture: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true, capture: true });
    document.addEventListener('touchcancel', handleTouchCancel, { passive: true, capture: true });

    return () => {
      cancelScheduledVisualUpdate();
      document.removeEventListener('touchstart', handleTouchStart, true);
      document.removeEventListener('touchmove', handleTouchMove, true);
      document.removeEventListener('touchend', handleTouchEnd, true);
      document.removeEventListener('touchcancel', handleTouchCancel, true);
    };
  }, [isOpen, onOpenChange, openFromBody]);
}

export const Header = ({ desktopLayout = false, desktopSidebarContainer = null }: {
  desktopLayout?: boolean;
  desktopSidebarContainer?: HTMLElement | null;
} = {}) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const timelineChrome = useTimelineChrome(location.pathname);
  const { activeFeedTab, changeActiveFeedTab } = useActiveFeedTab();
  const { changeActiveFeedTabWithScrollMemory } = useFeedTabScrollMemory(
    activeFeedTab,
    changeActiveFeedTab,
  );
  const { registerLabelRef: registerFeedTabLabelRef, widths: feedTabUnderlineWidths } = useFeedTabUnderlineWidths();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isFeedTabChanging, setIsFeedTabChanging] = useState(false);
  const feedTabChangingTimerRef = useRef<number | null>(null);
  const feedTabViewTransitionRef = useRef<FeedTabViewTransition | null>(null);
  // タブ切替アニメーション(View Transition)の実行中に、ページ全体(root)の
  // 古い/新しいスナップショットの縦幅が食い違うと、アニメーション中に画面上部が
  // 真っ白に見えたり一部の要素が欠けて見えたりする原因になる(投稿数の違いで
  // タブごとにページの高さが変わるため)。これを避けるため、アニメーションが
  // 終わるまでの間だけ document の高さを一時的に固定しておくための状態。
  const maxDocumentHeightRef = useRef(0);
  const heightLockRef = useRef<{ previousMinHeight: string; version: number } | null>(null);
  const heightLockVersionRef = useRef(0);
  const feedTabClickRef = useRef<{ value: FeedTabValue | null; switchedOnFirstClick: boolean; at: number }>({
    value: null,
    switchedOnFirstClick: false,
    at: 0,
  });
  const isHomeTimeline = isHomeTimelinePath(location.pathname);

  // documentの高さを一時的に固定/解除するためのヘルパー。
  // ロック中に別のロックが開始された場合、古い方の解除が新しい方の固定値を
  // 誤って巻き戻さないよう、バージョン番号で「自分が最後に張ったロックか」を確認する。
  const lockDocumentHeightForTransition = () => {
    if (typeof document === 'undefined') return null;

    const root = document.documentElement;
    maxDocumentHeightRef.current = Math.max(maxDocumentHeightRef.current, root.scrollHeight);
    const version = ++heightLockVersionRef.current;

    if (!heightLockRef.current) {
      heightLockRef.current = { previousMinHeight: root.style.minHeight, version };
    } else {
      heightLockRef.current.version = version;
    }

    root.style.minHeight = `${maxDocumentHeightRef.current}px`;
    return version;
  };

  const unlockDocumentHeightForTransition = (version: number | null) => {
    if (typeof document === 'undefined' || version === null) return;
    // 既により新しいロックが開始されている場合は、古い方の解除で
    // 新しいロックの固定値を誤って巻き戻してしまわないよう何もしない。
    if (!heightLockRef.current || heightLockRef.current.version !== version) return;

    document.documentElement.style.minHeight = heightLockRef.current.previousMinHeight;
    heightLockRef.current = null;
    maxDocumentHeightRef.current = Math.max(
      maxDocumentHeightRef.current,
      document.documentElement.scrollHeight
    );
  };

  // タブ切り替え中はモバイルのヘッダーを開いたままにして、sticky + backdrop-filter と
  // View Transition のスナップショット合成が競合しないようにする。
  const changeFeedTabWithAnimation = useCallback((value: FeedTabValue) => {
    if (value === activeFeedTab) return;

    const isMobileViewport =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(max-width: 639px)').matches ?? window.innerWidth < 640);
    const reducedMotion =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    const viewTransitionDocument =
      typeof document !== 'undefined' ? (document as FeedTabViewTransitionDocument) : null;

    // PC版は既存のstate/scroll-memory経路だけを通す。今回のリッチな遷移はモバイル限定。
    if (!isMobileViewport || reducedMotion || !viewTransitionDocument?.startViewTransition) {
      changeActiveFeedTabWithScrollMemory(value);
      return;
    }

    setIsFeedTabChanging(true);
    if (feedTabChangingTimerRef.current !== null) {
      window.clearTimeout(feedTabChangingTimerRef.current);
    }

    // 遷移中(古い⇄新しいスナップショットの撮影の間)にページの高さが
    // 変わってしまうと、View Transition が生成する古い/新しいスナップ
    // ショットの縦幅が食い違い、アニメーション中に画面上部が真っ白に
    // なったり一部の要素が欠けて見えたりするバグの原因になっていた。
    // これを避けるため、アニメーションが終わるまでの間だけ document の
    // 高さを「これまでに観測した最大の高さ」で一時的に固定しておく。
    const heightLockVersion = lockDocumentHeightForTransition();

    const finishHeaderLock = () => {
      if (feedTabChangingTimerRef.current !== null) {
        window.clearTimeout(feedTabChangingTimerRef.current);
        feedTabChangingTimerRef.current = null;
      }
      setIsFeedTabChanging(false);
      unlockDocumentHeightForTransition(heightLockVersion);
    };

    const previousIndex = FEED_TABS.findIndex((tab) => tab.value === activeFeedTab);
    const nextIndex = FEED_TABS.findIndex((tab) => tab.value === value);
    const direction = nextIndex > previousIndex ? 'forward' : 'backward';
    const root = document.documentElement;

    // 既存の初回演出抑止フラグは維持する。ただしページ全体をアニメーション対象にはしない。
    root.setAttribute('data-lime-feed-tab-direction', direction);

    const previousTransition = feedTabViewTransitionRef.current;
    if (previousTransition) {
      previousTransition.skipTransition?.();
      feedTabViewTransitionRef.current = null;
    }

    let targetScrollTop = 0;
    const applyTabChange = () => {
      // Reactの新DOMと、切り替え先タブの保存スクロール位置を同じ同期更新にする。
      // これで新しいスナップショットが縦方向へアニメーションせず、横方向だけが動く。
      flushSync(() => {
        targetScrollTop = changeActiveFeedTabWithScrollMemory(value) ?? 0;
      });
      window.scrollTo({ top: targetScrollTop, behavior: 'auto' });
    };

    try {
      const transition = viewTransitionDocument.startViewTransition(applyTabChange);
      feedTabViewTransitionRef.current = transition;

      feedTabChangingTimerRef.current = window.setTimeout(() => {
        feedTabChangingTimerRef.current = null;
        finishHeaderLock();
      }, 380);

      void transition.finished.finally(() => {
        if (feedTabViewTransitionRef.current === transition) {
          feedTabViewTransitionRef.current = null;
          root.removeAttribute('data-lime-feed-tab-direction');
          finishHeaderLock();
        }
      });
    } catch {
      // API実行失敗時もタブ切替自体は失わせない。
      root.removeAttribute('data-lime-feed-tab-direction');
      applyTabChange();
      finishHeaderLock();
    }
  }, [activeFeedTab, changeActiveFeedTabWithScrollMemory]);

  useEffect(() => {
    return () => {
      feedTabViewTransitionRef.current?.skipTransition?.();
      feedTabViewTransitionRef.current = null;
      if (feedTabChangingTimerRef.current !== null) {
        window.clearTimeout(feedTabChangingTimerRef.current);
        feedTabChangingTimerRef.current = null;
      }
      if (typeof document !== 'undefined') {
        document.documentElement.removeAttribute('data-lime-feed-tab-direction');
        if (heightLockRef.current) {
          document.documentElement.style.minHeight = heightLockRef.current.previousMinHeight;
          heightLockRef.current = null;
        }
      }
    };
  }, []);

  useMobileDrawerMotion(
    isMobileSidebarOpen,
    setIsMobileSidebarOpen,
    // ホーム以外のページ、またはホームの「最新」タブ(これ以上右に戻れない)では
    // 本文からの右スワイプでも開ける。「フォロー中/トレンド」では右スワイプは
    // 前のタブへ戻る操作に使うので、画面端からのみ開く。
    !isHomeTimeline || activeFeedTab === 'all',
  );
  useMobileFeedTabSwipe(
    isHomeTimeline,
    isMobileSidebarOpen,
    activeFeedTab,
    changeFeedTabWithAnimation,
  );
  useFeedTabWheelSwipe(
    isHomeTimeline,
    isMobileSidebarOpen,
    activeFeedTab,
    changeFeedTabWithAnimation,
  );

  // タブ切替アニメーション用に、これまでに観測したdocumentの最大の高さを
  // 継続的に記録しておく(lockDocumentHeightForTransitionで使用する)。
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const trackDocumentHeight = () => {
      maxDocumentHeightRef.current = Math.max(
        maxDocumentHeightRef.current,
        document.documentElement.scrollHeight
      );
    };

    trackDocumentHeight();
    window.addEventListener('resize', trackDocumentHeight);
    window.addEventListener('scroll', trackDocumentHeight, { passive: true });

    return () => {
      window.removeEventListener('resize', trackDocumentHeight);
      window.removeEventListener('scroll', trackDocumentHeight);
    };
  }, []);

  // 検索バー・検索ページ用タブは「検索ページ('/search')のみ・モバイルのみ」で表示する。
  // サジェスト用の各種effect/memoからも参照するため、コンポーネント冒頭で確定させておく。
  const isSearchRoute = normalizeAppPath(location.pathname) === '/search';

  // 検索ページで実際に検索結果を表示しているか。
  // メインの検索ページ(未検索状態)だけスクロールでヘッダーを閉じ、
  // 検索結果表示中はヘッダーを常に表示する。
  const [isSearchResultsVisible, setIsSearchResultsVisible] = useState(false);

  // モバイルヘッダーの検索バー(旧SearchPage.tsxの検索入力欄をここに移設したもの)。
  const [headerSearchValue, setHeaderSearchValue] = useState('');
  const [isHeaderSearchSettingsOpen, setIsHeaderSearchSettingsOpen] = useState(false);
  const [excludeBlueskyPosts, setExcludeBlueskyPosts] = useState(() => readExcludeBlueskyPosts());
  // 検索ページ(モバイル)の「話題/最新/ユーザー/メディア」タブ。検索ページ以外では使わない。
  const [activeSearchPageTab, setActiveSearchPageTab] = useState<SearchPageTabValue>(() => readStoredSearchPageTab());

  // --- モバイル・ヘッダー検索バーのサジェスト用 state ---
  // SearchPage.tsx のPC版と同じ考え方:「検索履歴」+「ローカルユーザー候補」+
  // 「Blueskyユーザー候補」をまとめてドロップダウン表示する。
  const [headerAllUsers, setHeaderAllUsers] = useState<User[]>([]);
  const [headerBlueskySuggestionUsers, setHeaderBlueskySuggestionUsers] = useState<User[]>([]);
  const [headerSearchHistory, setHeaderSearchHistory] = useState<string[]>(() => loadSearchHistory());
  const [isHeaderSearchFocused, setIsHeaderSearchFocused] = useState(false);
  const [headerActiveSuggestIdx, setHeaderActiveSuggestIdx] = useState(-1);
  const headerSearchInputRef = useRef<HTMLInputElement>(null);
  const headerSuggestBoxRef = useRef<HTMLDivElement>(null);

  // SearchPage.tsx のPC版検索バーやトレンドから検索したときも、
  // モバイルヘッダーの検索欄へ同じ文字列を反映する。URLの ?q= には依存しない。
  // 検索条件チップの×で検索語が空になったとき(query が空文字)は、
  // ヘッダーの検索欄もクリアして未検索状態に戻す。
  useEffect(() => {
    const handleSearchQueryChanged = (event: Event) => {
      const rawQuery = (event as CustomEvent<{ query?: string }>).detail?.query;
      if (typeof rawQuery !== 'string') return;

      const query = rawQuery.trim();
      if (!query) {
        setHeaderSearchValue('');
        setIsSearchResultsVisible(false);
        setIsHeaderSearchFocused(false);
        setHeaderActiveSuggestIdx(-1);
        return;
      }

      setHeaderSearchValue(query);
      setIsSearchResultsVisible(true);
      setIsHeaderSearchFocused(false);
      setHeaderActiveSuggestIdx(-1);
    };

    window.addEventListener(SEARCH_QUERY_CHANGED_EVENT, handleSearchQueryChanged);
    return () => window.removeEventListener(SEARCH_QUERY_CHANGED_EVENT, handleSearchQueryChanged);
  }, []);

  // SearchPage.tsx側(PC版タブなど)でタブが変更された場合も、ヘッダーの表示を同期する。
  useEffect(() => {
    const handleSearchPageTabChanged = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: string }>).detail?.tab;
      if (!tab) return;
      setActiveSearchPageTab(normalizeSearchPageTab(tab));
    };

    window.addEventListener(SEARCH_PAGE_TAB_CHANGED_EVENT, handleSearchPageTabChanged);
    return () => window.removeEventListener(SEARCH_PAGE_TAB_CHANGED_EVENT, handleSearchPageTabChanged);
  }, []);

  useEffect(() => {
    const handleViewportChange = () => {
      if (window.innerWidth >= 640) {
        setIsMobileSidebarOpen(false);
      }
    };

    window.addEventListener('resize', handleViewportChange);
    return () => window.removeEventListener('resize', handleViewportChange);
  }, []);

  // 検索ページ(モバイル)でサジェストに使うユーザー一覧を取得する。
  // SearchPage.tsx側の取得ロジックと同様、必要な列だけを取得する。
  useEffect(() => {
    if (!isSearchRoute) return;
    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, username, display_name, avatar_url, cover_url, created_at, bio, is_official');
        if (error) throw error;
        if (cancelled) return;
        setHeaderAllUsers((data || []).map((u: any) => ({
          id: u.id,
          username: u.username,
          displayName: u.display_name || u.displayName || 'User',
          avatarUrl: u.avatar_url || u.avatarUrl || '',
          coverUrl: u.cover_url || '',
          createdAt: u.created_at || '',
          bio: u.bio || '',
          isOfficial: !!(u.is_official || u.isOfficial),
        })));
      } catch (err) {
        console.error('Failed to fetch users for header search suggestions:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isSearchRoute]);

  // 入力中のBlueskyユーザーサジェストを取得する(検索ページ・モバイルのみ)。
  // 検索コマンド(from: など)は除き、検索語だけを渡す(PC版と同じ)。
  useEffect(() => {
    if (!isSearchRoute) {
      setHeaderBlueskySuggestionUsers([]);
      return;
    }

    const query = getSuggestFreeText(headerSearchValue).trim();
    if (!query || excludeBlueskyPosts) {
      setHeaderBlueskySuggestionUsers([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchBluesky(normalizeBlueskySuggestQuery(query), { includePosts: false })
        .then((result) => {
          if (cancelled) return;
          setHeaderBlueskySuggestionUsers(result.users.slice(0, 3).map((u) => ({
            id: u.id,
            username: u.username,
            displayName: u.displayName,
            avatarUrl: u.avatarUrl,
            coverUrl: u.coverUrl,
            createdAt: u.createdAt,
            bio: u.bio,
            isOfficial: false,
          })));
        })
        .catch((error) => {
          if (!cancelled) {
            console.error('Bluesky suggestion search failed:', error);
            setHeaderBlueskySuggestionUsers([]);
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [headerSearchValue, excludeBlueskyPosts, isSearchRoute]);

  // サジェストの外側をクリックしたら閉じる。
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (
        headerSuggestBoxRef.current && !headerSuggestBoxRef.current.contains(e.target as Node) &&
        headerSearchInputRef.current && !headerSearchInputRef.current.contains(e.target as Node)
      ) {
        setIsHeaderSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // ローカルユーザー候補 + Blueskyユーザー候補をマージ(SearchPage.tsxのliveSuggestionsと同じロジック)。
  // "from:xxx" などの検索コマンドは除き、検索語だけでユーザー候補を出す。
  const headerLiveUserSuggestions = useMemo(() => {
    const raw = getSuggestFreeText(headerSearchValue).trim();
    const normalizedRaw = normalizeForSearch(raw);
    const queryCandidates = Array.from(
      new Set([normalizedRaw, normalizedRaw.replace(/^@+/, '')].filter(Boolean))
    );

    if (queryCandidates.length === 0) return [];

    const localSuggestions = headerAllUsers
      .map((u) => {
        const dn = normalizeForSearch(u.displayName);
        const un = normalizeForSearch(u.username);
        const handle = normalizeForSearch(`@${u.username}`);
        const fields = [dn, un, handle];
        let score = 0;

        if (queryCandidates.some((q) => fields.includes(q))) score = 100;
        else if (queryCandidates.some((q) => fields.some((field) => field.startsWith(q)))) score = 50;
        else if (queryCandidates.some((q) => fields.some((field) => field.includes(q)))) score = 20;

        return { user: u, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => x.user);

    const seen = new Set(localSuggestions.map((user) => user.id));
    const blueskySuggestions = headerBlueskySuggestionUsers.filter((user) => !seen.has(user.id)).slice(0, 3);
    return [...localSuggestions.slice(0, 5 - blueskySuggestions.length), ...blueskySuggestions];
  }, [headerSearchValue, headerAllUsers, headerBlueskySuggestionUsers]);

  // 表示するサジェスト行:入力があれば「検索する」+ユーザー候補、無ければ履歴。
  const headerSuggestionRows = useMemo<HeaderSuggestionRow[]>(() => {
    const rows: HeaderSuggestionRow[] = [];
    if (headerSearchValue.trim()) {
      rows.push({ type: 'search', value: headerSearchValue.trim() });
      for (const u of headerLiveUserSuggestions) rows.push({ type: 'user', value: u.username, user: u });
    } else {
      for (const h of headerSearchHistory) rows.push({ type: 'search', value: h });
    }
    return rows;
  }, [headerSearchValue, headerLiveUserSuggestions, headerSearchHistory]);

  const isSearchPage = normalizeAppPath(location.pathname) === '/u/LimeBiz';
  const isChatPage = normalizeAppPath(location.pathname) === '/chat';
  const hideHeaderOnMobileProfile = isGithubPagesProfilePath(location.pathname);
  // ポスト詳細ページはモバイルで専用ヘッダー(戻る・タイトル・もっと見る)を
  // PostDetail.tsx側が表示するため、共通のHeaderはモバイルでのみ非表示にする。
  const hidePostDetailHeaderOnMobile = isPostDetailPath(location.pathname);
  const useTimelineChromeDesign = timelineChrome.enabled;
  const isTimelineDark = timelineChrome.theme === 'dark';
  // タブはタイムライン(ホーム画面)のみ。
  // ヘッダーのスクロール開閉は、タイムラインに加えて「検索バーが表示される
  // モバイル検索ページ(/search)」にも同じ挙動を適用する。
  // それ以外のページのヘッダーは常に表示したままにする。
  const showFeedTabs = isHomeTimeline;
  // モバイル検索ページは未検索のメイン画面だけスクロールでヘッダーを閉じる。
  // 検索結果が出た後は、結果を見ながら検索できるよう常に表示する。
  const enableMobileHeaderScrollHide =
    showFeedTabs || (isSearchRoute && !isSearchResultsVisible);

  const isHiddenOnMobile = useMobileHeaderVisibility(enableMobileHeaderScrollHide, isFeedTabChanging);
  // サイドバーを開いている間はヘッダー(タイムライン/検索のタブを含む)を
  // 必ず表示する。スクロール中にヘッダーが既に非表示状態だと、そのまま
  // サイドバーを開いた瞬間にタブまで一緒に translateY(-100%) へ移動して
  // 「全てのタブが消えた」ように見えるため。
  const shouldHideMobileHeader = isHiddenOnMobile && !isMobileSidebarOpen;

  // 検索ページから離れたら、次にメイン検索ページへ戻ったときは未検索状態から開始する。
  useEffect(() => {
    if (!isSearchRoute) {
      setIsSearchResultsVisible(false);
    }
  }, [isSearchRoute]);

  // モバイル検索ヘッダーがスクロールで閉じたら、サジェストも同時に閉じる。
  // 検索結果表示中はヘッダーを閉じないので、サジェストもこの処理では閉じない。
  // PC版や検索ページ以外のヘッダーには影響させない。
  useEffect(() => {
    if (!isHiddenOnMobile || !isSearchRoute || isSearchResultsVisible || window.innerWidth >= 640) return;
    setIsHeaderSearchFocused(false);
    setHeaderActiveSuggestIdx(-1);
  }, [isHiddenOnMobile, isSearchRoute, isSearchResultsVisible]);

  // 通常クリックではスクロール位置を変更しない。
  // ダブルクリック判定用に「1回目のクリックでタブが切り替わったか」だけを記録する。
  const handleFeedTabClick = (value: FeedTabValue) => {
    const now = Date.now();
    const previous = feedTabClickRef.current;
    const isSecondClick = previous.value === value && now - previous.at <= 500;

    if (!isSecondClick) {
      feedTabClickRef.current = {
        value,
        switchedOnFirstClick: value !== activeFeedTab,
        at: now,
      };
      return;
    }

    // 2回目のクリックでは、1回目のクリック時点の「切り替え有無」を維持する。
    feedTabClickRef.current = {
      value,
      switchedOnFirstClick: previous.switchedOnFirstClick,
      at: now,
    };
  };

  // 「タブを切り替えた直後の2回クリック」ではなく、
  // すでにそのタブが表示されている状態でダブルクリックしたときだけトップへ戻す。
  const handleFeedTabDoubleClick = (value: FeedTabValue) => {
    const now = Date.now();
    const clickState = feedTabClickRef.current;
    const isValidDoubleClick =
      clickState.value === value &&
      !clickState.switchedOnFirstClick &&
      now - clickState.at <= 500 &&
      value === activeFeedTab;

    feedTabClickRef.current = { value: null, switchedOnFirstClick: false, at: 0 };

    if (!isValidDoubleClick) return;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLogoClick = () => {
    window.location.href = import.meta.env.BASE_URL;
  };

  // 検索を確定する共通処理。履歴への追加とページ遷移をまとめて行う。
  // 検索文字列は SEARCH_QUERY_CHANGED_EVENT と React Router の navigation state
  // で SearchPage.tsx に渡すため、URLの ?q= には依存しない。
  // 検索コマンド(from: / "フレーズ" / OR / -除外 / since: など)を含む文字列も
  // そのまま渡し、解釈は SearchPage.tsx 側の parseSearchQuery が行う。
  const commitHeaderSearch = (raw: string) => {
    const query = raw.trim();
    if (!query) return;

    setHeaderSearchValue(query);
    setIsSearchResultsVisible(true);
    setIsHeaderSearchFocused(false);
    setHeaderActiveSuggestIdx(-1);
    window.dispatchEvent(new CustomEvent(SEARCH_QUERY_CHANGED_EVENT, { detail: { query } }));

    setHeaderSearchHistory((prev) => {
      const next = [query, ...prev.filter((h) => h !== query)].slice(0, SEARCH_HISTORY_MAX);
      saveSearchHistory(next);
      return next;
    });

    navigate('/search', { state: { searchQuery: query } });
    headerSearchInputRef.current?.blur();
  };

  const handleHeaderSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    commitHeaderSearch(headerSearchValue);
  };

  // サジェスト行を選択したときの処理。ユーザー行ならプロフィールへ、
  // 検索行(履歴 or 入力中のキーワード)なら検索を確定する。
  const handleHeaderSuggestionSelect = (row: HeaderSuggestionRow) => {
    if (row.type === 'user') {
      setIsHeaderSearchFocused(false);
      setHeaderActiveSuggestIdx(-1);
      headerSearchInputRef.current?.blur();
      navigate(`/u/${row.user.username}`);
      return;
    }

    commitHeaderSearch(row.value);
  };

  const handleHeaderSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isHeaderSearchFocused) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHeaderActiveSuggestIdx((i) => Math.min(headerSuggestionRows.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHeaderActiveSuggestIdx((i) => Math.max(-1, i - 1));
    } else if (event.key === 'Enter' && headerActiveSuggestIdx >= 0) {
      // 候補が減った直後などで範囲外になっていても落ちないようにする。
      const row = headerSuggestionRows[headerActiveSuggestIdx];
      if (!row) return;
      event.preventDefault();
      handleHeaderSuggestionSelect(row);
    }
  };

  const removeHeaderHistoryItem = (item: string) => {
    setHeaderSearchHistory((prev) => {
      const next = prev.filter((h) => h !== item);
      saveSearchHistory(next);
      return next;
    });
  };

  const clearHeaderHistory = () => {
    setHeaderSearchHistory([]);
    saveSearchHistory([]);
  };

  // 検索ページ(モバイル)の話題/最新/ユーザー/メディアタブ切り替え。SearchPage.tsx側は
  // このイベントを監視して自身のTabsコンポーネントの表示を切り替える。
  const changeActiveSearchPageTab = (value: SearchPageTabValue) => {
    setActiveSearchPageTab(value);
    try {
      localStorage.setItem(SEARCH_PAGE_TAB_STORAGE_KEY, value);
    } catch {
      // noop
    }
    window.dispatchEvent(
      new CustomEvent(SEARCH_PAGE_TAB_CHANGED_EVENT, { detail: { tab: value } })
    );
  };

  // 「Blueskyの投稿を含めない」設定はlocalStorage経由でSearchPage.tsxと共有する。
  const handleToggleExcludeBluesky = (checked: boolean) => {
    setExcludeBlueskyPosts(checked);
    try {
      localStorage.setItem(SEARCH_EXCLUDE_BLUESKY_STORAGE_KEY, String(checked));
    } catch {
      // noop
    }
    window.dispatchEvent(
      new CustomEvent(SEARCH_EXCLUDE_BLUESKY_CHANGED_EVENT, { detail: { excludeBlueskyPosts: checked } })
    );
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
      ? 'z-[4000] w-56 rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-50 shadow-xl'
      : 'z-[4000] w-56 rounded-xl border border-zinc-200 bg-white text-zinc-950 shadow-xl'
    : 'z-[60] w-56 rounded-xl border-border/60 bg-popover text-popover-foreground shadow-xl';

  const separatorClass = useTimelineChromeDesign
    ? isTimelineDark
      ? 'bg-zinc-800'
      : 'bg-zinc-200'
    : undefined;

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const root = document.documentElement;

    if (hideHeaderOnMobileProfile) {
      root.setAttribute('data-lime-mobile-profile-page', 'true');
    } else {
      root.removeAttribute('data-lime-mobile-profile-page');
    }

    return () => {
      if (root.getAttribute('data-lime-mobile-profile-page') === 'true') {
        root.removeAttribute('data-lime-mobile-profile-page');
      }
    };
  }, [hideHeaderOnMobileProfile]);

  // Escapeキーでモバイルサイドバーを閉じる。
  // ページの縦スクロールロックは useMobileDrawerMotion 内で touchmove を
  // preventDefault する方式に一元化しているため、ここでは行わない。
  useEffect(() => {
    if (!isMobileSidebarOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileSidebarOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMobileSidebarOpen]);

  // ページ遷移したらモバイルサイドバーも閉じる。
  useEffect(() => {
    setIsMobileSidebarOpen(false);
  }, [location.pathname]);

  // PC版のアカウント操作は従来どおりDropdownMenuを使用する。
  const renderDesktopAccountControl = () => (
    user ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex h-9 w-9 items-center justify-center rounded-full outline-none sm:h-10 sm:w-10">
            <Avatar className="h-9 w-9 border-0 sm:h-10 sm:w-10">
              <AvatarImage src={user.avatarUrl} alt={user.displayName} />
              <AvatarFallback>{user.displayName?.slice(0, 1)}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          className={dropdownClass}
          style={{ zIndex: 500 }}
        >
          <DropdownMenuItem onClick={() => navigate('/search')} className={menuItemClass}>
            <Search className="mr-2 h-4 w-4" /> 検索
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => navigate('/notifications')} className={menuItemClass}>
            <Bell className="mr-2 h-4 w-4" /> 通知
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => navigate('/chat')} className={menuItemClass}>
            <MessageSquare className="mr-2 h-4 w-4" /> LimeAI
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => navigate('/media')} className={menuItemClass}>
            <Images className="mr-2 h-4 w-4" /> フォト
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
    )
  );

  // モバイルではアバターをタップすると、画像を参考にした左スライドのサイドバーを開く。
  // (画面端からのスワイプでも同じサイドバーが開く。詳細は useMobileDrawerMotion を参照。)
  const renderMobileAccountControl = () => (
    user ? (
      <button
        type="button"
        onClick={() => setIsMobileSidebarOpen((open) => !open)}
        aria-label={isMobileSidebarOpen ? "メニューを閉じる" : "メニューを開く"}
        aria-expanded={isMobileSidebarOpen}
        className="flex h-9 w-9 items-center justify-center rounded-full outline-none"
      >
        <Avatar className="h-9 w-9 border-0">
          <AvatarImage src={user.avatarUrl} alt={user.displayName} />
          <AvatarFallback>{user.displayName?.slice(0, 1)}</AvatarFallback>
        </Avatar>
      </button>
    ) : (
      <Button asChild size="sm" className="rounded-full px-5 font-bold">
        <Link to="/auth">はじめる</Link>
      </Button>
    )
  );

  // モバイルヘッダーの検索バー。画像のデザイン(ダークな角丸ピル+検索アイコン+
  // プレースホルダー、右側に独立した設定歯車アイコン)を踏襲する。
  // 旧SearchPage.tsxにあった検索入力欄はここに統合したため、SearchPage.tsx側の
  // 入力欄は削除している(検索実行は/search?q=…への遷移で行う)。
  // 入力欄の下には、PC版検索バー(SearchPage.tsx)と同じ「検索履歴 + ユーザー候補」の
  // サジェストドロップダウンを表示する。
  const renderMobileSearchBar = () => {
    // 検索バーは検索ページ('/search')のモバイル表示でのみ表示する。
    if (!isSearchRoute) return null;

    return (
      <div className="relative min-w-0 flex-1 sm:hidden">
        <form onSubmit={handleHeaderSearchSubmit} className="flex min-w-0 flex-1 items-center gap-2">
          <div
            className={cn(
              "flex h-10 min-w-0 flex-1 items-center rounded-full px-4 transition-colors",
              isHeaderSearchFocused
                ? "bg-white ring-2 ring-primary dark:bg-black"
                : "bg-black/[0.06] dark:bg-white/10"
            )}
          >
            <Search className={cn("h-[18px] w-[18px] shrink-0", isHeaderSearchFocused ? "text-primary" : "text-zinc-500 dark:text-zinc-400")} />
            <input
              ref={headerSearchInputRef}
              value={headerSearchValue}
              onChange={(event) => {
                setHeaderSearchValue(event.target.value);
                setHeaderActiveSuggestIdx(-1);
              }}
              onFocus={() => setIsHeaderSearchFocused(true)}
              onKeyDown={handleHeaderSearchKeyDown}
              placeholder="検索"
              aria-label="検索"
              className="h-full w-full min-w-0 bg-transparent px-3 text-[15px] text-zinc-900 outline-none placeholder:text-zinc-500 dark:text-white dark:placeholder:text-zinc-400"
            />
            {headerSearchValue && (
              <button
                type="button"
                onClick={() => {
                  setHeaderSearchValue('');
                  headerSearchInputRef.current?.focus();
                }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary"
              >
                <X className="h-3 w-3 text-white" strokeWidth={3} />
              </button>
            )}
          </div>

          <div className="relative shrink-0">
            <button
              type="button"
              aria-label="検索設定"
              aria-expanded={isHeaderSearchSettingsOpen}
              onClick={() => setIsHeaderSearchSettingsOpen((open) => !open)}
              className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-black/[0.06] dark:text-zinc-400 dark:hover:bg-white/10"
            >
              <SettingsIcon className="h-5 w-5" />
            </button>

            {isHeaderSearchSettingsOpen && (
              <>
                <button
                  type="button"
                  aria-label="検索設定を閉じる"
                  className="fixed inset-0 z-[550] cursor-default"
                  onClick={() => setIsHeaderSearchSettingsOpen(false)}
                />
                <div className="absolute right-0 top-12 z-[600] w-64 rounded-2xl border border-black/5 bg-white p-3 shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:border-white/10 dark:bg-[#15202b]">
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-[14px] hover:bg-black/[0.03] dark:hover:bg-white/5">
                    <input
                      type="checkbox"
                      checked={excludeBlueskyPosts}
                      onChange={(event) => handleToggleExcludeBluesky(event.target.checked)}
                      className="h-4 w-4 accent-primary"
                    />
                    <span>Blueskyの投稿を含めない</span>
                  </label>
                </div>
              </>
            )}
          </div>
        </form>

        {isHeaderSearchFocused && headerSuggestionRows.length > 0 && (
          <div
            ref={headerSuggestBoxRef}
            className="absolute left-0 right-12 top-12 z-[600] max-h-[60vh] overflow-y-auto rounded-2xl border border-black/5 bg-white/95 shadow-[0_8px_30px_rgba(0,0,0,0.1)] backdrop-blur-xl dark:border-white/10 dark:bg-[#15202b]/95 dark:shadow-[0_8px_30px_rgba(0,0,0,0.3)]"
          >
            {!headerSearchValue.trim() && headerSearchHistory.length > 0 && (
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-[15px] font-bold">最近の検索</span>
                <button
                  type="button"
                  onClick={clearHeaderHistory}
                  className="text-[13px] text-primary hover:underline"
                >
                  すべて消去
                </button>
              </div>
            )}
            {headerSuggestionRows.map((row, idx) => (
              <button
                key={idx}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleHeaderSuggestionSelect(row);
                }}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3 transition-colors",
                  idx === headerActiveSuggestIdx
                    ? "bg-black/5 dark:bg-white/10"
                    : "hover:bg-black/[0.03] dark:hover:bg-white/5"
                )}
              >
                {row.type === 'search' ? (
                  <>
                    {!headerSearchValue.trim() ? (
                      <Clock className="h-[18px] w-[18px] text-[rgb(83,100,113)] dark:text-gray-400" />
                    ) : (
                      <Search className="h-[18px] w-[18px] text-[rgb(83,100,113)] dark:text-gray-400" />
                    )}
                    <span className="ml-3 flex-1 truncate text-left text-[15px]">{row.value}</span>
                    {!headerSearchValue.trim() && (
                      <span
                        role="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          removeHeaderHistoryItem(row.value);
                        }}
                        className="rounded-full p-1 hover:bg-black/10 dark:hover:bg-white/20"
                      >
                        <X className="h-4 w-4 text-[rgb(83,100,113)] dark:text-gray-400" />
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    {row.user.avatarUrl ? (
                      <img
                        src={row.user.avatarUrl}
                        alt={row.user.displayName}
                        loading="lazy"
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded-full bg-black/5 dark:bg-white/10" />
                    )}
                    <div className="flex min-w-0 flex-col text-left">
                      <span className="flex min-w-0 items-center gap-1">
                        <span className="truncate text-[15px] font-bold">{row.user.displayName}</span>
                        {row.user.isOfficial && (
                          <img
                            src={`${import.meta.env.BASE_URL}verified.png`}
                            alt="Official"
                            className="h-4 w-4 shrink-0 translate-y-[0.5px]"
                            loading="eager"
                          />
                        )}
                      </span>
                      <span className="truncate text-[13px] text-[rgb(83,100,113)] dark:text-gray-400">@{row.user.username}</span>
                    </div>
                  </>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  // 検索ページ(モバイル)専用の「話題/最新/ユーザー/メディア」タブ。旧SearchPage.tsxにあった
  // TabsList(Radix)をそのままここに持ってくることはできない(Tabsのコンテキストが
  // 別のコンポーネントツリーに分かれるため)ので、見た目だけを再現したボタン行にし、
  // 実際の値の受け渡しはlocalStorage+カスタムイベントで行う。
  // 並び順・ラベルはPC版(SearchPage.tsxのSEARCH_TABS)と同じ4タブ。
  const renderMobileSearchPageTabs = () => {
    if (!isSearchRoute) return null;

    const tabButtonClass = (value: SearchPageTabValue) =>
      cn(
        'relative z-[1] flex h-11 items-center justify-center text-[15px] transition-colors duration-200',
        activeSearchPageTab === value
          ? 'font-bold text-[rgb(15,20,25)] dark:text-white'
          : 'font-medium text-[rgb(83,100,113)] dark:text-gray-400'
      );

    const activeSearchPageTabIndex = Math.max(
      0,
      SEARCH_PAGE_TABS.findIndex((tab) => tab.value === activeSearchPageTab)
    );

    return (
      <div className="relative z-[1] sm:hidden">
        <div className="mx-auto max-w-5xl px-2 sm:px-4">
          <div className="relative grid grid-cols-4 border-b border-black/[0.03] dark:border-white/[0.05]">
            {/* 検索ページのタブもタイムラインと同じく、
                アクティブインジケーターを1本だけ使って左右へ滑らかに移動させる。
                選択ロジックは変更せず、見た目のアニメーションだけを追加する。 */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 left-0 z-[2] h-1 w-12 rounded-full bg-primary will-change-[left,transform] transition-[left,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                left: `${((activeSearchPageTabIndex + 0.5) / SEARCH_PAGE_TABS.length) * 100}%`,
                transform: 'translateX(-50%)',
              }}
            />
            {SEARCH_PAGE_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => changeActiveSearchPageTab(tab.value)}
                className={tabButtonClass(tab.value)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // モバイルサイドバーには、このHeader内ですでに存在が確認できる実在ページだけを表示する。
  const mobileSidebarItems = user
    ? [
        ...(desktopLayout ? [{ label: 'ホーム', path: '/', icon: Home, onClick: () => navigate('/') }] : []),
        {
          label: 'プロフィール',
          path: `/u/${user.username}`,
          icon: UserRound,
          onClick: () => navigate(`/u/${user.username}`),
        },
        {
          label: '検索',
          path: '/search',
          icon: Search,
          onClick: () => navigate('/search'),
        },
        {
          label: '通知',
          path: '/notifications',
          icon: Bell,
          onClick: () => navigate('/notifications'),
        },
        {
          label: 'LimeAI',
          path: '/chat',
          icon: MessageSquare,
          onClick: () => navigate('/chat'),
        },
        {
          label: 'フォト',
          path: '/media',
          icon: Images,
          onClick: () => navigate('/media'),
        },
        {
          label: '設定',
          path: '/settings',
          icon: SettingsIcon,
          onClick: () => navigate('/settings'),
        },
      ]
    : [];

  const renderMobileSidebar = () => {
    if (!user || typeof document === 'undefined' || (desktopLayout && !desktopSidebarContainer)) return null;

    const sidebarDarkClasses = useTimelineChromeDesign
      ? isTimelineDark
        ? 'border-white/[0.10] bg-black text-white'
        : 'border-black/[0.10] bg-white text-zinc-950'
      : 'border-black/[0.10] bg-white text-zinc-950 dark:border-white/[0.10] dark:bg-black dark:text-white';

    const sidebarMutedText = useTimelineChromeDesign
      ? isTimelineDark
        ? 'text-zinc-500'
        : 'text-zinc-500'
      : 'text-zinc-500 dark:text-zinc-500';

    const sidebarHover = useTimelineChromeDesign
      ? isTimelineDark
        ? 'hover:bg-white/[0.05]'
        : 'hover:bg-black/[0.05]'
      : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.05]';

    const sidebarIconText = useTimelineChromeDesign
      ? isTimelineDark
        ? 'text-white'
        : 'text-zinc-900'
      : 'text-zinc-900 dark:text-white';

    return createPortal(
      <>
        {/* サイドバーが開いている間だけ、右側に見えている本文の上に透明なオーバーレイを置く。
            - 本文タップでサイドバーを閉じられる。
            - 本文側のリンク/ボタンを誤タップして意図しない遷移をするのを防ぐ。
            - 本文側から左へドラッグして閉じる操作も、このオーバーレイ上で受け付ける
              (ジェスチャー処理は useMobileDrawerMotion が document レベルで担当)。
            左端はサイドバーの幅(aside の width と同じ clamp)に合わせている。 */}
        {isMobileSidebarOpen && (
          <div
            aria-hidden="true"
            data-lime-mobile-sidebar-overlay="true"
            onClick={() => setIsMobileSidebarOpen(false)}
            className="fixed inset-y-0 right-0 z-[99] sm:hidden"
            style={{ left: 'clamp(300px, 78vw, 420px)', touchAction: 'none' }}
          />
        )}
        <aside
          aria-hidden={desktopLayout ? false : !isMobileSidebarOpen}
          data-lime-desktop-sidebar={desktopLayout || undefined}
          data-lime-mobile-sidebar="true"
          className={cn(
            // サイドバー自体の幅を従来より広く確保する(全画面にはしない)。
            // 角丸は本画面側(root要素をtransformを持たないラッパーで包み、
            // ラッパーにborder-radius+overflow:hiddenを付与)に付けるものなので、
            // ここ(サイドバー本体)には付けない。
            'fixed inset-y-0 left-0 z-[100] flex w-[clamp(300px,78vw,420px)] flex-col border-r sm:hidden',
            sidebarDarkClasses,
            isMobileSidebarOpen
              ? 'visible pointer-events-auto'
              : 'invisible pointer-events-none'
          )}
          style={{ visibility: desktopLayout || isMobileSidebarOpen ? 'visible' : 'hidden' }}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {desktopLayout && <div data-lime-sidebar-logo className="shrink-0"><Logo size="md" /></div>}
            <div data-lime-sidebar-profile className="shrink-0 px-[clamp(24px,8vw,68px)] pt-[max(18px,env(safe-area-inset-top))]">
              <div className="flex items-start gap-4">
                <Avatar className="h-12 w-12 shrink-0 border-0">
                  <AvatarImage src={user.avatarUrl} alt={user.displayName} />
                  <AvatarFallback>{user.displayName?.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 pt-0.5">
                  <div className={cn("truncate text-[18px] font-extrabold leading-tight", sidebarIconText)}>
                    {user.displayName}
                  </div>
                  <div className={cn("truncate text-[15px] font-medium leading-tight", sidebarMutedText)}>
                    @{user.username}
                  </div>
                </div>
              </div>
            </div>

            <nav className="min-h-0 flex-1 overflow-y-auto px-[clamp(24px,8vw,68px)] pb-4 pt-7 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="space-y-1">
                {mobileSidebarItems.map((item) => {
                  const Icon = item.icon;
                  const isCurrent = desktopLayout && (item.path === '/'
                    ? location.pathname === '/'
                    : item.path.startsWith('/u/') ? location.pathname.startsWith('/u/')
                    : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`));
                  return (
                    <button
                      key={item.label}
                      aria-label={desktopLayout ? item.label : undefined}
                      title={desktopLayout ? item.label : undefined}
                      aria-current={isCurrent ? 'page' : undefined}
                      type="button"
                      onClick={item.onClick}
                      className={cn("flex w-full items-center gap-6 rounded-xl py-3 text-left transition-colors", sidebarHover)}
                    >
                      <Icon className={cn("h-6 w-6 shrink-0 stroke-[2]", sidebarIconText)} />
                      <span className={cn("whitespace-nowrap text-[18px] font-bold leading-tight", sidebarIconText)}>
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className={cn("my-6 border-t", useTimelineChromeDesign ? (isTimelineDark ? "border-white/[0.08]" : "border-black/[0.08]") : "border-black/[0.08] dark:border-white/[0.08]")} />

            </nav>
            {desktopLayout && <DesktopAccountFooter />}
          </div>
        </aside>
      </>,
      desktopLayout ? desktopSidebarContainer! : document.body
    );
  };



  return (
    <>
      <header
      data-lime-app-header="true"
      data-lime-mobile-profile-header-hidden={hideHeaderOnMobileProfile ? 'true' : undefined}
      data-lime-mobile-post-detail-header-hidden={hidePostDetailHeaderOnMobile ? 'true' : undefined}
      data-lime-chat-header-hidden-mobile={isChatPage ? 'true' : undefined}
      className={cn(
        isChatPage
          ? 'fixed left-0 right-0 top-0 z-[500] border-b backdrop-blur-md'
          : 'sticky top-0 z-[500] border-b backdrop-blur-md',
        // モバイルのタイムライン、または検索バーがある検索ページのときだけ、
        // スクロール方向に応じてヘッダー全体をスライドして隠す。
        // 他のページ、およびPC(sm以上)では常に translate-y-0。
        'transition-transform duration-300 ease-out sm:translate-y-0',
        shouldHideMobileHeader ? '-translate-y-full' : 'translate-y-0',
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

          /* タブのデザインはProfile.tsx側の profile-tabs-trigger と同じルールを流用している。 */
          .feed-tabs-trigger[data-state='active'] {
            color: hsl(var(--foreground));
            font-weight: 700;
          }

          .feed-tabs-trigger[data-state='inactive'] {
            color: hsl(var(--muted-foreground));
            font-weight: 450;
          }

          /* アクティブ下線はTabsList内の単一インジケーターを使用し、
             left/width のCSS transitionで左右へ滑らかにスライドさせる。 */

          /*
             モバイルのタブ切り替えだけをView Transitionで演出する。
             root全体はアニメーションさせず、フィード本文だけを名前付きレイヤーにする。
             これによりstickyヘッダー/backdrop-filterが残像・透明化の原因になるのを避ける。
             opacityは使わず、旧フィードと新フィードを左右へ同時にスライドさせる。
          */
          @keyframes lime-feed-tab-old-forward {
            from { transform: translateX(0); }
            to { transform: translateX(-100%); }
          }

          @keyframes lime-feed-tab-new-forward {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }

          @keyframes lime-feed-tab-old-backward {
            from { transform: translateX(0); }
            to { transform: translateX(100%); }
          }

          @keyframes lime-feed-tab-new-backward {
            from { transform: translateX(-100%); }
            to { transform: translateX(0); }
          }

          @media (max-width: 639px) {
            /*
              バグ修正: 以前はここで ::view-transition-*(root) を
              display:none / opacity:0 / visibility:hidden で完全に非表示にしていた。
              root は「lime-feed-tab-content」以外の全て(ヘッダー・タブ下線・
              投稿フォーム・背景など)を含むレイヤーなので、これを丸ごと隠すと
              アニメーション中(数百ms)その領域に何も描画されなくなり、
              「画面上部が白くなる」「一部の要素が消える」バグの直接の原因になっていた。
              ここでは root を非表示にはせず、アニメーションだけを止めて
              静止した背景としてそのまま描画させ続ける(見た目上は何も変化しない
              要素なので、アニメーションを止めても違和感は出ない)。
              あわせて mix-blend-mode を normal に固定し、UA既定の
              plus-lighter ブレンドによる白飛び・色の重なりも防ぐ。
            */
            /*
              重要: ::view-transition-group(root) の animation は無効化しない。
              root グループの位置・サイズはこのアニメーション経由でのみ確定するため、
              ここを animation:none にすると新旧スナップショットの位置がずれ、
              ヘッダー/ナビなどが二重に透けて重なる「ゴースト」表示になってしまう
              (実際にこの症状が発生したため、groupのanimationは触らない方針に修正)。
              クロスフェード(白飛び・重なりの見た目)だけを old/new 側で止める。

              さらに、JS側(changeFeedTabWithAnimation内)で遷移中だけ
              documentの高さを固定し、タブごとの投稿数の違いでroot(ページ全体)の
              古い/新しいスナップショットの縦幅が食い違わないようにしている。
              これにより上のgroupアニメーション自体もほぼ変化なし(no-op)になり、
              サイズの食い違いによる「上部が真っ白になる」「一部の要素が消える」
              という見た目のバグを避けられる。object-fit: cover は、それでも
              万一サイズがズレた場合の保険として設定している。
            */
            ::view-transition-image-pair(root) {
              isolation: auto;
            }

            ::view-transition-old(root),
            ::view-transition-new(root) {
              animation-duration: 1ms !important;
              -webkit-animation-duration: 1ms !important;
              animation-delay: 0s !important;
              mix-blend-mode: normal !important;
              opacity: 1 !important;
              object-fit: cover !important;
            }

            /*
              追加バグ修正(本題): 「上半分が真っ白になる/一部の要素が消える」の
              直接の原因は、position:sticky なヘッダー(タブ・アバター・検索欄を含む)と
              position:fixed な BottomNav(createPortalでdocument.body直下に配置)が、
              どちらも専用の view-transition-name を持たず「root」グループへ
              無名のまま巻き込まれていたことにある。
              position:fixed/sticky な要素が無名でrootキャプチャに混ざると、
              スクロール位置のわずかなズレやキャプチャ矩形の計算誤差によって、
              遷移中に元の位置からズレて描画されたり、一瞬だけ透明(=背景が
              透けて白い)になったりしやすい。これはブラウザのView Transitions
              実装でよく知られる既知の挙動で、「position:fixed/sticky な要素には
              専用のview-transition-nameを与えてrootから独立させる」のが定石の対処法。

              ヘッダーとBottomNavにそれぞれ専用の名前を与え、rootと全く同じ
              「フェードもリサイズもさせず一瞬で入れ替える」扱いにする。
              (BottomNav側の対応するCSS属性は BottomNav.tsx で付与している)
            */
            header[data-lime-app-header="true"] {
              view-transition-name: lime-app-header;
            }

            nav[data-lime-bottom-nav-root="true"] {
              view-transition-name: lime-bottom-nav;
            }

            ::view-transition-image-pair(lime-app-header),
            ::view-transition-image-pair(lime-bottom-nav) {
              isolation: auto;
            }

            ::view-transition-old(lime-app-header),
            ::view-transition-new(lime-app-header),
            ::view-transition-old(lime-bottom-nav),
            ::view-transition-new(lime-bottom-nav) {
              animation-duration: 1ms !important;
              -webkit-animation-duration: 1ms !important;
              animation-delay: 0s !important;
              mix-blend-mode: normal !important;
              opacity: 1 !important;
              object-fit: cover !important;
            }

            /*
              バグ修正: ヘッダーは backdrop-blur + 半透明背景のため、old/newの
              スナップショットを同じ位置へ重ねて表示すると、下線(タブの
              アクティブインジケーター)の位置が異なるoldがnewの透け感を
              通してうっすら透けて見え、「残像」のように見えてしまっていた。
              フェードさせていない以上oldを表示しておく意味はないため、
              oldは完全に非表示にしてnewだけを描画する
              (遷移時間は実質1msなので、見た目上のちらつきは発生しない)。
            */
            ::view-transition-old(lime-app-header),
            ::view-transition-old(lime-bottom-nav) {
              display: none !important;
            }

            ::view-transition-group(lime-feed-tab-content) {
              animation: none !important;
              -webkit-animation: none !important;
              isolation: isolate;
            }

            ::view-transition-image-pair(lime-feed-tab-content) {
              overflow: hidden;
              isolation: isolate;
            }

            ::view-transition-old(lime-feed-tab-content),
            ::view-transition-new(lime-feed-tab-content) {
              animation-duration: 360ms !important;
              animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1) !important;
              animation-fill-mode: both !important;
              opacity: 1 !important;
              mix-blend-mode: normal !important;
              backface-visibility: hidden;
              -webkit-backface-visibility: hidden;
            }

            html[data-lime-feed-tab-direction='forward']::view-transition-old(lime-feed-tab-content) {
              animation-name: lime-feed-tab-old-forward !important;
            }

            html[data-lime-feed-tab-direction='forward']::view-transition-new(lime-feed-tab-content) {
              animation-name: lime-feed-tab-new-forward !important;
            }

            html[data-lime-feed-tab-direction='backward']::view-transition-old(lime-feed-tab-content) {
              animation-name: lime-feed-tab-old-backward !important;
            }

            html[data-lime-feed-tab-direction='backward']::view-transition-new(lime-feed-tab-content) {
              animation-name: lime-feed-tab-new-backward !important;
            }
          }

          /* タイムライン本文の「ふわっと浮かび上がる」入口アニメーションは、
             ページを再読み込みした直後の最初のタブ表示だけ許可する。
             一度でも別タブへ切り替えた後は、再訪を含めて入口アニメーションを発火させない。
             タブ下線のスライドアニメーションはこの抑止対象に含めない。 */
          html[data-lime-feed-tab-switched='true'] #root .animate-in${desktopLayout ? ':not([data-lime-profile-hover-card])' : ''},
          html[data-lime-feed-tab-switched='true'] #root [class*='fade-in']${desktopLayout ? ':not([data-lime-profile-hover-card])' : ''} {
            animation: none !important;
            -webkit-animation: none !important;
            animation-delay: 0s !important;
            -webkit-animation-delay: 0s !important;
            opacity: 1 !important;
            visibility: visible !important;
          }

          /* モバイルでは横方向のタッチを常にページ側(JS)で扱えるようにし、
             iOS/Androidブラウザの「画面端スワイプで戻る」システムジェスチャーに
             タッチを奪われないようにする。縦スクロールは pan-y で許可したまま。 */
          @media (max-width: 639px) {
            html, body {
              touch-action: pan-y;
              overscroll-behavior-x: contain;
            }
          }

          @media (max-width: 767px) {
            header[data-lime-app-header="true"][data-lime-chat-header-hidden-mobile="true"] {
              display: none !important;
              height: 0 !important;
              min-height: 0 !important;
              border: 0 !important;
              overflow: hidden !important;
            }
          }

          @media (max-width: 639px) {
            header[data-lime-app-header="true"][data-lime-mobile-profile-header-hidden="true"],
            html[data-lime-mobile-profile-page="true"] header[data-lime-app-header="true"] {
              display: none !important;
              height: 0 !important;
              min-height: 0 !important;
              border: 0 !important;
              overflow: hidden !important;
            }
          }

          /* ポスト詳細ページはモバイルのみ、PostDetail.tsx側の専用ヘッダーに
             置き換えるため、共通のHeaderをここで非表示にする。 */
          @media (max-width: 639px) {
            header[data-lime-app-header="true"][data-lime-mobile-post-detail-header-hidden="true"] {
              display: none !important;
              height: 0 !important;
              min-height: 0 !important;
              border: 0 !important;
              overflow: hidden !important;
            }
          }
        `}
      </style>

      {/*
        タブの選択状態(activeFeedTab)は、PC用(ロゴとアバターの間)とモバイル用
        (アイコン行の下・別行)の2つのTabsListで共有する。Profile.tsxと同じく、
        1つのTabsルートの中に用途別のTabsListを複数置いて出し分ける構成。
      */}
      <Tabs value={activeFeedTab} onValueChange={(value) => changeFeedTabWithAnimation(value as FeedTabValue)}>
        {/* ロゴ＋アバター＋検索バーの行。
            - モバイル: アバター(またはログインボタン)を左、その右に検索バー(画像のデザイン)
              +設定歯車アイコンを配置する。ロゴはモバイルでは表示しない。
            - PC(sm以上): ロゴを左端、アバターを右端、その間(中央)にタブを配置。 */}
        <div data-lime-header-row className="relative mx-auto flex h-14 max-w-5xl items-center gap-2 px-3 sm:h-16 sm:px-4">
          <div className="sm:order-3">
            <div className="sm:hidden">
              {renderMobileAccountControl()}
            </div>
            <div className="hidden sm:block">
              {renderDesktopAccountControl()}
            </div>
          </div>

          {renderMobileSearchBar()}

          <div
            onClick={handleLogoClick}
            className={cn(
              // モバイルでは検索ページのときだけ検索バーに置き換えるため非表示にし、
              // それ以外のページでは元通り中央に絶対配置する。sm:以降(PC)のクラスは変更していない。
              isSearchRoute ? 'hidden' : 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
              'cursor-pointer sm:static sm:left-auto sm:top-auto sm:order-1 sm:block sm:translate-x-0 sm:translate-y-0'
            )}
          >
            <Logo />
          </div>

          {/* ロゴとアバターの間を埋める領域。PCではここが常にflex-1で、
              ホーム画面のときだけ中身としてタブを表示する(タブが無いページでも
              アバターが右端に固定されるよう、枠自体は常に確保しておく)。 */}
          <div data-lime-desktop-feed-tabs className="hidden sm:order-2 sm:flex sm:min-w-0 sm:flex-1 sm:justify-center">
            {showFeedTabs && (
              <TabsList className="grid w-full max-w-[300px] grid-cols-3 rounded-2xl bg-muted/50 p-1">
                {FEED_TABS.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    onClick={() => handleFeedTabClick(tab.value)}
                    onDoubleClick={() => handleFeedTabDoubleClick(tab.value)}
                    className="rounded-xl font-bold text-muted-foreground transition-all data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-sm data-[state=inactive]:bg-transparent data-[state=inactive]:text-foreground"
                  >
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            )}
          </div>
        </div>

        {/* タブ行(モバイルのみ)。ロゴ行のすぐ下に、画面幅に応じて間隔が変わる
            中央揃えのタブを表示する。表示するのはタイムライン(ホーム画面 "/")のみ。
            下線の幅は各ラベル<span>の実測幅(offsetWidth)を元に、文字数(と実際の
            グリフ幅)に応じて動的に伸縮させる。 */}
        {showFeedTabs && (
          <div data-lime-feed-tab-row className="relative z-[1] sm:hidden">
            <div className="mx-auto max-w-5xl px-2 sm:px-4">
              <TabsList className="relative flex h-10 w-full items-stretch justify-center gap-0 rounded-none bg-transparent p-0 shadow-none">
                {(() => {
                  const activeIndex = FEED_TABS.findIndex((tab) => tab.value === activeFeedTab);
                  const activeMeasuredWidth = feedTabUnderlineWidths[activeFeedTab];
                  const activeUnderlineWidth = activeMeasuredWidth
                    ? activeMeasuredWidth + TAB_UNDERLINE_PADDING * 2
                    : 64;
                  const activeCenterPercent = ((Math.max(0, activeIndex) + 0.5) / FEED_TABS.length) * 100;

                  return (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute bottom-0 left-0 h-[3px] -translate-x-1/2 rounded-full bg-pink-500 will-change-[left,width] transition-[left,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                      style={{
                        left: `${activeCenterPercent}%`,
                        width: `${activeUnderlineWidth}px`,
                      }}
                    />
                  );
                })()}

                {FEED_TABS.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    onClick={() => handleFeedTabClick(tab.value)}
                    onDoubleClick={() => handleFeedTabDoubleClick(tab.value)}
                    className="feed-tabs-trigger relative h-10 min-w-[86px] flex-1 rounded-none border-0 bg-transparent px-3 text-base leading-none shadow-none outline-none transition-colors duration-150 hover:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=inactive]:bg-transparent"
                  >
                    <span
                      ref={registerFeedTabLabelRef(tab.value)}
                      className="whitespace-nowrap"
                    >
                      {tab.label}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </div>
        )}
      </Tabs>

      {renderMobileSearchPageTabs()}

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

      {/* サイドバーは header の外に置いて fixed をビューポート基準にする。 */}
      {renderMobileSidebar()}
    </>
  );
};