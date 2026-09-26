import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import {
  LogOut,
  Settings as SettingsIcon,
  User as UserIcon,
  Search,
  Bell,
  MessageSquare,
  Images,
  UserRound,
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

// 下線の左右に足す余白(px)。文字幅ぴったりだと窮屈に見えるため少し広げる。
const TAB_UNDERLINE_PADDING = 10;

function readStoredActiveFeedTab(): FeedTabValue {
  if (typeof window === 'undefined') return 'all';
  const stored = localStorage.getItem(ACTIVE_FEED_TAB_STORAGE_KEY);
  return stored === 'following' ? 'following' : stored === 'trending' ? 'trending' : 'all';
}

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

// タブ文字列の実測幅(px)を計測し、下線の幅を文字数に応じて伸縮させるためのフック。
// ref経由でDOM上のラベル<span>の offsetWidth を読み取るだけなので、フォントや
// 文字種(かな/カナ/英数字混在)が変わっても実際の見た目通りの幅になる。
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
function useMobileHeaderVisibility(enabled: boolean) {
  const [isHidden, setIsHidden] = useState(false);

  useEffect(() => {
    if (!enabled) {
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
  }, [enabled]);

  return isHidden;
}

// サイドバー(aside)本体を data 属性で参照するためのセレクタ。
// aside は createPortal で document.body 直下に置かれているため、
// React の state 更新(1フレーム遅れる)を待たずに、ドラッグ中でも
// 直接 DOM を触って追従表示させるためにこれで探す。
const MOBILE_SIDEBAR_SELECTOR = '[data-lime-mobile-sidebar="true"]';

function useMobileDrawerMotion(isOpen: boolean, onOpenChange: (open: boolean) => void) {
  const rootRef = useRef<HTMLElement | null>(null);
  const gestureRef = useRef({
    active: false,
    startedAtX: 0,
    startedAtY: 0,
    startShift: 0,
    horizontal: false,
    startedAtEdge: false,
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

    const width = getDrawerWidth();
    const clamped = Math.max(0, Math.min(width, shift));
    const isRevealed = clamped > 0;

    root.style.transition = animate
      ? 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1), border-radius 320ms cubic-bezier(0.22, 1, 0.36, 1), clip-path 320ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 320ms cubic-bezier(0.22, 1, 0.36, 1)'
      : 'none';
    // Safari/WebKitでは、要素に3D変換(translate3d/translateZ)とclip-pathを
    // 同時に指定すると、独立した合成レイヤーに昇格することでclip-pathによる
    // クリップが実際の描画に反映されない(DevTools上はスタイルが付与されて
    // 見えても、見た目には角丸が出ない)既知の問題がある。ここでは2D変換の
    // translateX に変更することでこれを回避する。
    root.style.transform = `translateX(${clamped}px)`;
    root.style.borderRadius = isRevealed ? '42px 0 0 42px' : '0';
    // overflow: hidden + border-radius だけでは、環境によって(rootの高さの
    // 決まり方やスクロールコンテナの構成次第で)クリップが実際の描画に反映
    // されないことがある。clip-path はオーバーフローの挙動に関係なく
    // 要素自身の描画を直接その形状で切り抜くため、より確実に角丸を反映できる。
    // border-radius/overflowと併用しても副作用はないのでどちらも残す。
    const clipShape = isRevealed
      ? 'inset(0px 0px 0px 0px round 42px 0px 0px 42px)'
      : 'inset(0px round 0px)';
    root.style.setProperty('clip-path', clipShape, 'important');
    root.style.setProperty('-webkit-clip-path', clipShape, 'important');
    root.style.overflow = isRevealed ? 'hidden' : '';
    root.style.boxShadow = isRevealed ? '-10px 0 28px rgba(0,0,0,0.34)' : 'none';
    // will-change: transform も3D変換と同様に独立した合成レイヤーへの昇格を
    // 促し、Safariでのclip-path未反映の原因になり得るため、ここでは明示的な
    // will-changeの指定はしない(常時 auto のまま)。
    root.style.willChange = 'auto';
    // サイドバーを開いている間はタイムライン側の縦スクロールを停止する。
    // touch-action:none はクリック/タップ自体は維持しつつ、スクロールジェスチャーだけを止める。
    root.style.touchAction = isRevealed ? 'none' : 'auto';
    root.style.overscrollBehavior = isRevealed ? 'none' : 'auto';

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
      html.style.overflowX = 'hidden';
      setRootVisual(isOpen ? getDrawerWidth() : 0, true);
    } else {
      root.style.removeProperty('transform');
      root.style.removeProperty('transition');
      root.style.removeProperty('border-radius');
      root.style.removeProperty('overflow');
      root.style.removeProperty('clip-path');
      root.style.removeProperty('-webkit-clip-path');
      root.style.removeProperty('box-shadow');
      root.style.removeProperty('will-change');
      root.style.removeProperty('touch-action');
      root.style.removeProperty('overscroll-behavior');
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
      root.style.removeProperty('border-radius');
      root.style.removeProperty('overflow');
      root.style.removeProperty('clip-path');
      root.style.removeProperty('-webkit-clip-path');
      root.style.removeProperty('box-shadow');
      root.style.removeProperty('will-change');
      root.style.removeProperty('touch-action');
      root.style.removeProperty('overscroll-behavior');
    };
  }, [isOpen]);

  // サイドバーが開いている間、背後のページ(タイムライン等)がスクロールできて
  // しまう問題への対策。root要素への touch-action:none だけでは、ネストした
  // スクロールコンテナやブラウザ差でスクロールを止めきれないことがあるため、
  // body を position:fixed で固定する定番の手法で確実にロックする。
  // fixed にする直前のスクロール位置を保存し、閉じるときにその位置へ戻すことで
  // 「閉じたら先頭に戻ってしまう」という副作用も防ぐ。
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!window.matchMedia('(max-width: 639px)').matches) return;

    const body = document.body;

    if (isOpen) {
      scrollLockYRef.current = window.scrollY;
      body.style.position = 'fixed';
      body.style.top = `-${scrollLockYRef.current}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.width = '100%';
    } else {
      const y = scrollLockYRef.current;
      body.style.position = '';
      body.style.top = '';
      body.style.left = '';
      body.style.right = '';
      body.style.width = '';
      window.scrollTo(0, y);
    }

    return () => {
      body.style.position = '';
      body.style.top = '';
      body.style.left = '';
      body.style.right = '';
      body.style.width = '';
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
      };
    };

    // 「画面端」とみなす範囲。この範囲から始めた場合は、従来通り
    // 少しの移動量で反応する軽いジェスチャーとして扱う(誤操作の心配が
    // 少ない代わりに、素早く反応してほしい場所)。
    const EDGE_ZONE = 32;

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
      if (!isMobile() || event.touches.length === 0) return;

      // ボタン・リンク・入力系の操作はDrawerジェスチャーより優先する。
      // 特にBottomNavはbody直下のportalなので、ここでtouchmoveを奪わない。
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          'button, a, input, textarea, select, option, [role="button"], [data-radix-collection-item]'
        )
      ) {
        resetGesture();
        return;
      }

      // 横スクロールするギャラリー等の内部からは、ドロワー用のジェスチャーとして奪わない。
      if (isInsideHorizontalScroller(target)) {
        resetGesture();
        return;
      }

      const touch = event.touches[0];
      const width = getDrawerWidth();

      // スワイプで開ける範囲は画面全体に広げる。ただしそれだけだと、縦スクロール中
      // など他の操作中に誤って開いてしまいやすくなるため、開始位置が画面端
      // (EDGE_ZONE)かどうかを記録しておき、touchmove/touchend側の判定基準
      // (閾値)をそれぞれで変える(端は軽く、それ以外は厳しめに)。
      const startedAtEdge = touch.clientX <= EDGE_ZONE;
      const canOpenFromAnywhere = !isOpen;
      // 開いている間は、サイドバー内のどこ(ボタン等を除く)からドラッグを始めても
      // 閉じられるようにする(右端の細い帯だけに限定しない)。
      const canCloseFromMain = isOpen && touch.clientX <= width;

      if (!canOpenFromAnywhere && !canCloseFromMain) {
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
      };
      root.style.transition = 'none';
    };

    const handleTouchMove = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      if (!gesture.active || event.touches.length === 0) return;

      const touch = event.touches[0];
      const dx = touch.clientX - gesture.startedAtX;
      const dy = touch.clientY - gesture.startedAtY;

      if (!gesture.horizontal) {
        // 方向を確定させるまでの「遊び」。小さすぎると指の僅かなブレで
        // 縦/横を誤判定しやすく、その誤判定のたびに(以前は)320msの
        // アニメーション付きで巻き戻していたため「ワンテンポ遅れる」
        // 体感になっていた。閾値を単純な絶対値比較にし、誤判定時は
        // 何もアニメーションさせずに諦めるだけにする。
        //
        // 画面端(またはサイドバーを閉じる操作)から始めた場合は従来通り
        // 軽い動きで反応させる。それ以外(画面中央寄りなど)から始めた
        // 「開く」ジェスチャーは、スワイプ範囲を画面全体に広げたことで
        // 縦スクロール等との誤操作が増えやすいため、より大きく・より
        // 横方向がはっきりした動きだけをドロワー操作として採用する。
        const isLenient = gesture.startedAtEdge || isOpen;
        const DIRECTION_LOCK_THRESHOLD = isLenient ? 6 : 18;
        const HORIZONTAL_DOMINANCE_RATIO = isLenient ? 1 : 2.2;

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

      cancelScheduledVisualUpdate();

      if (!gesture.horizontal) {
        resetGesture();
        setRootVisual(isOpen ? width : 0, true);
        return;
      }

      const currentShift = Math.max(0, Math.min(width, gesture.startShift + deltaX));

      // 画面中央寄りから始めた「開く」ジェスチャーは、端から始めた場合より
      // 少し厳しめの確定条件にして、誤操作による意図しない全開を防ぐ。
      const openRatioThreshold = gesture.startedAtEdge ? 0.32 : 0.45;
      const openFlickThreshold = gesture.startedAtEdge ? 34 : 60;

      const nextOpen = isOpen
        ? currentShift >= width * 0.55 && deltaX > -34
        : currentShift >= width * openRatioThreshold || deltaX > openFlickThreshold;

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
  }, [isOpen, onOpenChange]);
}

export const Header = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const timelineChrome = useTimelineChrome(location.pathname);
  const { activeFeedTab, changeActiveFeedTab } = useActiveFeedTab();
  const { registerLabelRef: registerFeedTabLabelRef, widths: feedTabUnderlineWidths } = useFeedTabUnderlineWidths();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  useMobileDrawerMotion(isMobileSidebarOpen, setIsMobileSidebarOpen);

  useEffect(() => {
    const handleViewportChange = () => {
      if (window.innerWidth >= 640) {
        setIsMobileSidebarOpen(false);
      }
    };

    window.addEventListener('resize', handleViewportChange);
    return () => window.removeEventListener('resize', handleViewportChange);
  }, []);

  const isSearchPage = normalizeAppPath(location.pathname) === '/u/LimeBiz';
  const isChatPage = normalizeAppPath(location.pathname) === '/chat';
  const hideHeaderOnMobileProfile = isGithubPagesProfilePath(location.pathname);
  const useTimelineChromeDesign = timelineChrome.enabled;
  const isTimelineDark = timelineChrome.theme === 'dark';
  // タブ、およびヘッダーの開閉挙動は「タイムライン(ホーム画面)のみ」。
  // 投稿詳細やそれ以外のページでは、タブも出さず、ヘッダーは常に表示したままにする。
  const showFeedTabs = isHomeTimelinePath(location.pathname);

  const isHiddenOnMobile = useMobileHeaderVisibility(showFeedTabs);

  // 既にアクティブなタブをもう一度クリックしたときは、
  // (Radix Tabsのvalueが変わらずonValueChangeが発火しないため)
  // ここで明示的にページ最上部へスクロールする。
  const handleFeedTabTriggerClick = (value: FeedTabValue) => {
    if (value !== activeFeedTab) return;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

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
  // ページの縦スクロール位置の固定/復元は useMobileDrawerMotion 内の
  // body position:fixed ロックが一元的に担当するため、ここでは行わない。
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


  // モバイルサイドバーには、このHeader内ですでに存在が確認できる実在ページだけを表示する。
  const mobileSidebarItems = user
    ? [
        {
          label: 'プロフィール',
          icon: UserRound,
          onClick: () => navigate(`/u/${user.username}`),
        },
        {
          label: '検索',
          icon: Search,
          onClick: () => navigate('/search'),
        },
        {
          label: '通知',
          icon: Bell,
          onClick: () => navigate('/notifications'),
        },
        {
          label: 'LimeAI',
          icon: MessageSquare,
          onClick: () => navigate('/chat'),
        },
        {
          label: 'フォト',
          icon: Images,
          onClick: () => navigate('/media'),
        },
        {
          label: '設定',
          icon: SettingsIcon,
          onClick: () => navigate('/settings'),
        },
      ]
    : [];

  const renderMobileSidebar = () => {
    if (!user || typeof document === 'undefined') return null;

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
      <aside
        aria-hidden={!isMobileSidebarOpen}
        data-lime-mobile-sidebar="true"
        className={cn(
          // サイドバー自体の幅を従来より広く確保する(全画面にはしない)。
          // 角丸は本画面側(root要素、setRootVisual内のborder-radius)に
          // 付けるものなので、ここ(サイドバー本体)には付けない。
          'fixed inset-y-0 left-0 z-[100] flex w-[clamp(300px,78vw,420px)] flex-col border-r sm:hidden',
          sidebarDarkClasses,
          isMobileSidebarOpen
            ? 'visible pointer-events-auto'
            : 'invisible pointer-events-none'
        )}
        style={{ visibility: isMobileSidebarOpen ? 'visible' : 'hidden' }}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 px-[clamp(24px,8vw,68px)] pt-[max(18px,env(safe-area-inset-top))]">
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
                return (
                  <button
                    key={item.label}
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
        </div>
      </aside>,
      document.body
    );
  };



  return (
    <>
      <header
      data-lime-app-header="true"
      data-lime-mobile-profile-header-hidden={hideHeaderOnMobileProfile ? 'true' : undefined}
      data-lime-chat-header-hidden-mobile={isChatPage ? 'true' : undefined}
      className={cn(
        isChatPage
          ? 'fixed left-0 right-0 top-0 z-[500] border-b backdrop-blur-md'
          : 'sticky top-0 z-[500] border-b backdrop-blur-md',
        // モバイル×ホーム画面のときだけ、スクロール方向に応じてヘッダー全体を
        // スライドして隠す。他のページ、およびPC(sm以上)では常に translate-y-0。
        'transition-transform duration-300 ease-out sm:translate-y-0',
        isHiddenOnMobile ? '-translate-y-full' : 'translate-y-0',
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

          .feed-tabs-trigger[data-state='active'] .feed-tabs-underline {
            display: block;
          }

          .feed-tabs-trigger[data-state='inactive'] .feed-tabs-underline {
            display: none;
          }

          /* 下線の幅はJSでラベルの実測幅+パディングを計算してインラインstyleで
             指定するため、幅の変化を滑らかに見せるためのtransitionのみここで定義する。 */
          .feed-tabs-underline {
            transition: width 200ms ease-out;
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
        `}
      </style>

      {/*
        タブの選択状態(activeFeedTab)は、PC用(ロゴとアバターの間)とモバイル用
        (アイコン行の下・別行)の2つのTabsListで共有する。Profile.tsxと同じく、
        1つのTabsルートの中に用途別のTabsListを複数置いて出し分ける構成。
      */}
      <Tabs value={activeFeedTab} onValueChange={(value) => changeActiveFeedTab(value as FeedTabValue)}>
        {/* ロゴ＋アバターの行。
            - モバイル: アバター(またはログインボタン)を左、ロゴは行全体の中央に絶対配置。
            - PC(sm以上): ロゴを左端、アバターを右端、その間(中央)にタブを配置。 */}
        <div className="relative mx-auto flex h-14 max-w-5xl items-center px-3 sm:h-16 sm:px-4">
          <div className="sm:order-3">
            <div className="sm:hidden">
              {renderMobileAccountControl()}
            </div>
            <div className="hidden sm:block">
              {renderDesktopAccountControl()}
            </div>
          </div>

          <div
            onClick={handleLogoClick}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer sm:static sm:left-auto sm:top-auto sm:order-1 sm:translate-x-0 sm:translate-y-0"
          >
            <Logo />
          </div>

          {/* ロゴとアバターの間を埋める領域。PCではここが常にflex-1で、
              ホーム画面のときだけ中身としてタブを表示する(タブが無いページでも
              アバターが右端に固定されるよう、枠自体は常に確保しておく)。 */}
          <div className="hidden sm:order-2 sm:flex sm:min-w-0 sm:flex-1 sm:justify-center">
            {showFeedTabs && (
              <TabsList className="grid w-full max-w-[300px] grid-cols-3 rounded-2xl bg-muted/50 p-1">
                {FEED_TABS.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    onClick={() => handleFeedTabTriggerClick(tab.value)}
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
          <div className="relative z-[1] sm:hidden">
            <div className="mx-auto max-w-5xl px-2 sm:px-4">
              <TabsList className="flex h-10 w-full items-stretch justify-center gap-0 rounded-none bg-transparent p-0 shadow-none">
                {FEED_TABS.map((tab) => {
                  const measuredWidth = feedTabUnderlineWidths[tab.value];
                  const underlineWidth = measuredWidth
                    ? measuredWidth + TAB_UNDERLINE_PADDING * 2
                    : undefined;

                  return (
                    <TabsTrigger
                      key={tab.value}
                      value={tab.value}
                      onClick={() => handleFeedTabTriggerClick(tab.value)}
                      className="feed-tabs-trigger relative h-10 min-w-[86px] flex-1 rounded-none border-0 bg-transparent px-3 text-base leading-none shadow-none outline-none transition-none duration-0 hover:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=inactive]:bg-transparent"
                    >
                      <span
                        ref={registerFeedTabLabelRef(tab.value)}
                        className="whitespace-nowrap"
                      >
                        {tab.label}
                      </span>
                      <span
                        className="feed-tabs-underline absolute bottom-0 left-1/2 h-[3px] w-16 -translate-x-1/2 rounded-full bg-pink-500"
                        style={underlineWidth ? { width: `${underlineWidth}px` } : undefined}
                      />
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>
          </div>
        )}
      </Tabs>

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