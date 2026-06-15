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

export default function Feed() {
  const [activeTab, setActiveTab] = useState<'all' | 'following'>('all');
  const [isScrolled, setIsScrolled] = useState(false);
  const [timelineBackgroundUrl, setTimelineBackgroundUrl] = useState<string | null>(null);
  const [timelineTitleTone, setTimelineTitleTone] = useState<'light' | 'dark'>('dark');
  const titleRef = useRef<HTMLHeadingElement>(null);

  const queryClient = useQueryClient();
  const isPWA = useIsPWA();
  const [isMobile, setIsMobile] = useState(false);
  const isPWAMobile = isPWA && isMobile;

  const touchStartYRef = useRef(0);
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
    let cancelled = false;

    const fetchTimelineBackground = async () => {
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;

        const currentUser = authData.user;
        if (!currentUser) {
          if (!cancelled) setTimelineBackgroundUrl(null);
          return;
        }

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('timeline_background_url')
          .eq('id', currentUser.id)
          .maybeSingle();

        if (error) throw error;

        if (!cancelled) {
          setTimelineBackgroundUrl((profile?.timeline_background_url as string | null) ?? null);
        }
      } catch (err) {
        console.error('Fetch timeline background error:', err);
        if (!cancelled) setTimelineBackgroundUrl(null);
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
      document.body.style.backgroundImage = `url("${timelineBackgroundUrl}")`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundRepeat = 'no-repeat';
      document.body.style.backgroundAttachment = 'fixed';
    }

    return () => {
      document.body.style.backgroundImage = previous.backgroundImage;
      document.body.style.backgroundSize = previous.backgroundSize;
      document.body.style.backgroundPosition = previous.backgroundPosition;
      document.body.style.backgroundRepeat = previous.backgroundRepeat;
      document.body.style.backgroundAttachment = previous.backgroundAttachment;
    };
  }, [timelineBackgroundUrl]);

  useEffect(() => {
    if (!timelineBackgroundUrl) {
      setTimelineTitleTone('dark');
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = timelineBackgroundUrl;

    const sampleTitleBackground = () => {
      if (cancelled || !img.naturalWidth || !img.naturalHeight) return;

      const rect = titleRef.current?.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const sampleX = rect ? rect.left + rect.width / 2 : viewportWidth * 0.18;
      const sampleY = rect ? rect.top + rect.height / 2 : viewportHeight * 0.18;

      const scale = Math.max(
        viewportWidth / img.naturalWidth,
        viewportHeight / img.naturalHeight
      );
      const renderedWidth = img.naturalWidth * scale;
      const renderedHeight = img.naturalHeight * scale;
      const offsetX = (viewportWidth - renderedWidth) / 2;
      const offsetY = (viewportHeight - renderedHeight) / 2;

      const sourceX = Math.max(
        0,
        Math.min(img.naturalWidth - 1, Math.round((sampleX - offsetX) / scale))
      );
      const sourceY = Math.max(
        0,
        Math.min(img.naturalHeight - 1, Math.round((sampleY - offsetY) / scale))
      );

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      canvas.width = 1;
      canvas.height = 1;
      ctx.drawImage(img, sourceX, sourceY, 1, 1, 0, 0, 1, 1);

      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      const srgb = [r, g, b].map((value) => {
        const v = value / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      const luminance = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
      const contrastWithWhite = 1.05 / (luminance + 0.05);
      const contrastWithBlack = (luminance + 0.05) / 0.05;

      setTimelineTitleTone(contrastWithWhite >= contrastWithBlack ? 'light' : 'dark');
    };

    img.onload = () => {
      sampleTitleBackground();
      window.addEventListener('resize', sampleTitleBackground);
      window.addEventListener('scroll', sampleTitleBackground, { passive: true });
    };

    img.onerror = () => {
      if (!cancelled) setTimelineTitleTone('dark');
    };

    return () => {
      cancelled = true;
      window.removeEventListener('resize', sampleTitleBackground);
      window.removeEventListener('scroll', sampleTitleBackground);
    };
  }, [timelineBackgroundUrl]);

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

  const allPosts = data?.pages.flatMap((page) => page) ?? [];
  const canReleaseToRefresh = pullDistance >= 58;
  const hasTimelineBackground = Boolean(timelineBackgroundUrl);

  return (
    <div className="space-y-5">
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-0 px-1">
        
        {/* 
          PC表示（sm以上）のときは横並びになり余白は不要なため、
          スマホ表示のときだけ下に余白を作る「mb-2.5 sm:mb-0」を追加しました。
        */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-1.5">
          
          {/* 公式サイト・お問い合わせボタンのコンテナ（スマホでは上部） */}
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

          {/* タイムライン文字と、スマホ用LimeNoteBetaのコンテナ（スマホでは下部） */}
          <div className="flex items-center gap-2 order-2 sm:order-1">
            <h1
              ref={titleRef}
              className={`text-2xl font-black font-display leading-none select-none ${
                hasTimelineBackground
                  ? timelineTitleTone === 'light'
                    ? 'text-white'
                    : 'text-neutral-950'
                  : ''
              }`}
            >
              タイムライン
            </h1>

            {/* スマホ専用の LimeNoteBeta ボックス */}
            <span className="ribbon-tag sm:hidden">
              <Sparkles className="h-3 w-3" />
              LimeNoteBeta 1.6
            </span>
          </div>

        </div>

        {/* PC専用の LimeNoteBeta ボックス */}
        <span className="ribbon-tag hidden sm:inline-flex">
          <Sparkles className="h-3 w-3" />
          LimeNoteBeta 1.6
        </span>
      </div>

      <PostComposer timelineGlass={hasTimelineBackground} />

      {/* 特別扱い：ヘッダー統合タブ */}
      <div
        className={`sticky top-0 transition-all duration-300 py-3 -mx-5 px-5 border-none pointer-events-none ${
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
            onValueChange={(v) => setActiveTab(v as 'all' | 'following')}
          >
            <TabsList
              className={`grid w-full grid-cols-2 h-11 items-center justify-center rounded-full p-1 border-none ring-0 backdrop-blur-2xl ${
                hasTimelineBackground
                  ? 'bg-white/85 text-slate-950 shadow-none dark:bg-black/70 dark:text-white'
                  : 'bg-muted/80 shadow-none'
              }`}
              style={{
                boxShadow: 'none',
                WebkitBackdropFilter: hasTimelineBackground ? 'blur(30px) saturate(185%)' : undefined,
                backdropFilter: hasTimelineBackground ? 'blur(30px) saturate(185%)' : undefined,
              }}
            >
              <TabsTrigger 
                value="all" 
                className="h-9 rounded-full px-6 font-bold transition-all duration-200 
                           data-[state=active]:bg-foreground data-[state=active]:text-background 
                           data-[state=inactive]:text-foreground/70 data-[state=inactive]:hover:bg-background/40
                           shadow-none border-none outline-none focus-visible:ring-0"
              >
                最新
              </TabsTrigger>
              <TabsTrigger 
                value="following" 
                className="h-9 rounded-full px-6 font-bold transition-all duration-200 
                           data-[state=active]:bg-foreground data-[state=active]:text-background 
                           data-[state=inactive]:text-foreground/70 data-[state=inactive]:hover:bg-background/40
                           shadow-none border-none outline-none focus-visible:ring-0"
              >
                フォロー中
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className={hasTimelineBackground ? "space-y-0 pt-2 sm:space-y-4" : "space-y-4 pt-2"}>
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