import { Heart, RefreshCw, Sparkles, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { useQueryClient } from '@tanstack/react-query';
import { PostComposer } from '@/components/feed/PostComposer';
import { PostCard } from '@/components/feed/PostCard';
import { PostCardSkeleton } from '@/components/feed/PostCardSkeleton';
import { useFeed } from '@/hooks/useFeed';
import { useIsPWA } from '@/hooks/useIsPWA';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/supabase';


function getRelativeLuminance(r: number, g: number, b: number) {
  const [rs, gs, bs] = [r, g, b].map((value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getTimelineThemeFromImageStats({
  averageLuminance,
  medianLuminance,
  lowerQuartileLuminance,
  brightRatio,
  darkRatio,
  veryDarkRatio,
}: {
  averageLuminance: number;
  medianLuminance: number;
  lowerQuartileLuminance: number;
  brightRatio: number;
  darkRatio: number;
  veryDarkRatio: number;
}): 'light' | 'dark' {
  /*
    タイムライン全体のテーマ判定。
    以前の判定は「写真っぽい背景を原則dark」に寄せすぎて、白壁・淡色背景までdarkになっていた。
    ここでは平均だけでなく、中央値と下位25%を見る。
    つまり「画面の大半が明るいか」「暗い部分がどれくらい混ざっているか」で決める。
  */
  const clearlyLightBackground =
    lowerQuartileLuminance >= 0.58 ||
    (medianLuminance >= 0.70 && darkRatio <= 0.18) ||
    (averageLuminance >= 0.68 && brightRatio >= 0.50 && darkRatio <= 0.24 && veryDarkRatio <= 0.08);

  return clearlyLightBackground ? 'light' : 'dark';
}


type TimelineVisualDesignCache = {
  hasHydrated: boolean;
  backgroundUrl: string | null;
  theme: 'light' | 'dark';
  themeSourceUrl: string | null;
};

// SPA内でホームから別ページへ移動して戻ってきた時だけ使う、Feed専用のメモリキャッシュ。
// ページ再読み込みではJS実行環境ごと破棄されるため、通常通りSupabaseと画像判定から読み直す。
const timelineVisualDesignCache: TimelineVisualDesignCache = {
  hasHydrated: false,
  backgroundUrl: null,
  theme: 'dark',
  themeSourceUrl: null,
};

function readCachedTimelineDesignForReturnNavigation() {
  if (!timelineVisualDesignCache.hasHydrated) return null;

  // Settings画面で背景を変更してから戻ったケースだけ、同一SPAセッション中のlocalStorage差分を拾う。
  // ハードリロード時は hasHydrated=false なので、ここは使われない。
  if (typeof window !== 'undefined') {
    const storedUrl = localStorage.getItem('lime_timeline_background_url');
    const storedEnabled =
      localStorage.getItem('lime_timeline_background_enabled') === 'true' || Boolean(storedUrl);
    const storedTheme = localStorage.getItem('lime_timeline_visual_theme') === 'light' ? 'light' : 'dark';

    if (storedEnabled && storedUrl && storedUrl !== timelineVisualDesignCache.backgroundUrl) {
      timelineVisualDesignCache.backgroundUrl = storedUrl;
      timelineVisualDesignCache.theme = storedTheme;
      timelineVisualDesignCache.themeSourceUrl = null;
    }

    if (!storedEnabled && timelineVisualDesignCache.backgroundUrl) {
      timelineVisualDesignCache.backgroundUrl = null;
      timelineVisualDesignCache.theme = 'dark';
      timelineVisualDesignCache.themeSourceUrl = null;
    }
  }

  return timelineVisualDesignCache;
}

export default function Feed() {
  const [activeTab, setActiveTab] = useState<'all' | 'following'>('all');
  const [isScrolled, setIsScrolled] = useState(false);
  const [timelineBackgroundUrl, setTimelineBackgroundUrl] = useState<string | null>(() => {
    const cachedDesign = readCachedTimelineDesignForReturnNavigation();
    return cachedDesign?.backgroundUrl ?? null;
  });
  const [timelineTheme, setTimelineTheme] = useState<'light' | 'dark'>(() => {
    const cachedDesign = readCachedTimelineDesignForReturnNavigation();
    return cachedDesign?.theme ?? 'dark';
  });

  const queryClient = useQueryClient();
  const isPWA = useIsPWA();
  const [isMobile, setIsMobile] = useState(false);
  const [initialMobileBackgroundFrame] = useState(() => {
    if (typeof window === 'undefined') {
      return { width: 0, height: 0 };
    }

    return {
      width: Math.ceil(window.innerWidth),
      height: Math.ceil(window.innerHeight),
    };
  });
  const isPWAMobile = isPWA && isMobile;

  const feedRootRef = useRef<HTMLDivElement>(null);
  const touchStartYRef = useRef(0);
  const horizontalTouchStartXRef = useRef(0);
  const horizontalTouchStartYRef = useRef(0);
  const isPullingRef = useRef(false);
  const pullDistanceRef = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showRefreshDone, setShowRefreshDone] = useState(false);

  const { 
    data, 
    isLoading, 
    isError, 
    fetchNextPage, 
    hasNextPage, 
    isFetchingNextPage 
  } = useFeed(activeTab);

  const { ref, inView } = useInView();

  useEffect(() => {
    const cachedDesign = readCachedTimelineDesignForReturnNavigation();
    if (cachedDesign) {
      setTimelineBackgroundUrl(cachedDesign.backgroundUrl);
      setTimelineTheme(cachedDesign.theme);
      return;
    }

    let cancelled = false;

    const fetchTimelineBackground = async () => {
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;

        const currentUser = authData.user;
        if (!currentUser) {
          if (!cancelled) {
            timelineVisualDesignCache.hasHydrated = true;
            timelineVisualDesignCache.backgroundUrl = null;
            timelineVisualDesignCache.theme = 'dark';
            timelineVisualDesignCache.themeSourceUrl = null;
            setTimelineBackgroundUrl(null);
          }
          return;
        }

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('timeline_background_url')
          .eq('id', currentUser.id)
          .maybeSingle();

        if (error) throw error;

        if (!cancelled) {
          const nextBackgroundUrl = (profile?.timeline_background_url as string | null) ?? null;
          timelineVisualDesignCache.hasHydrated = true;
          timelineVisualDesignCache.backgroundUrl = nextBackgroundUrl;
          if (!nextBackgroundUrl) {
            timelineVisualDesignCache.theme = 'dark';
            timelineVisualDesignCache.themeSourceUrl = null;
          }
          setTimelineBackgroundUrl(nextBackgroundUrl);
        }
      } catch (err) {
        console.error('Fetch timeline background error:', err);
        if (!cancelled) {
          timelineVisualDesignCache.hasHydrated = true;
          timelineVisualDesignCache.backgroundUrl = null;
          timelineVisualDesignCache.theme = 'dark';
          timelineVisualDesignCache.themeSourceUrl = null;
          setTimelineBackgroundUrl(null);
        }
      }
    };

    fetchTimelineBackground();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const previous = {
      backgroundImage: document.body.style.backgroundImage,
      backgroundSize: document.body.style.backgroundSize,
      backgroundPosition: document.body.style.backgroundPosition,
      backgroundRepeat: document.body.style.backgroundRepeat,
      backgroundAttachment: document.body.style.backgroundAttachment,
    };

    if (timelineBackgroundUrl) {
      const safeBackgroundUrl = `url("${timelineBackgroundUrl}")`;

      if (isMobile) {
        // iPhone PWA では body の background-attachment: fixed / background-size 計算が不安定になる。
        // モバイルは元コードと同じく、body 背景を使わず JSX 側の fixed レイヤーで固定表示する。
        document.body.style.backgroundImage = 'none';
        document.body.style.backgroundSize = '';
        document.body.style.backgroundPosition = '';
        document.body.style.backgroundRepeat = '';
        document.body.style.backgroundAttachment = '';
      } else {
        document.body.style.backgroundImage = safeBackgroundUrl;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
        document.body.style.backgroundRepeat = 'no-repeat';
        document.body.style.backgroundAttachment = 'fixed';
      }
    }

    return () => {
      document.body.style.backgroundImage = previous.backgroundImage;
      document.body.style.backgroundSize = previous.backgroundSize;
      document.body.style.backgroundPosition = previous.backgroundPosition;
      document.body.style.backgroundRepeat = previous.backgroundRepeat;
      document.body.style.backgroundAttachment = previous.backgroundAttachment;
    };
  }, [timelineBackgroundUrl, isMobile]);

  useEffect(() => {
    if (!timelineBackgroundUrl) {
      timelineVisualDesignCache.hasHydrated = true;
      timelineVisualDesignCache.backgroundUrl = null;
      timelineVisualDesignCache.theme = 'dark';
      timelineVisualDesignCache.themeSourceUrl = null;
      setTimelineTheme('dark');
      return;
    }

    if (
      timelineVisualDesignCache.hasHydrated &&
      timelineVisualDesignCache.backgroundUrl === timelineBackgroundUrl &&
      timelineVisualDesignCache.themeSourceUrl === timelineBackgroundUrl
    ) {
      setTimelineTheme(timelineVisualDesignCache.theme);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = timelineBackgroundUrl;

    img.onload = () => {
      if (cancelled || !img.naturalWidth || !img.naturalHeight) return;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        setTimelineTheme('dark');
        return;
      }

      // 背景全体の平均ではなく、複数点をざっくり見て「タイムラインとして読みやすい面」を決める。
      // 1px平均だけだと空/海/山の一部に引っ張られるので、低解像度に潰して平均輝度を見る。
      canvas.width = 48;
      canvas.height = 48;

      try {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const luminances: number[] = [];
        let luminanceSum = 0;
        let count = 0;
        let brightPixels = 0;
        let darkPixels = 0;
        let veryDarkPixels = 0;

        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3] / 255;
          if (alpha < 0.1) continue;

          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const lum = getRelativeLuminance(r, g, b);

          luminances.push(lum);
          luminanceSum += lum;
          count += 1;

          if (lum >= 0.68) brightPixels += 1;
          if (lum <= 0.30) darkPixels += 1;
          if (lum <= 0.16) veryDarkPixels += 1;
        }

        if (!cancelled) {
          luminances.sort((a, b) => a - b);

          const pick = (ratio: number) => {
            if (luminances.length === 0) return 0.5;
            const index = Math.min(luminances.length - 1, Math.max(0, Math.floor((luminances.length - 1) * ratio)));
            return luminances[index];
          };

          const averageLuminance = count > 0 ? luminanceSum / count : 0.5;
          const medianLuminance = pick(0.5);
          const lowerQuartileLuminance = pick(0.25);
          const brightRatio = count > 0 ? brightPixels / count : 0;
          const darkRatio = count > 0 ? darkPixels / count : 0;
          const veryDarkRatio = count > 0 ? veryDarkPixels / count : 0;

          const nextTheme = getTimelineThemeFromImageStats({
            averageLuminance,
            medianLuminance,
            lowerQuartileLuminance,
            brightRatio,
            darkRatio,
            veryDarkRatio,
          });

          timelineVisualDesignCache.hasHydrated = true;
          timelineVisualDesignCache.backgroundUrl = timelineBackgroundUrl;
          timelineVisualDesignCache.theme = nextTheme;
          timelineVisualDesignCache.themeSourceUrl = timelineBackgroundUrl;
          setTimelineTheme(nextTheme);
        }
      } catch (error) {
        console.warn('Timeline luminance sampling failed:', error);
        if (!cancelled) {
          timelineVisualDesignCache.hasHydrated = true;
          timelineVisualDesignCache.backgroundUrl = timelineBackgroundUrl;
          timelineVisualDesignCache.theme = 'dark';
          timelineVisualDesignCache.themeSourceUrl = timelineBackgroundUrl;
          setTimelineTheme('dark');
        }
      }
    };

    img.onerror = () => {
      if (!cancelled) {
        timelineVisualDesignCache.hasHydrated = true;
        timelineVisualDesignCache.backgroundUrl = timelineBackgroundUrl;
        timelineVisualDesignCache.theme = 'dark';
        timelineVisualDesignCache.themeSourceUrl = timelineBackgroundUrl;
        setTimelineTheme('dark');
      }
    };

    return () => {
      cancelled = true;
    };
  }, [timelineBackgroundUrl]);


  useEffect(() => {
    const hasBackground = Boolean(timelineBackgroundUrl);
    const payload = {
      theme: timelineTheme,
      hasTimelineBackground: hasBackground,
      url: timelineBackgroundUrl ?? '',
    };

    timelineVisualDesignCache.hasHydrated = true;
    timelineVisualDesignCache.backgroundUrl = timelineBackgroundUrl;
    timelineVisualDesignCache.theme = timelineTheme;
    if (!timelineBackgroundUrl) {
      timelineVisualDesignCache.themeSourceUrl = null;
    }

    localStorage.setItem('lime_timeline_visual_theme', timelineTheme);
    localStorage.setItem('lime_timeline_background_enabled', String(hasBackground));

    if (timelineBackgroundUrl) {
      localStorage.setItem('lime_timeline_background_url', timelineBackgroundUrl);
    } else {
      localStorage.removeItem('lime_timeline_background_url');
    }

    window.dispatchEvent(
      new CustomEvent('timeline-visual-theme-changed', {
        detail: payload,
      })
    );

    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel('timeline-visual-theme');
      channel.postMessage(payload);
      channel.close();
    }
  }, [timelineBackgroundUrl, timelineTheme]);

  useEffect(() => {
    const handleBackgroundChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string | null; theme?: string; hasTimelineBackground?: boolean }>).detail;
      const nextUrl = detail?.url ?? null;
      const nextTheme = detail?.theme === 'light' ? 'light' : 'dark';

      timelineVisualDesignCache.hasHydrated = true;
      timelineVisualDesignCache.backgroundUrl = nextUrl;
      timelineVisualDesignCache.theme = nextTheme;
      timelineVisualDesignCache.themeSourceUrl = null;

      setTimelineBackgroundUrl(nextUrl);
      setTimelineTheme(nextTheme);
    };

    window.addEventListener('timeline-background-changed', handleBackgroundChanged as EventListener);

    let channel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel('timeline-background');
      channel.onmessage = (event) => {
        const data = event.data as { url?: string | null; theme?: string } | undefined;
        if (!data) return;
        const nextUrl = data.url ?? null;
        const nextTheme = data.theme === 'light' ? 'light' : 'dark';

        timelineVisualDesignCache.hasHydrated = true;
        timelineVisualDesignCache.backgroundUrl = nextUrl;
        timelineVisualDesignCache.theme = nextTheme;
        timelineVisualDesignCache.themeSourceUrl = null;

        setTimelineBackgroundUrl(nextUrl);
        setTimelineTheme(nextTheme);
      };
    }

    return () => {
      window.removeEventListener('timeline-background-changed', handleBackgroundChanged as EventListener);
      channel?.close();
    };
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };

    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640);
    };

    handleScroll();
    checkMobile();

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', checkMobile);

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', checkMobile);
    };
  }, []);


  useEffect(() => {
    if (typeof window === 'undefined') return;

    const root = document.documentElement;
    const body = document.body;

    const horizontalGuardStyle = document.createElement('style');
    horizontalGuardStyle.setAttribute('data-limenote-horizontal-gesture-guard', 'true');
    horizontalGuardStyle.textContent = `
      .limenote-feed-horizontal-guard {
        max-width: 100%;
        min-width: 0;
        overscroll-behavior-x: none;
      }

      .limenote-feed-horizontal-guard *,
      .limenote-feed-horizontal-guard *::before,
      .limenote-feed-horizontal-guard *::after {
        min-width: 0;
        box-sizing: border-box;
      }

      .limenote-feed-tabs-shell {
        width: 100%;
        max-width: 100%;
        margin-left: 0 !important;
        margin-right: 0 !important;
      }

      .limenote-mobile-background-layer {
        max-width: 100vw !important;
      }

      @media (max-width: 639px) {
        .limenote-feed-horizontal-guard,
        .limenote-feed-horizontal-guard * {
          touch-action: pan-y pinch-zoom;
        }
      }
    `;
    document.head.appendChild(horizontalGuardStyle);

    // 別ページ遷移や古いピッカー処理で body overflow:hidden が残ると、ホーム復帰後に縦スクロールできなくなる。
    // html/body の overflow-x を直接いじると sticky header / Radix Dropdown / Tabs の再配置に巻き込まれるため、ここでは触らない。
    if (root.style.overflow === 'hidden') root.style.overflow = '';
    if (body.style.overflow === 'hidden') body.style.overflow = '';
    if (root.style.overflowY === 'hidden') root.style.overflowY = '';
    if (body.style.overflowY === 'hidden') body.style.overflowY = '';

    const forceScrollXToZero = () => {
      if (root.scrollLeft !== 0) root.scrollLeft = 0;
      if (body.scrollLeft !== 0) body.scrollLeft = 0;
    };

    const handleHorizontalTouchStart = (event: TouchEvent) => {
      const target = event.target as Node | null;
      if (!target || !feedRootRef.current?.contains(target)) return;
      if (event.touches.length !== 1) return;

      horizontalTouchStartXRef.current = event.touches[0].clientX;
      horizontalTouchStartYRef.current = event.touches[0].clientY;
    };

    const handleHorizontalTouchMove = (event: TouchEvent) => {
      const target = event.target as Node | null;
      if (!target || !feedRootRef.current?.contains(target)) return;
      if (event.touches.length !== 1) return;

      const currentX = event.touches[0].clientX;
      const currentY = event.touches[0].clientY;
      const diffX = currentX - horizontalTouchStartXRef.current;
      const diffY = currentY - horizontalTouchStartYRef.current;
      const absX = Math.abs(diffX);
      const absY = Math.abs(diffY);

      // Header は対象外にし、Feed 内だけ横ジェスチャーを強く止める。
      // 「明確な横スワイプだけ」ではなく、斜め横ブレでも横移動に寄った時点で止める。
      if (absX > 2 && absX >= absY * 0.15) {
        event.preventDefault();
        forceScrollXToZero();
      }
    };

    const handleHorizontalTouchEnd = () => {
      forceScrollXToZero();
    };

    const handleViewportChange = () => {
      window.requestAnimationFrame(forceScrollXToZero);
    };

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', handleViewportChange);
    document.addEventListener('touchstart', handleHorizontalTouchStart, { passive: true, capture: true });
    document.addEventListener('touchmove', handleHorizontalTouchMove, { passive: false, capture: true });
    document.addEventListener('touchend', handleHorizontalTouchEnd, { passive: true, capture: true });

    forceScrollXToZero();

    return () => {
      horizontalGuardStyle.remove();

      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('orientationchange', handleViewportChange);
      document.removeEventListener('touchstart', handleHorizontalTouchStart, true);
      document.removeEventListener('touchmove', handleHorizontalTouchMove, true);
      document.removeEventListener('touchend', handleHorizontalTouchEnd, true);
    };
  }, []);

  useEffect(() => {
    if (!isPWAMobile) {
      document.documentElement.style.overscrollBehaviorY = '';
      document.body.style.overscrollBehaviorY = '';
      return;
    }

    document.documentElement.style.overscrollBehaviorY = 'contain';
    document.body.style.overscrollBehaviorY = 'contain';

    const handleTouchStart = (e: TouchEvent) => {
      if (isRefreshing) return;
      if (window.scrollY !== 0) return;
      if (e.touches.length !== 1) return;

      touchStartYRef.current = e.touches[0].clientY;
      isPullingRef.current = true;
      pullDistanceRef.current = 0;
      setPullDistance(0);
      setShowRefreshDone(false);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isPullingRef.current) return;
      if (isRefreshing) return;
      if (e.touches.length !== 1) return;

      if (window.scrollY !== 0) {
        isPullingRef.current = false;
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }

      const currentY = e.touches[0].clientY;
      const diff = currentY - touchStartYRef.current;

      if (diff <= 0) {
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }

      e.preventDefault();

      const distance = Math.min(diff * 0.45, 86);
      pullDistanceRef.current = distance;
      setPullDistance(distance);
    };

    const handleTouchEnd = async () => {
      if (!isPullingRef.current) return;

      const shouldRefresh = pullDistanceRef.current >= 58;

      isPullingRef.current = false;

      if (!shouldRefresh) {
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }

      setIsRefreshing(true);
      setShowRefreshDone(false);
      pullDistanceRef.current = 58;
      setPullDistance(58);

      try {
        await queryClient.invalidateQueries({ queryKey: ['posts'] });
      } finally {
        setIsRefreshing(false);
        setShowRefreshDone(true);
        pullDistanceRef.current = 58;
        setPullDistance(58);

        setTimeout(() => {
          setShowRefreshDone(false);
          pullDistanceRef.current = 0;
          setPullDistance(0);
        }, 650);
      }
    };

    const handleTouchCancel = () => {
      isPullingRef.current = false;

      if (!isRefreshing) {
        pullDistanceRef.current = 0;
        setPullDistance(0);
        setShowRefreshDone(false);
      }
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchCancel);

    return () => {
      document.documentElement.style.overscrollBehaviorY = '';
      document.body.style.overscrollBehaviorY = '';

      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [isPWAMobile, isRefreshing, queryClient]);

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const restoreScrollPositionAfterControlInteraction = (scrollY: number) => {
    const restore = () => {
      if (Math.abs(window.scrollY - scrollY) > 1) {
        document.documentElement.scrollTop = scrollY;
        document.body.scrollTop = scrollY;
      }

      if (document.documentElement.scrollLeft !== 0) {
        document.documentElement.scrollLeft = 0;
      }
      if (document.body.scrollLeft !== 0) {
        document.body.scrollLeft = 0;
      }
    };

    window.requestAnimationFrame(restore);
    window.setTimeout(restore, 0);
    window.setTimeout(restore, 80);
  };

  const handleTabChange = (value: string) => {
    const previousScrollY = window.scrollY;
    setActiveTab(value as 'all' | 'following');
    restoreScrollPositionAfterControlInteraction(previousScrollY);
  };

  const allPosts = data?.pages.flatMap((page) => page) ?? [];
  const canReleaseToRefresh = pullDistance >= 58;
  const hasTimelineBackground = Boolean(timelineBackgroundUrl);

  return (
    <div
      ref={feedRootRef}
      className={`limenote-feed-horizontal-guard space-y-5 ${
        hasTimelineBackground
          ? timelineTheme === 'dark'
            ? 'pt-4 sm:pt-6 timeline-theme-scope timeline-theme-dark'
            : 'pt-4 sm:pt-6 timeline-theme-scope timeline-theme-light'
          : ''
      }`}
    >
      {hasTimelineBackground && isMobile && timelineBackgroundUrl && (
        <div
          className="limenote-mobile-background-layer pointer-events-none fixed left-0 top-0 z-0 overflow-hidden bg-background"
          style={{
            width: initialMobileBackgroundFrame.width ? `${initialMobileBackgroundFrame.width}px` : '100vw',
            height: initialMobileBackgroundFrame.height ? `${initialMobileBackgroundFrame.height}px` : '100vh',
          }}
          aria-hidden="true"
        >
          <img
            src={timelineBackgroundUrl}
            alt=""
            className="absolute left-0 top-0 h-full w-full object-cover"
            style={{ objectPosition: 'center center' }}
            draggable={false}
          />
          <div
            className={`absolute inset-0 ${timelineTheme === 'dark' ? 'bg-black/8' : 'bg-white/0'}`}
          />
        </div>
      )}
      {hasTimelineBackground && (
        <style>{`
          .timeline-theme-scope {
            color: hsl(var(--foreground));
          }

          .timeline-theme-dark {
            --background: 222 47% 7%;
            --foreground: 210 40% 98%;
            --card: 222 36% 8%;
            --card-foreground: 210 40% 98%;
            --popover: 222 36% 9%;
            --popover-foreground: 210 40% 98%;
            --muted: 217 28% 17%;
            --muted-foreground: 215 24% 82%;
            --border: 217 18% 28%;
            --timeline-link: 330 96% 66%;
          }

          .timeline-theme-light {
            --background: 0 0% 100%;
            --foreground: 24 12% 11%;
            --card: 0 0% 100%;
            --card-foreground: 24 12% 11%;
            --popover: 0 0% 100%;
            --popover-foreground: 24 12% 11%;
            --muted: 24 16% 92%;
            --muted-foreground: 24 8% 42%;
            --border: 24 10% 82%;
            --timeline-link: 330 88% 48%;
          }

          .timeline-theme-scope .text-pink-500 {
            color: hsl(var(--timeline-link)) !important;
          }

          .timeline-tabs-list {
            position: relative;
            overflow: hidden;
            gap: 0 !important;
            border: 0 !important;
            outline: none !important;
            box-shadow: none !important;
          }

          .timeline-tabs-trigger {
            width: 100% !important;
            height: 2.25rem !important;
            min-width: 0 !important;
            border: 0 !important;
            outline: none !important;
            box-shadow: none !important;
          }

          .timeline-theme-dark .timeline-tabs-list {
            background: rgba(7, 8, 12, 0.72) !important;
            color: rgba(255, 255, 255, 0.92) !important;
          }

          .timeline-theme-dark .timeline-tabs-trigger {
            color: rgba(255, 255, 255, 0.54) !important;
          }

          .timeline-theme-dark .timeline-tabs-trigger[data-state="active"] {
            background: rgba(255, 255, 255, 0.115) !important;
            color: rgba(255, 255, 255, 0.96) !important;
          }

          .timeline-theme-dark .timeline-tabs-trigger[data-state="inactive"]:hover {
            background: rgba(255, 255, 255, 0.06) !important;
            color: rgba(255, 255, 255, 0.74) !important;
          }

          .timeline-theme-light .timeline-tabs-list {
            background: rgba(255, 255, 255, 0.72) !important;
            color: rgba(24, 22, 20, 0.88) !important;
          }

          .timeline-theme-light .timeline-tabs-trigger {
            color: rgba(24, 22, 20, 0.48) !important;
          }

          .timeline-theme-light .timeline-tabs-trigger[data-state="active"] {
            background: rgba(24, 22, 20, 0.10) !important;
            color: rgba(24, 22, 20, 0.94) !important;
          }

          .timeline-theme-light .timeline-tabs-trigger[data-state="inactive"]:hover {
            background: rgba(24, 22, 20, 0.055) !important;
            color: rgba(24, 22, 20, 0.66) !important;
          }
        `}</style>
      )}
      {isPWAMobile && (
        <div
          className="pointer-events-none fixed left-0 right-0 top-0 z-[80] flex justify-center transition-all duration-150"
          style={{
            transform: `translateY(${pullDistance > 0 || isRefreshing || showRefreshDone ? pullDistance : -56}px)`,
            opacity: pullDistance > 0 || isRefreshing || showRefreshDone ? 1 : 0,
          }}
        >
          <div className="mt-3 inline-flex h-10 items-center gap-2 rounded-full border border-border/60 bg-card/95 px-4 text-sm font-bold text-muted-foreground shadow-lg backdrop-blur">
            <RefreshCw
              className={`h-4 w-4 ${
                isRefreshing
                  ? 'animate-spin'
                  : canReleaseToRefresh || showRefreshDone
                    ? 'rotate-180'
                    : ''
              } transition-transform duration-150`}
            />
            <span>
              {isRefreshing
                ? '更新中...'
                : showRefreshDone
                  ? '更新しました'
                  : canReleaseToRefresh
                    ? '離して更新'
                    : '引っ張って更新'}
            </span>
          </div>
        </div>
      )}

      {/* 
        コンテナの gap はPC表示時に影響を与えないよう sm:gap-0 にリセットしています。
      */}
      <div className="relative z-[1] flex flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-0 px-1">
        
        {/* 
          PC表示（sm以上）のときは横並びになり余白は不要なため、
          スマホ表示のときだけ下に余白を作る「mb-2.5 sm:mb-0」を追加しました。
        */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-1.5">
          
          {/* 公式サイト・お問い合わせボタンのコンテナ（スマホでは上部） */}
          {!hasTimelineBackground && (
            <div className="flex flex-wrap items-center gap-1.5 order-1 sm:order-2 mb-2.5 sm:mb-0">
              <a 
                href="https://toumeron.github.io/LimeNoteJP/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center h-6 px-3 rounded-full bg-pink-600/15 hover:bg-pink-600/45 text-pink-600 text-xs font-bold transition-colors whitespace-nowrap select-none leading-none border-none shadow-none"
              >
                ↗︎ 公式サイト
              </a>

              <a 
                href="https://forms.gle/1FUHzrWL38iVbUju5" 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center h-6 px-3 rounded-full bg-pink-600/15 hover:bg-pink-600/25 text-pink-600 text-xs font-bold transition-colors whitespace-nowrap select-none leading-none border-none shadow-none"
              >
                ↗︎ お問い合わせ
              </a>
            </div>
          )}

          {/* タイムライン文字と、スマホ用LimeNoteBetaのコンテナ（スマホでは下部） */}
          <div className="flex items-center gap-2 order-2 sm:order-1">
            {!hasTimelineBackground && (
              <h1 className="text-2xl font-black font-display leading-none select-none">
                タイムライン
              </h1>
            )}

            {/* スマホ専用の LimeNoteBeta ボックス */}
            <span className="ribbon-tag sm:hidden">
              <Sparkles className="h-3 w-3" />
              LimeNoteBeta 1.7
            </span>
          </div>

        </div>

        {/* PC専用の LimeNoteBeta ボックス */}
        <span className="ribbon-tag hidden sm:inline-flex">
          <Sparkles className="h-3 w-3" />
          LimeNoteBeta 1.7
        </span>
      </div>

      <div className="relative z-[1]">
        <PostComposer timelineGlass={hasTimelineBackground} />
      </div>

      {/* 特別扱い：ヘッダー統合タブ */}
      <div
        className={`limenote-feed-tabs-shell sticky top-0 transition-all duration-300 py-3 px-0 border-none pointer-events-none ${
          isScrolled 
            ? 'z-[2147483647] h-16 flex items-center justify-center' 
            : 'z-[2147483647] bg-transparent h-auto'
        }`}
        style={{ zIndex: 2147483647 }}
      >
        <div className="max-w-md mx-auto w-full pointer-events-auto">
          <Tabs 
            defaultValue="all" 
            className="w-full border-none shadow-none" 
            onValueChange={handleTabChange}
          >
            <TabsList
              className={`grid w-full grid-cols-2 h-11 items-center justify-center overflow-hidden rounded-full p-1 ring-0 border-none backdrop-blur-2xl ${
                hasTimelineBackground
                  ? 'timeline-tabs-list shadow-none'
                  : 'bg-muted/80 border-none shadow-none'
              }`}
              style={{
                boxShadow: 'none',
                border: '0',
                WebkitBackdropFilter: hasTimelineBackground ? 'blur(34px) saturate(190%)' : undefined,
                backdropFilter: hasTimelineBackground ? 'blur(34px) saturate(190%)' : undefined,
              }}
            >
              <TabsTrigger 
                value="all" 
                className={`h-9 w-full justify-center rounded-full px-6 font-bold transition-all duration-200 shadow-none border-none outline-none focus-visible:ring-0 ${
                  hasTimelineBackground
                    ? 'timeline-tabs-trigger'
                    : 'data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=inactive]:text-foreground/70 data-[state=inactive]:hover:bg-background/40'
                }`}
              >
                最新
              </TabsTrigger>
              <TabsTrigger 
                value="following" 
                className={`h-9 w-full justify-center rounded-full px-6 font-bold transition-all duration-200 shadow-none border-none outline-none focus-visible:ring-0 ${
                  hasTimelineBackground
                    ? 'timeline-tabs-trigger'
                    : 'data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=inactive]:text-foreground/70 data-[state=inactive]:hover:bg-background/40'
                }`}
              >
                フォロー中
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className={hasTimelineBackground ? "relative z-[1] space-y-0 pt-2 sm:space-y-4" : "relative z-[1] space-y-4 pt-2"}>
        {isLoading && (
          <div className="space-y-4">
            <PostCardSkeleton />
            <PostCardSkeleton />
          </div>
        )}

        {isError && (
          <div className="rounded-3xl border border-destructive/20 bg-destructive/5 p-6 text-center">
            <p className="text-sm text-destructive font-bold">読み込みに失敗しました。</p>
          </div>
        )}

        {!isLoading && allPosts.length === 0 && (
          <div className="rounded-3xl border border-dashed border-border/50 bg-card/40 p-10 text-center text-muted-foreground">
            {activeTab === 'all' ? 'まだ投稿がありません' : 'フォロー中の投稿はありません'}
          </div>
        )}

        {allPosts.map((post) => (
          <div key={`${activeTab}-${post.id}`} className="animate-float-up">
            <PostCard post={post} timelineGlass={hasTimelineBackground} />
          </div>
        ))}

        <div ref={ref} className="py-10 flex justify-center">
          {isFetchingNextPage ? (
            <div className="flex items-center gap-2 text-muted-foreground animate-pulse">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm font-medium">読み込み中...</span>
            </div>
          ) : hasNextPage ? (
            <div className="h-10" />
          ) : allPosts.length > 0 ? (
            <p className="text-xs text-muted-foreground/60">すべての投稿を読み込みました</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}