import { RefreshCw, Sparkles, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { useQueryClient } from '@tanstack/react-query';
import { PostComposer } from '@/components/feed/PostComposer';
import { PostCard } from '@/components/feed/PostCard';
import { PostCardSkeleton } from '@/components/feed/PostCardSkeleton';
import { useRecommendedFeed } from '@/hooks/useRecommendedFeed';
import { useTimelineFeed } from '@/hooks/useTimelineFeed';
import { normalizeTimelineBlueskyPost } from '@/lib/timelinePaging';
import { useIsPWA } from '@/hooks/useIsPWA';
import { supabase } from '@/lib/supabase';
import { getPostById } from '@/api/posts';
import type { PostWithAuthor } from '@/types';
import {
  fetchTrendingJapaneseBlueskyPosts,
  mergePostsByCreatedAt,
} from '@/lib/bluesky';


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

// 最新/フォロー中に加えて、Blueskyの日本語トレンド投稿(いいね500以上)を
// ランダムに表示する「トレンド」タブを追加。
type FeedTab = 'all' | 'following' | 'recommended' | 'trending';

const FEED_TAB_ORDER: FeedTab[] = ['all', 'following', 'recommended', 'trending'];

// 投稿の入口アニメーションは、ブラウザを再読み込みした直後の最初の表示だけ実行する。
// SPA内のタブ切り替え・再訪では再実行しない。モジュール再評価はハードリロードで起こる。
let feedInitialFloatAnimationHasPlayed = false;
type FeedPostInsertPayload = {
  id?: string;
  parent_id?: string | null;
  is_quote?: boolean | null;
};

const ESTIMATED_POST_HEIGHT = 360;
const VIRTUAL_OVERSCAN = 4;
const MIN_VIRTUALIZED_POSTS = 12;
// トレンドタブで1回に取得する件数の目安。
const TRENDING_PAGE_LIMIT = 30;

// 最新/フォロー中/トレンドの選択状態はヘッダー側に移設したため、Feed側はこのキーと
// カスタムイベント('lime-active-feed-tab-changed')経由で状態を受け取るだけにする。
// (Headerコンポーネント側の実装と対になっている)
const ACTIVE_FEED_TAB_STORAGE_KEY = 'lime_active_feed_tab';

function readStoredActiveFeedTab(): FeedTab {
  if (typeof window === 'undefined') return 'all';
  const stored = localStorage.getItem(ACTIVE_FEED_TAB_STORAGE_KEY);
  return stored === 'following' ? 'following' : stored === 'recommended' ? 'recommended' : stored === 'trending' ? 'trending' : 'all';
}

const insertPostAtLocalFeedHead = (current: PostWithAuthor[], post: PostWithAuthor) => {
  if (current.some((item) => item.id === post.id)) return current;
  return [post, ...current].slice(0, 12);
};

const isTimelineRootPost = (post: FeedPostInsertPayload | null | undefined) => (
  Boolean(post?.id) && !(Boolean(post?.parent_id) && post?.is_quote !== true)
);

const mergeRealtimePostsWithFetchedPosts = (
  realtimePosts: PostWithAuthor[],
  fetchedPosts: PostWithAuthor[]
) => {
  const fetchedPostIds = new Set(fetchedPosts.map((post) => post.id));
  return [
    ...realtimePosts.filter((post) => !fetchedPostIds.has(post.id)),
    ...fetchedPosts,
  ];
};

const fetchRealtimePostById = async (postId: string) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const post = await getPostById(postId).catch((error) => {
      if (attempt === 2) {
        console.error('Fetch realtime post failed:', error);
      }
      return null;
    });

    if (post) return post;

    await new Promise((resolve) => window.setTimeout(resolve, 180 * (attempt + 1)));
  }

  return null;
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
  const [activeTab, setActiveTab] = useState<FeedTab>(() => readStoredActiveFeedTab());
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
  const isMobileRef = useRef(false);
  const resizeRafRef = useRef<number | null>(null);
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
  const postListRef = useRef<HTMLDivElement>(null);

  // タブ切り替え時のフィード本体アニメーションは横方向だけに限定する。
  // タブごとにスクロール位置が異なっていても、縦方向(transformY)は一切動かさず、
  // 新しいフィードだけを左右からスライドさせる。
  const previousFeedTabForAnimationRef = useRef<FeedTab>(activeTab);
  const feedTabAnimationFrameRef = useRef<number | null>(null);
  const feedTabAnimationTimerRef = useRef<number | null>(null);
  const feedTabAnimationContentRef = useRef<HTMLDivElement | null>(null);

  // タブごとのスクロール位置はこのFeedコンポーネントが生きている間だけ保持する。
  // localStorageには保存しないため、ページを再読み込みするとリセットされる。
  const feedTabScrollPositionsRef = useRef<Partial<Record<FeedTab, number>>>({});
  const activeFeedTabForScrollRef = useRef<FeedTab>(activeTab);
  const pendingFeedTabScrollRestoreRef = useRef<number | null>(null);
  const initialFeedTabRef = useRef<FeedTab>(activeTab);
  const [shouldPlayInitialFloatAnimation, setShouldPlayInitialFloatAnimation] = useState(
    () => !feedInitialFloatAnimationHasPlayed
  );
  const touchStartYRef = useRef(0);
  const isPullingRef = useRef(false);
  const pullDistanceRef = useRef(0);
  const realtimeHandledPostIdsRef = useRef<Set<string>>(new Set());
  const currentUserIdRef = useRef<string | null>(null);
  const followedUserIdsRef = useRef<Set<string>>(new Set());
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showRefreshDone, setShowRefreshDone] = useState(false);
  const [virtualViewport, setVirtualViewport] = useState(() => ({
    scrollY: typeof window === 'undefined' ? 0 : window.scrollY,
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
    listTop: 0,
  }));
  const [realtimePostsByTab, setRealtimePostsByTab] = useState<Record<FeedTab, PostWithAuthor[]>>({
    all: [],
    following: [],
    trending: [],
    recommended: [],
  });
  // --- トレンドタブ(Bluesky・日本語・いいね500以上・ランダム表示)用の状態 ---
  const [trendingPosts, setTrendingPosts] = useState<PostWithAuthor[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(false);
  const [trendingHasMore, setTrendingHasMore] = useState(true);
  const trendingLoadingRef = useRef(false);
  const trendingRequestIdRef = useRef(0);
  const trendingCursorRef = useRef<string | null>(null);
  const trendingHasMoreRef = useRef(true);

  const timelineFeed = useTimelineFeed(activeTab === 'following' ? 'following' : 'all', activeTab !== 'recommended');
  const recommendedFeed = useRecommendedFeed(activeTab === 'recommended');
  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching,
    isFetchNextPageError,
  } = activeTab === 'recommended' ? recommendedFeed : timelineFeed;

  const { ref, inView } = useInView({
    rootMargin: '300px 0px 500px 0px',
  });

  const fetchedPosts = useMemo(() => data?.pages.flatMap((page) => page.posts) ?? [], [data]);
  const limePosts = useMemo(
    () => mergeRealtimePostsWithFetchedPosts(
      realtimePostsByTab[activeTab === 'trending' ? 'all' : activeTab],
      fetchedPosts
    ),
    [activeTab, fetchedPosts, realtimePostsByTab]
  );

  // トレンドタブのときはLime投稿・時系列Bluesky投稿と混ぜず、
  // トレンド専用に取得したランダム順の投稿だけをそのまま表示する
  // (createdAt順に並び替えてしまうと「ランダム表示」の意図が崩れるため)。
  const allPosts = useMemo(() => {
    if (activeTab === 'trending') return trendingPosts;
    if (activeTab === 'recommended') return fetchedPosts;
    return mergePostsByCreatedAt(limePosts);
  }, [activeTab, limePosts, trendingPosts, fetchedPosts]);

  const normalizeBlueskyPostForFeed = useCallback(normalizeTimelineBlueskyPost, []);

  // トレンドタブ用: Bluesky検索(日本語・いいね500以上)からランダムな投稿を取得する。
  // reset=true で1ページ目からやり直し(タブ初回表示・引っ張って更新時)、
  // reset=false で「もっと読み込む」として続きを取得する。
  const loadTrendingPosts = useCallback(async (reset = false) => {
    if (trendingLoadingRef.current) return;
    if (!reset && !trendingHasMoreRef.current) return;

    const requestId = ++trendingRequestIdRef.current;
    trendingLoadingRef.current = true;
    setTrendingLoading(true);

    if (reset) {
      trendingCursorRef.current = null;
      trendingHasMoreRef.current = true;
      setTrendingHasMore(true);
    }

    try {
      const page = await fetchTrendingJapaneseBlueskyPosts({
        cursor: reset ? null : trendingCursorRef.current,
        limit: TRENDING_PAGE_LIMIT,
      });

      if (requestId !== trendingRequestIdRef.current) return;

      trendingCursorRef.current = page.cursor;
      trendingHasMoreRef.current = Boolean(page.cursor) && page.posts.length > 0;
      setTrendingHasMore(trendingHasMoreRef.current);

      const normalized = page.posts.map(normalizeBlueskyPostForFeed);

      setTrendingPosts((current) => {
        const base = reset ? [] : current;
        const seen = new Set(base.map((post) => post.id));
        const merged = [...base];

        normalized.forEach((post) => {
          if (seen.has(post.id)) return;
          seen.add(post.id);
          merged.push(post);
        });

        return merged;
      });
    } catch (error) {
      console.error('Fetch trending Bluesky posts failed:', error);
      if (reset && requestId === trendingRequestIdRef.current) {
        setTrendingPosts([]);
        trendingHasMoreRef.current = false;
        setTrendingHasMore(false);
      }
    } finally {
      if (requestId === trendingRequestIdRef.current) {
        trendingLoadingRef.current = false;
        setTrendingLoading(false);
      }
    }
  }, [normalizeBlueskyPostForFeed]);

  // トレンドタブへ切り替えた最初のタイミングで1回だけ読み込む。
  useEffect(() => {
    if (activeTab === 'trending' && trendingPosts.length === 0 && !trendingLoadingRef.current) {
      void loadTrendingPosts(true);
    }
  }, [activeTab, trendingPosts.length, loadTrendingPosts]);

  useEffect(() => {
    let cancelled = false;

    const loadFollowingState = async () => {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) {
        console.error('Fetch current user for realtime feed failed:', authError);
        return;
      }

      const currentUserId = authData.user?.id ?? null;
      currentUserIdRef.current = currentUserId;
      followedUserIdsRef.current = new Set();

      if (!currentUserId) return;

      const { data: follows, error } = await supabase
        .from('follows')
        .select('followee_id')
        .eq('follower_id', currentUserId);

      if (cancelled) return;

      if (error) {
        console.error('Fetch following users for realtime feed failed:', error);
        followedUserIdsRef.current = new Set();
        return;
      }

      followedUserIdsRef.current = new Set(
        (follows ?? [])
          .map((follow) => follow.followee_id)
          .filter((id): id is string => Boolean(id))
      );
    };

    loadFollowingState();

    return () => {
      cancelled = true;
    };
  }, []);

  const addPostToTab = useCallback((targetTab: 'all' | 'following', post: PostWithAuthor) => {
    setRealtimePostsByTab((current) => ({
      ...current,
      [targetTab]: insertPostAtLocalFeedHead(current[targetTab], post),
    }));
  }, []);

  const showIncomingPostInAllVisibleFeeds = useCallback(async (postId: string) => {
    const handledPostKey = `incoming:${postId}`;
    if (realtimeHandledPostIdsRef.current.has(handledPostKey)) return;
    realtimeHandledPostIdsRef.current.add(handledPostKey);

    if (realtimeHandledPostIdsRef.current.size > 60) {
      const oldestPostKey = realtimeHandledPostIdsRef.current.values().next().value as string | undefined;
      if (oldestPostKey) realtimeHandledPostIdsRef.current.delete(oldestPostKey);
    }

    const post = await fetchRealtimePostById(postId);

    if (!post) {
      realtimeHandledPostIdsRef.current.delete(handledPostKey);
      return;
    }

    addPostToTab('all', post);

    const currentUserId = currentUserIdRef.current;
    const shouldShowInFollowing =
      Boolean(currentUserId && post.author.id === currentUserId) ||
      followedUserIdsRef.current.has(post.author.id);

    if (shouldShowInFollowing) {
      addPostToTab('following', post);
    }
  }, [addPostToTab]);
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
    return () => {
      const postList = postListRef.current;
      if (postList instanceof HTMLDivElement) {
        postList.style.removeProperty('transition');
        postList.style.removeProperty('transform');
      }

      if (feedTabAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(feedTabAnimationFrameRef.current);
        feedTabAnimationFrameRef.current = null;
      }

      if (feedTabAnimationTimerRef.current !== null) {
        window.clearTimeout(feedTabAnimationTimerRef.current);
        feedTabAnimationTimerRef.current = null;
      }
    };
  }, []);

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
    const updateMobileState = () => {
      const nextIsMobile = window.innerWidth < 640;
      if (isMobileRef.current === nextIsMobile) return;

      isMobileRef.current = nextIsMobile;
      setIsMobile(nextIsMobile);
    };

    const checkMobile = () => {
      if (resizeRafRef.current !== null) return;

      resizeRafRef.current = window.requestAnimationFrame(() => {
        resizeRafRef.current = null;
        updateMobileState();
      });
    };

    updateMobileState();

    window.addEventListener('resize', checkMobile);

    return () => {
      if (resizeRafRef.current !== null) {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }

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
        if (activeTab === 'trending') {
          await loadTrendingPosts(true);
        } else {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['posts'] }),
            queryClient.invalidateQueries({ queryKey: ['feed'] }),
          ]);
        }
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
  }, [isPWAMobile, isRefreshing, queryClient, activeTab, loadTrendingPosts]);

  useEffect(() => {
    let cancelled = false;

    const channel = supabase
      .channel('feed-new-posts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'posts' },
        async (payload) => {
          const insertedPost = payload.new as FeedPostInsertPayload | null;
          const postId = insertedPost?.id;

          if (!postId || !isTimelineRootPost(insertedPost)) return;
          if (cancelled) return;
          await showIncomingPostInAllVisibleFeeds(postId);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [showIncomingPostInAllVisibleFeeds]);

  useEffect(() => {
    // トレンドタブは既存のトレンド専用ページングだけを進める。
    if (activeTab === 'trending') {
      if (inView && trendingHasMore && !trendingLoading) {
        void loadTrendingPosts(false);
      }
      return;
    }

    // A single request owns both sources and publishes the merged page only
    // when its lookahead is ready. Do not launch overlapping pages/refetches.
    if (inView && hasNextPage && !isFetching && !isFetchNextPageError) {
      void fetchNextPage();
    }
  }, [
    activeTab, inView, hasNextPage, isFetching, isFetchNextPageError, fetchNextPage,
    trendingHasMore, trendingLoading, loadTrendingPosts,
  ]);

  useLayoutEffect(() => {
    const postContent = feedTabAnimationContentRef.current;
    const previousTab = previousFeedTabForAnimationRef.current;

    if (!(postContent instanceof HTMLDivElement)) return;

    // View Transitionを使うモバイルでは、JSのtransformを重ねない。
    // 二重アニメーションによるブレ・残像を防ぎ、フィードはView Transition側だけで滑らせる。
    const isMobileViewport =
      window.matchMedia?.('(max-width: 639px)').matches ?? window.innerWidth < 640;
    if (isMobileViewport) {
      previousFeedTabForAnimationRef.current = activeTab;
      postContent.style.removeProperty('transition');
      postContent.style.removeProperty('transform');
      postContent.style.removeProperty('will-change');
      if (feedTabAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(feedTabAnimationFrameRef.current);
        feedTabAnimationFrameRef.current = null;
      }
      if (feedTabAnimationTimerRef.current !== null) {
        window.clearTimeout(feedTabAnimationTimerRef.current);
        feedTabAnimationTimerRef.current = null;
      }
      return;
    }

    // 初回マウントではタブ切替アニメーションを実行しない。
    if (previousTab === activeTab) return;

    const previousIndex = FEED_TAB_ORDER.indexOf(previousTab);
    const nextIndex = FEED_TAB_ORDER.indexOf(activeTab);
    const startX = nextIndex > previousIndex ? 24 : -24;

    previousFeedTabForAnimationRef.current = activeTab;

    if (feedTabAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(feedTabAnimationFrameRef.current);
      feedTabAnimationFrameRef.current = null;
    }
    if (feedTabAnimationTimerRef.current !== null) {
      window.clearTimeout(feedTabAnimationTimerRef.current);
      feedTabAnimationTimerRef.current = null;
    }

    // PC版の既存挙動はそのまま維持する。
    postContent.style.transition = 'none';
    postContent.style.transform = `translate3d(${startX}px, 0, 0)`;
    postContent.style.willChange = 'transform';

    feedTabAnimationFrameRef.current = window.requestAnimationFrame(() => {
      feedTabAnimationFrameRef.current = window.requestAnimationFrame(() => {
        feedTabAnimationFrameRef.current = null;
        postContent.style.transition = 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)';
        postContent.style.transform = 'translate3d(0, 0, 0)';

        feedTabAnimationTimerRef.current = window.setTimeout(() => {
          feedTabAnimationTimerRef.current = null;
          postContent.style.removeProperty('transition');
          postContent.style.removeProperty('transform');
          postContent.style.removeProperty('will-change');
        }, 440);
      });
    });

    return () => {
      if (feedTabAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(feedTabAnimationFrameRef.current);
        feedTabAnimationFrameRef.current = null;
      }
    };
  }, [activeTab]);

  useEffect(() => {
    return () => {
      if (feedTabAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(feedTabAnimationFrameRef.current);
        feedTabAnimationFrameRef.current = null;
      }
      if (feedTabAnimationTimerRef.current !== null) {
        window.clearTimeout(feedTabAnimationTimerRef.current);
        feedTabAnimationTimerRef.current = null;
      }
    };
  }, []);

  // 現在のタブのスクロール位置を常時記憶する。タブ切替後のscrollToもauto復元なので、
  // このscrollイベントで記憶位置が混ざっても、activeFeedTabForScrollRefが正しいタブを指す。
  useEffect(() => {
    activeFeedTabForScrollRef.current = activeTab;

    const rememberScrollPosition = () => {
      feedTabScrollPositionsRef.current[activeFeedTabForScrollRef.current] = window.scrollY;
    };

    rememberScrollPosition();
    window.addEventListener('scroll', rememberScrollPosition, { passive: true });

    return () => {
      window.removeEventListener('scroll', rememberScrollPosition);
    };
  }, [activeTab]);

  // バグ修正: タブ切替(モバイルのView Transition)はHeader側のflushSync内で
  // 先にactiveTabだけを更新し、実際のwindow.scrollToはその後に実行される。
  // そのため、このコンポーネントが新しいタブとして再描画される最初のフレームでは
  // virtualViewport.scrollYがまだ古いタブのスクロール位置のままになっている。
  // 仮想化(virtualRange)の計算はこのscrollYを使って「今どの投稿を描画するか」を
  // 決めているため、古いスクロール位置のまま新しいタブの投稿数に対して範囲計算を
  // してしまうと、範囲がずれて投稿が一時的に描画されず、タブ切替アニメーションの
  // 最中に投稿が消えたように見えるバグの原因になっていた。
  // ここでは実際のscrollTo実行を待たず、Header側が計算済みの復元先スクロール位置
  // (pendingFeedTabScrollRestoreRef)を先読みしてvirtualViewportへ同期させることで、
  // 新しいタブの内容が最初のフレームから正しい範囲で描画されるようにする。
  const previousVirtualizedTabRef = useRef<FeedTab>(activeTab);

  useLayoutEffect(() => {
    if (previousVirtualizedTabRef.current === activeTab) return;
    previousVirtualizedTabRef.current = activeTab;

    if (typeof window === 'undefined') return;

    const listTop = postListRef.current
      ? postListRef.current.getBoundingClientRect().top + window.scrollY
      : 0;
    const predictedScrollY = pendingFeedTabScrollRestoreRef.current ?? window.scrollY;

    setVirtualViewport({
      scrollY: predictedScrollY,
      height: window.innerHeight,
      listTop,
    });
  }, [activeTab]);

  // 初回ローディング表示(スケルトン)を出すかどうかは、タブごとに参照する
  // データソースが違うため個別に判定する。
  const isInitialLoading = activeTab === 'trending'
    ? trendingLoading && allPosts.length === 0
    : isLoading && allPosts.length === 0;

  // 初回表示の「ふわっと浮かび上がる」アニメーションは、再読み込み後の最初のフィード表示だけに限定。
  // タブを切り替えた後のフィードには animate-float-up を付けない。
  useEffect(() => {
    if (feedInitialFloatAnimationHasPlayed || !shouldPlayInitialFloatAnimation) return;

    // 初回ロード中に別タブへ切り替えた場合は、その切り替えを境に初回演出を消費済みにする。
    if (activeTab !== initialFeedTabRef.current) {
      feedInitialFloatAnimationHasPlayed = true;
      setShouldPlayInitialFloatAnimation(false);
      return;
    }

    if (isInitialLoading || allPosts.length === 0) return;

    // CSSアニメーションが開始できる時間を確保してからフラグを消す。
    // これ以降のタブ切り替え・再訪・追加読み込みではanimate-float-upを付けない。
    const timer = window.setTimeout(() => {
      feedInitialFloatAnimationHasPlayed = true;
      setShouldPlayInitialFloatAnimation(false);
    }, 800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeTab, allPosts.length, isInitialLoading, shouldPlayInitialFloatAnimation]);

  useEffect(() => {
    let frame: number | null = null;

    const updateVirtualViewport = () => {
      frame = null;
      const listTop = postListRef.current
        ? postListRef.current.getBoundingClientRect().top + window.scrollY
        : 0;

      setVirtualViewport((current) => {
        const next = {
          scrollY: window.scrollY,
          height: window.innerHeight,
          listTop,
        };

        if (
          Math.abs(current.scrollY - next.scrollY) < 24 &&
          current.height === next.height &&
          Math.abs(current.listTop - next.listTop) < 8
        ) {
          return current;
        }

        return next;
      });
    };

    const scheduleUpdate = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(updateVirtualViewport);
    };

    scheduleUpdate();
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }

      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, []);

  // 最新/フォロー中/トレンドの切り替えUIはヘッダー(Header.tsx)に移設した。
  // Header側でタブがクリックされると 'lime-active-feed-tab-changed' が
  // dispatchされるので、ここではタブごとのスクロール位置を記憶・復元しながらactiveTabを更新する。
  // 別タブへの切り替えでページ最上部へ強制移動はしない。
  useEffect(() => {
    const restorePendingScrollPosition = () => {
      const target = pendingFeedTabScrollRestoreRef.current;
      if (target === null) return;
      window.scrollTo({ top: target, behavior: 'auto' });
    };

    const handleActiveFeedTabChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: string }>).detail;
      const nextTab: FeedTab =
        detail?.tab === 'following' ? 'following' : detail?.tab === 'recommended' ? 'recommended' : detail?.tab === 'trending' ? 'trending' : 'all';
      const previousTab = activeFeedTabForScrollRef.current;

      // 切り替え前のタブの位置を確定保存。
      feedTabScrollPositionsRef.current[previousTab] = window.scrollY;
      activeFeedTabForScrollRef.current = nextTab;

      // 未訪問タブはトップから、訪問済みタブは最後に見ていた位置から復帰する。
      const savedPosition = feedTabScrollPositionsRef.current[nextTab];
      pendingFeedTabScrollRestoreRef.current = savedPosition ?? 0;
      if (savedPosition === undefined) {
        feedTabScrollPositionsRef.current[nextTab] = 0;
      }

      setActiveTab(nextTab);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== ACTIVE_FEED_TAB_STORAGE_KEY) return;
      const nextTab = readStoredActiveFeedTab();
      const previousTab = activeFeedTabForScrollRef.current;
      feedTabScrollPositionsRef.current[previousTab] = window.scrollY;
      activeFeedTabForScrollRef.current = nextTab;
      pendingFeedTabScrollRestoreRef.current = feedTabScrollPositionsRef.current[nextTab] ?? 0;
      if (feedTabScrollPositionsRef.current[nextTab] === undefined) {
        feedTabScrollPositionsRef.current[nextTab] = 0;
      }
      setActiveTab(nextTab);
    };

    window.addEventListener('lime-active-feed-tab-changed', handleActiveFeedTabChanged as EventListener);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener('lime-active-feed-tab-changed', handleActiveFeedTabChanged as EventListener);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // タブ内容のDOMが更新されたあと、記憶位置を2フレームかけて復元する。
  // behavior:'auto' のため、縦方向のスクロールアニメーションは発生せず、
  // 横方向のタブ切替アニメーションだけが見える。
  useEffect(() => {
    const target = pendingFeedTabScrollRestoreRef.current;
    if (target === null) return;

    const isMobileViewport =
      window.matchMedia?.('(max-width: 639px)').matches ?? window.innerWidth < 640;

    // モバイルのView Transition経路ではHeader側ですでに新スナップショット前に
    // 正しい位置へ同期復元しているため、ここで追加の2フレーム復元を重ねない。
    if (isMobileViewport) {
      pendingFeedTabScrollRestoreRef.current = null;
      return;
    }

    let frame1: number | null = null;
    let frame2: number | null = null;

    frame1 = window.requestAnimationFrame(() => {
      frame1 = null;
      window.scrollTo({ top: target, behavior: 'auto' });

      frame2 = window.requestAnimationFrame(() => {
        frame2 = null;
        window.scrollTo({ top: target, behavior: 'auto' });
        pendingFeedTabScrollRestoreRef.current = null;
      });
    });

    return () => {
      if (frame1 !== null) window.cancelAnimationFrame(frame1);
      if (frame2 !== null) window.cancelAnimationFrame(frame2);
    };
  }, [activeTab, allPosts.length]);

  // ============================================================================
  // --- 仮想化（virtualization）用の実測高さキャッシュ ---
  // 以前は ESTIMATED_POST_HEIGHT（360px固定）だけを使って、どの投稿を
  // 描画範囲に含めるかを計算していた。しかし YouTube 埋め込みを含む投稿は
  // 実際には360pxよりかなり高くなるため、この固定値との差が積み重なると
  // 「画面内にまだ表示されている投稿が範囲外と誤判定されてアンマウントされ、
  // 直後にまた範囲内と判定されて再マウントされる」ことが起きる。
  // 再マウントのたびに YouTube の iframe は最初から読み込み直しになるため、
  // これが「埋め込みの挙動がおかしい／震えて見える」バグの原因になっていた。
  // ここでは ResizeObserver で各投稿の実際の高さを計測してキャッシュし、
  // 範囲計算にその実測値を使うことで、想定と実際の高さのズレを解消する。
  // 見た目・レイアウト・スタイルは一切変更していない。
  // ============================================================================
  const postHeightsRef = useRef<Map<string, number>>(new Map());
  const [heightVersion, setHeightVersion] = useState(0);
  const postSizeObserverRef = useRef<ResizeObserver | null>(null);
  const postElementsByIdRef = useRef<Map<string, Element>>(new Map());
  const postIdsByElementRef = useRef<Map<Element, string>>(new Map());

  const getPostSizeObserver = useCallback(() => {
    if (postSizeObserverRef.current) return postSizeObserverRef.current;
    if (typeof ResizeObserver === 'undefined') return null;

    postSizeObserverRef.current = new ResizeObserver((entries) => {
      let didChange = false;

      entries.forEach((entry) => {
        const postId = postIdsByElementRef.current.get(entry.target);
        if (!postId) return;

        const borderBoxSize = Array.isArray(entry.borderBoxSize)
          ? entry.borderBoxSize[0]
          : (entry.borderBoxSize as unknown as ResizeObserverSize | undefined);
        const measuredHeight = borderBoxSize?.blockSize ?? entry.contentRect.height;

        if (!measuredHeight || measuredHeight <= 0) return;

        const roundedHeight = Math.round(measuredHeight);
        const previousHeight = postHeightsRef.current.get(postId);

        if (previousHeight !== roundedHeight) {
          postHeightsRef.current.set(postId, roundedHeight);
          didChange = true;
        }
      });

      if (didChange) {
        setHeightVersion((version) => version + 1);
      }
    });

    return postSizeObserverRef.current;
  }, []);

  const registerPostElement = useCallback((postId: string, element: HTMLDivElement | null) => {
    const observer = getPostSizeObserver();
    const previousElement = postElementsByIdRef.current.get(postId);

    if (previousElement && previousElement !== element) {
      postIdsByElementRef.current.delete(previousElement);
      observer?.unobserve(previousElement);
      postElementsByIdRef.current.delete(postId);
    }

    if (!element) return;

    postElementsByIdRef.current.set(postId, element);

    if (!observer) {
      // ResizeObserver未対応環境では、初回描画時点の高さだけを採用する。
      const measuredHeight = element.getBoundingClientRect().height;
      if (measuredHeight > 0) {
        const roundedHeight = Math.round(measuredHeight);
        if (postHeightsRef.current.get(postId) !== roundedHeight) {
          postHeightsRef.current.set(postId, roundedHeight);
          setHeightVersion((version) => version + 1);
        }
      }
      return;
    }

    postIdsByElementRef.current.set(element, postId);
    observer.observe(element);
  }, [getPostSizeObserver]);

  useEffect(() => () => {
    postSizeObserverRef.current?.disconnect();
    postSizeObserverRef.current = null;
    postElementsByIdRef.current.clear();
    postIdsByElementRef.current.clear();
  }, []);

  const canReleaseToRefresh = pullDistance >= 58;
  const hasTimelineBackground = Boolean(timelineBackgroundUrl);
  const shouldVirtualizePosts = allPosts.length > MIN_VIRTUALIZED_POSTS;
  const virtualRange = useMemo(() => {
    if (!shouldVirtualizePosts) {
      return {
        start: 0,
        end: allPosts.length,
        topSpacer: 0,
        bottomSpacer: 0,
      };
    }

    const viewportTop = Math.max(0, virtualViewport.scrollY - virtualViewport.listTop);
    const viewportBottom = viewportTop + virtualViewport.height;

    // 各投稿の実測済み高さ（未計測なら ESTIMATED_POST_HEIGHT で代用）を使って
    // 累積オフセットを求める。固定値だけで範囲を決めていた以前の実装と違い、
    // 動画埋め込みなど高さのばらつきが大きい投稿があっても、範囲判定と
    // 実際の表示位置がズレにくくなる。
    const postHeights = postHeightsRef.current;
    const heights = allPosts.map((post) => postHeights.get(post.id) ?? ESTIMATED_POST_HEIGHT);

    let rawStart = 0;
    let offsetBeforeRawStart = 0;
    while (rawStart < heights.length && offsetBeforeRawStart + heights[rawStart] < viewportTop) {
      offsetBeforeRawStart += heights[rawStart];
      rawStart += 1;
    }

    const start = Math.max(0, rawStart - VIRTUAL_OVERSCAN);

    let topSpacer = 0;
    for (let i = 0; i < start; i += 1) {
      topSpacer += heights[i];
    }

    let rawEnd = start;
    let offsetBeforeRawEnd = topSpacer;
    while (rawEnd < heights.length && offsetBeforeRawEnd < viewportBottom) {
      offsetBeforeRawEnd += heights[rawEnd];
      rawEnd += 1;
    }

    const end = Math.min(allPosts.length, rawEnd + VIRTUAL_OVERSCAN);

    let bottomSpacer = 0;
    for (let i = end; i < heights.length; i += 1) {
      bottomSpacer += heights[i];
    }

    return {
      start,
      end,
      topSpacer,
      bottomSpacer,
    };
  }, [
    allPosts,
    shouldVirtualizePosts,
    virtualViewport.height,
    virtualViewport.listTop,
    virtualViewport.scrollY,
    heightVersion,
  ]);

  const renderedPosts = useMemo(
    () => allPosts.slice(virtualRange.start, virtualRange.end).map((post) => (
      <div
        key={`${activeTab}-${post.id}`}
        data-lime-recommendation-post={activeTab === 'recommended' ? post.id : undefined}
        className={shouldPlayInitialFloatAnimation ? 'animate-float-up' : ''}
        ref={(element) => registerPostElement(post.id, element)}
      >
        <PostCard post={post} timelineGlass={hasTimelineBackground} />
      </div>
    )),
    [
      activeTab,
      allPosts,
      hasTimelineBackground,
      shouldPlayInitialFloatAnimation,
      virtualRange.end,
      virtualRange.start,
      registerPostElement,
    ]
  );


  const isBusyLoadingMore = activeTab === 'trending'
    ? trendingLoading
    : isFetchingNextPage;

  const hasMoreToLoad = activeTab === 'trending'
    ? trendingHasMore
    : hasNextPage;

  const emptyStateMessage =
    activeTab === 'all'
      ? 'まだ投稿がありません'
      : activeTab === 'following'
        ? 'フォロー中の投稿はありません'
        : activeTab === 'recommended' ? 'おすすめの投稿がまだありません' : 'トレンドの投稿がまだありません';

  return (
    <div
      data-lime-feed-root
      ref={feedRootRef}
      className={`space-y-5 ${
        hasTimelineBackground
          ? timelineTheme === 'dark'
            ? 'pt-4 sm:pt-6 timeline-theme-scope timeline-theme-dark'
            : 'pt-4 sm:pt-6 timeline-theme-scope timeline-theme-light'
          : ''
      }`}
    >
      {hasTimelineBackground && isMobile && timelineBackgroundUrl && (
        <div
          className="pointer-events-none fixed left-0 top-0 z-0 bg-background"
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
            decoding="async"
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
      <div data-lime-feed-intro className="relative z-[1] flex flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-0 px-1">
        
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
              LimeNote 2.7.4
            </span>
          </div>

        </div>

        {/* PC専用の LimeNoteBeta ボックス */}
        <span className="ribbon-tag hidden sm:inline-flex">
          <Sparkles className="h-3 w-3" />
          LimeNote 2.7.4
        </span>
      </div>

      <div className="relative z-[1]">
        <PostComposer homeInline timelineGlass={hasTimelineBackground} />
      </div>

      <div
        data-lime-feed-posts
        ref={(element) => {
          postListRef.current = element;
          feedTabAnimationContentRef.current = element;
        }}
        className={hasTimelineBackground ? "relative z-[1] space-y-0 pt-2 sm:space-y-4" : "relative z-[1] space-y-4 pt-2"}
        style={{ viewTransitionName: 'lime-feed-tab-content' }}
      >
        {isInitialLoading && (
          <div className="space-y-4">
            <PostCardSkeleton />
            <PostCardSkeleton />
          </div>
        )}

        {isError && activeTab !== 'trending' && allPosts.length === 0 && (
          <div className="rounded-3xl border border-destructive/20 bg-destructive/5 p-6 text-center">
            <p className="text-sm text-destructive font-bold">読み込みに失敗しました。</p>
          </div>
        )}

        {!isInitialLoading && !isBusyLoadingMore && allPosts.length === 0 && (
          <div className="rounded-3xl border border-dashed border-border/50 bg-card/40 p-10 text-center text-muted-foreground">
            {emptyStateMessage}
          </div>
        )}

        {virtualRange.topSpacer > 0 && (
          <div style={{ height: `${virtualRange.topSpacer}px` }} aria-hidden="true" />
        )}

        {renderedPosts}

        {virtualRange.bottomSpacer > 0 && (
          <div style={{ height: `${virtualRange.bottomSpacer}px` }} aria-hidden="true" />
        )}

        <div ref={ref} className="py-10 flex justify-center">
          {isBusyLoadingMore ? (
            <div className="flex items-center gap-2 text-muted-foreground animate-pulse">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm font-medium">読み込み中...</span>
            </div>
          ) : hasMoreToLoad ? (
            <div className="h-10" />
          ) : allPosts.length > 0 ? (
            <p className="text-xs text-muted-foreground/60">すべての投稿を読み込みました</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}