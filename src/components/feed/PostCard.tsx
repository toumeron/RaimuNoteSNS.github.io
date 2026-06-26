import { memo, useEffect, useMemo, useRef, useState } from 'react'; 
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { MessageCircle, MoreHorizontal, Trash2, CalendarDays, ChartBarBig, X, Globe, Lock, Sparkles, Plus, Link as LinkIcon, Upload, Send } from 'lucide-react'; 
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LikeButton } from '@/components/post/LikeButton';
import { PostImages } from './PostImages';
import { formatRelative } from '@/lib/format';
import type { PostWithAuthor } from '@/types';
import { deletePost } from '@/api/posts';
import { getCurrentUserId } from '@/lib/currentUser';
import { getYouTubeId } from '@/lib/utils';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { SpotifyEmbed } from '@/components/SpotifyEmbed';
import { supabase } from '@/lib/supabase';
import dayjs from 'dayjs';

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { FollowButton } from '../profile/FollowButton'; 
import { useFollowStats } from '@/hooks/useProfile';

// --- カスタム絵文字用の型定義 ---
interface CustomEmoji {
  id: string;
  name: string;
  public_id: string;
  format: string;
  uploaded_by: string;
}

// ユーザー情報を含んだリアクション詳細型
interface ReactionUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

interface ReactionGroup {
  emoji: string;
  count: number;
  user_ids: string[];
  users: ReactionUser[]; 
}

interface LimeDropTarget {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

// --- 画像から完全再現する高度なエフェクト用の型定義 ---
interface ReplicatedRing {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ReplicatedDot {
  id: string;
  x: number;
  y: number;
  angle: number;
  distance: number;
  color: string;
  size: number;
  delay: number;
}

const formatDisplayCount = (count: number) => {
  if (count >= 10000) {
    return (count / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  }
  return count.toLocaleString();
};

const POST_REACTION_CACHE_LIMIT = 36;
const IMAGE_NATURAL_SIZE_CACHE_LIMIT = 64;

const postReactionCache = new Map<string, ReactionGroup[]>();
const postReactionFetches = new Map<string, Promise<ReactionGroup[]>>();
const imageNaturalSizeCache = new Map<string, { width: number; height: number }>();

let customEmojiCache: CustomEmoji[] | null = null;
let customEmojiFetch: Promise<CustomEmoji[]> | null = null;
let currentUserIdCache: string | null | undefined;
let currentUserIdFetch: Promise<string | null> | null = null;

const spotifyUrlRegex = /https:\/\/open\.spotify\.com\/(?:[\w-]+\/)?(track|album|playlist)\/[a-zA-Z0-9._?=&/%-]+/gi;
const imageUrlRegex = /https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s]*)?|https?:\/\/pbs\.twimg\.com\/media\/[^\s?]+(?:\?[^\s]*)?/gi;
const youtubeUrlRegex = /(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/(watch\?v=|embed\/|shorts\/)?([a-zA-Z0-9_-]{11})([^?\s\n]*)?(\S+)?/g;

const safeUnique = <T,>(values: T[]) => Array.from(new Set(values.filter(Boolean)));

const trimMapToLimit = <K, V>(map: Map<K, V>, limit: number) => {
  while (map.size > limit) {
    const firstKey = map.keys().next().value as K | undefined;
    if (firstKey === undefined) break;
    map.delete(firstKey);
  }
};

const getCachedReactionGroups = (postId: string) => {
  const cached = postReactionCache.get(postId);
  if (!cached) return null;

  postReactionCache.delete(postId);
  postReactionCache.set(postId, cached);
  return cached;
};

const setCachedReactionGroups = (postId: string, groups: ReactionGroup[]) => {
  postReactionCache.delete(postId);
  postReactionCache.set(postId, groups);
  trimMapToLimit(postReactionCache, POST_REACTION_CACHE_LIMIT);
};

const getCachedNaturalSize = (url: string) => {
  const cached = imageNaturalSizeCache.get(url);
  if (!cached) return null;

  imageNaturalSizeCache.delete(url);
  imageNaturalSizeCache.set(url, cached);
  return cached;
};

const setCachedNaturalSize = (url: string, size: { width: number; height: number }) => {
  imageNaturalSizeCache.delete(url);
  imageNaturalSizeCache.set(url, size);
  trimMapToLimit(imageNaturalSizeCache, IMAGE_NATURAL_SIZE_CACHE_LIMIT);
};

export const preloadPostCardAssets = (
  _post: PostWithAuthor,
  _options?: { priority?: 'high' | 'low' }
) => {
  // 画像の事前デコードはメモリを食いやすいため、互換用のno-opにしている。
};

const ensureCurrentUserIdCached = async () => {
  if (currentUserIdCache !== undefined) return currentUserIdCache;
  if (currentUserIdFetch) return currentUserIdFetch;

  currentUserIdFetch = getCurrentUserId()
    .then((id) => {
      currentUserIdCache = id;
      return id;
    })
    .catch((error) => {
      console.error('Get current user id failed:', error);
      currentUserIdCache = null;
      return null;
    })
    .finally(() => {
      currentUserIdFetch = null;
    });

  return currentUserIdFetch;
};

const ensureCustomEmojisCached = async () => {
  if (customEmojiCache) return customEmojiCache;
  if (customEmojiFetch) return customEmojiFetch;

  customEmojiFetch = (async (): Promise<CustomEmoji[]> => {
    try {
      const { data, error } = await supabase
        .from('custom_emojis')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      customEmojiCache = (data || []) as CustomEmoji[];
      return customEmojiCache;
    } catch (error) {
      console.error('Fetch Emojis Error:', error);
      customEmojiCache = [];
      return customEmojiCache;
    } finally {
      customEmojiFetch = null;
    }
  })();

  return customEmojiFetch;
};

const buildReactionGroups = (reactionRows: any[], profileRows: any[] | null | undefined): ReactionGroup[] => {
  if (!reactionRows || reactionRows.length === 0) return [];

  const profileMap: { [key: string]: any } = {};
  (profileRows || []).forEach((profile: any) => {
    profileMap[profile.id] = profile;
  });

  const groups: { [key: string]: { userIds: string[]; users: ReactionUser[] } } = {};

  reactionRows.forEach((row: any) => {
    if (!groups[row.emoji]) {
      groups[row.emoji] = { userIds: [], users: [] };
    }

    groups[row.emoji].userIds.push(row.user_id);

    const profile = profileMap[row.user_id];
    if (profile) {
      groups[row.emoji].users.push({
        id: profile.id,
        username: profile.username || 'unknown',
        displayName: profile.display_name || profile.username || 'ユーザー',
        avatarUrl: profile.avatar_url || '',
      });
    }
  });

  return Object.keys(groups).map((emoji) => ({
    emoji,
    count: groups[emoji].userIds.length,
    user_ids: groups[emoji].userIds,
    users: groups[emoji].users,
  }));
};

const fetchReactionsForPost = async (postId: string, force = false): Promise<ReactionGroup[]> => {
  if (!force) {
    const cached = getCachedReactionGroups(postId);
    if (cached) return cached;

    const pending = postReactionFetches.get(postId);
    if (pending) return pending;
  }

  const request = (async () => {
    const { data: reactionData, error: reactionError } = await supabase
      .from('post_reactions')
      .select('emoji, user_id')
      .eq('post_id', postId);

    if (reactionError) throw reactionError;

    const reactions = reactionData || [];
    if (reactions.length === 0) {
      setCachedReactionGroups(postId, []);
      return [];
    }

    const userIds = safeUnique(reactions.map((row: any) => row.user_id));
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .in('id', userIds);

    if (profileError) throw profileError;

    const groups = buildReactionGroups(reactions, profileData);
    setCachedReactionGroups(postId, groups);
    return groups;
  })()
    .catch((error) => {
      console.error('Fetch Reactions Error:', error);
      return getCachedReactionGroups(postId) || [];
    })
    .finally(() => {
      postReactionFetches.delete(postId);
    });

  postReactionFetches.set(postId, request);
  return request;
};

export const preloadPostCardData = async (posts: PostWithAuthor[]) => {
  const warmupPosts = posts.slice(0, 4);
  if (!warmupPosts.length) return;

  ensureCurrentUserIdCached();
  ensureCustomEmojisCached();

  const postIds = safeUnique(
    warmupPosts
      .map((post) => post.id)
      .filter((postId) => !postReactionCache.has(postId) && !postReactionFetches.has(postId))
  );

  if (postIds.length === 0) return;

  try {
    const { data: reactionRows, error: reactionError } = await supabase
      .from('post_reactions')
      .select('post_id, emoji, user_id')
      .in('post_id', postIds);

    if (reactionError) throw reactionError;

    const rows = reactionRows || [];
    const userIds = safeUnique(rows.map((row: any) => row.user_id));
    const { data: profileRows, error: profileError } = userIds.length > 0
      ? await supabase
          .from('profiles')
          .select('id, username, display_name, avatar_url')
          .in('id', userIds)
      : { data: [], error: null };

    if (profileError) throw profileError;

    postIds.forEach((postId) => {
      const groupedRows = rows.filter((row: any) => row.post_id === postId);
      setCachedReactionGroups(postId, buildReactionGroups(groupedRows, profileRows));
    });
  } catch (error) {
    console.error('Preload post card data failed:', error);
  }
};

function PostCardComponent({ post, timelineGlass = false }: { post: PostWithAuthor; timelineGlass?: boolean }) {
  const [showMenu, setShowMenu] = useState(false);
  const [moreMenuPosition, setMoreMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [shareMenuPosition, setShareMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [showLimeDropPanel, setShowLimeDropPanel] = useState(false);
  const [limeDropTargets, setLimeDropTargets] = useState<LimeDropTarget[]>([]);
  const [limeDropLoading, setLimeDropLoading] = useState(false);
  const [limeDropSendingUserId, setLimeDropSendingUserId] = useState<string | null>(null);
  const [limeDropFeedback, setLimeDropFeedback] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null); 
  const [failedUrls, setFailedUrls] = useState<string[]>([]); 
  const navigate = useNavigate();
  const [, setTick] = useState(0);

  // --- カスタム絵文字・リアクション用ステート群 ---
  const [showPicker, setShowPicker] = useState(false);
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([]);
  const [reactions, setReactions] = useState<ReactionGroup[]>([]);
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isEmojisOpen, setIsEmojisOpen] = useState(true);
  
  // 現在アクティブなリアクションポップアップの管理
  const [activePopupEmoji, setActivePopupEmoji] = useState<string | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  // --- 画像再現エフェクト用のステート ---
  const [activeRings, setActiveRings] = useState<ReplicatedRing[]>([]);
  const [activeDots, setActiveDots] = useState<ReplicatedDot[]>([]);

  // スマホ・PCのリアルタイム判定用ステート
  const [isMobile, setIsMobile] = useState(false);
  const [timelinePortalTheme, setTimelinePortalTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'dark';
    return localStorage.getItem('lime_timeline_visual_theme') === 'light' ? 'light' : 'dark';
  });
  const [singleImageNaturalSize, setSingleImageNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [isCardActive, setIsCardActive] = useState(false);

  const cardRootRef = useRef<HTMLElement>(null);
  const isMobileRef = useRef(false);
  const resizeRafRef = useRef<number | null>(null);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const pickerPanelRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const shareMenuRef = useRef<HTMLDivElement>(null);
  const limeDropPanelRef = useRef<HTMLDivElement>(null);
  const ignoreNextCardClickRef = useRef(false);
  const ignoreCardClickUntilRef = useRef(0);


  const defaultEmojis = ['👍', '❤️', '😆', '🤔', '😮', '🎉', '💢', '😢', '😇', '🍮'];

  const customEmojiByName = useMemo(() => (
    new Map(customEmojis.map((emoji) => [emoji.name, emoji]))
  ), [customEmojis]);

  const suppressCardClickAfterPopupClose = (duration = 500) => {
    ignoreNextCardClickRef.current = true;
    ignoreCardClickUntilRef.current = Date.now() + duration;

    window.setTimeout(() => {
      if (Date.now() >= ignoreCardClickUntilRef.current) {
        ignoreNextCardClickRef.current = false;
      }
    }, duration);
  };

  const shouldSuppressCardNavigation = () => (
    ignoreNextCardClickRef.current || Date.now() < ignoreCardClickUntilRef.current
  );

  const handleCardClickCapture = (e: React.MouseEvent<HTMLElement>) => {
    if (!shouldSuppressCardNavigation()) return;

    e.preventDefault();
    e.stopPropagation();
  };

  useEffect(() => {
    let cancelled = false;

    ensureCurrentUserIdCached().then((id) => {
      if (cancelled) return;

      setCurrentUserId(id);
      if (id) {
        const saved = localStorage.getItem(`recent_emojis_${id}`);
        if (saved) {
          try {
            setRecentEmojis(JSON.parse(saved));
          } catch (e) {
            console.error(e);
          }
        }
      }
    });

    return () => {
      cancelled = true;
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
    const cachedReactions = getCachedReactionGroups(post.id);
    setReactions(cachedReactions || []);
    setIsCardActive(false);
  }, [post.id]);

  useEffect(() => {
    const node = cardRootRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setIsCardActive(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        setIsCardActive(entries.some((entry) => entry.isIntersecting));
      },
      { rootMargin: '420px 0px 520px 0px' }
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [post.id]);

  useEffect(() => {
    const shouldKeepLiveWork = isCardActive || showMenu || showPicker || showShareMenu || showLimeDropPanel || Boolean(selectedImageUrl);
    if (!shouldKeepLiveWork) return;

    let cancelled = false;

    fetchReactions().then(() => undefined);
    fetchCustomEmojis().then(() => undefined);

    const channels = supabase
      .channel(`post-reactions-${post.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'post_reactions',
          filter: `post_id=eq.${post.id}`
        },
        () => {
          if (!cancelled) {
            fetchReactions(true);
          }
        }
      )
      .subscribe();

    const timer = window.setInterval(() => {
      setTick(tick => tick + 1);
    }, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      supabase.removeChannel(channels);
    };
  }, [isCardActive, showMenu, showPicker, showShareMenu, showLimeDropPanel, selectedImageUrl, post.id]);


  useEffect(() => {
    const shouldKeepStateWarm = isCardActive || showMenu || showPicker || showShareMenu || showLimeDropPanel || Boolean(selectedImageUrl);
    if (shouldKeepStateWarm) return;

    const timer = window.setTimeout(() => {
      setReactions([]);
      setCustomEmojis([]);
    }, 3000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isCardActive, showMenu, showPicker, showShareMenu, showLimeDropPanel, selectedImageUrl, post.id]);

  useEffect(() => {
    if (!timelineGlass) return;

    const syncTimelinePortalTheme = (theme?: string) => {
      const nextTheme = theme === 'light' ? 'light' : 'dark';
      setTimelinePortalTheme(nextTheme);
    };

    syncTimelinePortalTheme(localStorage.getItem('lime_timeline_visual_theme') ?? undefined);

    const handleThemeEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ theme?: string }>).detail;
      syncTimelinePortalTheme(detail?.theme);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'lime_timeline_visual_theme') {
        syncTimelinePortalTheme(event.newValue ?? undefined);
      }
    };

    window.addEventListener('timeline-visual-theme-changed', handleThemeEvent as EventListener);
    window.addEventListener('storage', handleStorage);

    let channel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel('timeline-visual-theme');
      channel.onmessage = (event) => {
        syncTimelinePortalTheme(event.data?.theme);
      };
    }

    return () => {
      window.removeEventListener('timeline-visual-theme-changed', handleThemeEvent as EventListener);
      window.removeEventListener('storage', handleStorage);
      channel?.close();
    };
  }, [timelineGlass]);

  // 画像拡大時だけ背後のスクロールを固定する。
  // リアクションピッカー表示時まで body overflow を触ると、sticky/fixed ヘッダーまで巻き込まれて消える環境がある。
  useEffect(() => {
    if (!selectedImageUrl) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedImageUrl]);

  // もっと見るメニューは、カード内外どこを押してもメニュー外なら閉じる。
  // overlay が stacking context に巻き込まれて効かないケースを避けるため、document 側でも拾う。
  useEffect(() => {
    if (!showMenu) return;

    const closeMenuFromOutside = () => {
      suppressCardClickAfterPopupClose();
      setShowMenu(false);
      setMoreMenuPosition(null);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (moreButtonRef.current?.contains(target)) return;
      if (moreMenuRef.current?.contains(target)) return;

      closeMenuFromOutside();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [showMenu]);

  useEffect(() => {
    if (!showMenu) return;

    const closeOnViewportChange = () => {
      suppressCardClickAfterPopupClose();
      setShowMenu(false);
      setMoreMenuPosition(null);
    };

    window.addEventListener('scroll', closeOnViewportChange, true);
    window.addEventListener('resize', closeOnViewportChange);

    return () => {
      window.removeEventListener('scroll', closeOnViewportChange, true);
      window.removeEventListener('resize', closeOnViewportChange);
    };
  }, [showMenu]);

  // 共有メニューも body 直下の portal で出すため、document 側でも外側クリックを拾って閉じる。
  useEffect(() => {
    if (!showShareMenu) return;

    const closeShareMenuFromOutside = () => {
      suppressCardClickAfterPopupClose();
      setShowShareMenu(false);
      setShareMenuPosition(null);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (shareButtonRef.current?.contains(target)) return;
      if (shareMenuRef.current?.contains(target)) return;

      closeShareMenuFromOutside();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [showShareMenu]);

  useEffect(() => {
    if (!showShareMenu) return;

    const closeOnViewportChange = () => {
      suppressCardClickAfterPopupClose();
      setShowShareMenu(false);
      setShareMenuPosition(null);
    };

    window.addEventListener('scroll', closeOnViewportChange, true);
    window.addEventListener('resize', closeOnViewportChange);

    return () => {
      window.removeEventListener('scroll', closeOnViewportChange, true);
      window.removeEventListener('resize', closeOnViewportChange);
    };
  }, [showShareMenu]);

  useEffect(() => {
    if (!showLimeDropPanel) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        suppressCardClickAfterPopupClose();
        setShowLimeDropPanel(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showLimeDropPanel]);

  // リアクション追加パネルも、パネル外を押したら確実に閉じる。
  // overlay を被せず document 側で拾うことで、ヘッダーを隠さない。
  useEffect(() => {
    if (!showPicker) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (buttonRef.current?.contains(target)) return;
      if (pickerPanelRef.current?.contains(target)) return;

      suppressCardClickAfterPopupClose();
      setShowPicker(false);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [showPicker]);

  const fetchReactions = async (force = false) => {
    const nextReactions = await fetchReactionsForPost(post.id, force);
    setReactions(nextReactions);
    return nextReactions;
  };

  const fetchCustomEmojis = async () => {
    const nextCustomEmojis = await ensureCustomEmojisCached();
    setCustomEmojis(nextCustomEmojis);
    return nextCustomEmojis;
  };

  const triggerImageReplicatedEffect = (targetElement: HTMLElement) => {
    const rect = targetElement.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    targetElement.classList.remove('misskey-elastic-active');
    void targetElement.offsetWidth; 
    targetElement.classList.add('misskey-elastic-active');

    const batchId = Math.random().toString(36).substring(2, 9);

    const newRing: ReplicatedRing = {
      id: `ring-${batchId}`,
      x: centerX,
      y: centerY,
      width: rect.width + 4,
      height: rect.height + 4
    };

    const colors = ['#d4f022', '#e6007e', '#22f0d8', '#d4f022', '#e6007e'];
    const dotCount = 16; 
    const newDots: ReplicatedDot[] = [];

    for (let i = 0; i < dotCount; i++) {
      const angle = (i / dotCount) * 360 + (Math.random() * 20 - 10);
      const maxDistance = (rect.width / 2) + (Math.random() * 16 - 4);

      newDots.push({
        id: `dot-${batchId}-${i}`,
        x: centerX,
        y: centerY,
        angle: angle,
        distance: maxDistance,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() * 5 + 5, 
        delay: Math.random() * 40 
      });
    }

    setActiveRings((prev) => [...prev, newRing]);
    setActiveDots((prev) => [...prev, ...newDots]);

    setTimeout(() => {
      setActiveRings((prev) => prev.filter((r) => r.id !== `ring-${batchId}`));
      setActiveDots((prev) => prev.filter((d) => !d.id.startsWith(`dot-${batchId}-`)));
    }, 550);
  };

  const handleAddReaction = async (emoji: string, event?: React.MouseEvent) => {
    if (!currentUserId) return;

    if (event && event.currentTarget) {
      triggerImageReplicatedEffect(event.currentTarget as HTMLElement);
    }

    const updatedRecents = [emoji, ...recentEmojis.filter(e => e !== emoji)].slice(0, 10);
    setRecentEmojis(updatedRecents);
    localStorage.setItem(`recent_emojis_${currentUserId}`, JSON.stringify(updatedRecents));

    try {
      const { data: existing, error: checkError } = await supabase
        .from('post_reactions')
        .select('id')
        .eq('post_id', post.id)
        .eq('user_id', currentUserId)
        .eq('emoji', emoji)
        .maybeSingle();

      if (checkError) throw checkError;

      if (existing) {
        const { error } = await supabase
          .from('post_reactions')
          .delete()
          .eq('id', existing.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('post_reactions')
          .insert({
            post_id: post.id,
            user_id: currentUserId,
            emoji: emoji
          });

        if (error) throw error;
      }
      fetchReactions(true);
      setShowPicker(false);
    } catch (err) {
      console.error('Toggle Reaction Error:', err);
    }
  };

  const getCustomEmojiObj = (emojiStr: string) => {
    if (emojiStr.startsWith(':') && emojiStr.endsWith(':')) {
      const cleanName = emojiStr.slice(1, -1);
      return customEmojiByName.get(cleanName);
    }
    return null;
  };

  const renderEmojiElement = (emojiStr: string, className = "h-5 w-5 object-contain inline-block") => {
    const customEmoji = getCustomEmojiObj(emojiStr);
    if (customEmoji) {
      const cleanPublicId = customEmoji.public_id.startsWith('custom_emojis/')
        ? customEmoji.public_id
        : `custom_emojis/${customEmoji.public_id}`;

      const imageUrl = `https://res.cloudinary.com/dveiikhhw/image/upload/${cleanPublicId}.${customEmoji.format}`;
      return <img src={imageUrl} alt={customEmoji.name} className={className} />;
    }
    return <span className="text-lg leading-none select-none">{emojiStr}</span>;
  };

  const handleTouchStart = (emoji: string) => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
    }

    longPressTimerRef.current = window.setTimeout(() => {
      setActivePopupEmoji(emoji);
      longPressTimerRef.current = null;
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const filteredCustomEmojis = useMemo(() => (
    customEmojis.filter((emoji) =>
      emoji.name.toLowerCase().includes(searchQuery.toLowerCase())
    )
  ), [customEmojis, searchQuery]);

  const isMyPost = currentUserId === post.userId;
  const { youtubeId, spotifyUrls, allImageUrls, displayContent, singleImageUrl } = useMemo(() => {
    const nextYoutubeId = getYouTubeId(post.content);
    const nextSpotifyUrls = post.content.match(spotifyUrlRegex) || [];
    const extractedImageUrls = post.content.match(imageUrlRegex) || [];
    const nextAllImageUrls = [...(post.imageUrls || []), ...extractedImageUrls].slice(0, 4);

    const nextDisplayContent = post.content
      .replace(youtubeUrlRegex, '')
      .replace(imageUrlRegex, '')
      .replace(spotifyUrlRegex, '')
      .trim();

    return {
      youtubeId: nextYoutubeId,
      spotifyUrls: nextSpotifyUrls,
      allImageUrls: nextAllImageUrls,
      displayContent: nextDisplayContent,
      singleImageUrl: nextAllImageUrls.length === 1 ? nextAllImageUrls[0] : null,
    };
  }, [post.content, post.imageUrls]);

  useEffect(() => {
    setSingleImageNaturalSize(singleImageUrl ? getCachedNaturalSize(singleImageUrl) ?? null : null);
  }, [singleImageUrl]);

  const getSingleImageFrameStyle = (): React.CSSProperties => {
    if (!singleImageNaturalSize) {
      return {
        width: '100%',
        maxWidth: '100%',
      };
    }

    const naturalWidth = Math.max(1, singleImageNaturalSize.width);
    const naturalHeight = Math.max(1, singleImageNaturalSize.height);
    const ratio = naturalWidth / naturalHeight;

    /*
      1枚画像は X / Twitter のタイムライン表示に寄せる。
      基本は画像比率をそのまま使うが、超縦長画像だけはタイムラインを占拠しないよう、
      表示上限の高さから逆算して幅を段階的に狭める。
      これで「縦に長いほど左寄せのまま細くなる」挙動になる。
    */
    const maxTimelineImageHeight = isMobile ? 300 : 480;
    const minimumReadableWidth = isMobile ? 88 : 110;
    const heightLimitedWidth = Math.max(
      minimumReadableWidth,
      Math.round(maxTimelineImageHeight * ratio)
    );
    const shouldLimitByHeight = ratio < (isMobile ? 1.64 : 1.72);
    const shouldAvoidUpscale = naturalWidth <= (isMobile ? 360 : 520);
    const shouldNarrowUltraWide = ratio >= 2.35;

    if (shouldLimitByHeight) {
      const width = shouldAvoidUpscale
        ? Math.min(naturalWidth, heightLimitedWidth)
        : heightLimitedWidth;

      return {
        width: `min(100%, ${Math.max(minimumReadableWidth, width)}px)`,
        maxWidth: '100%',
      };
    }

    if (shouldAvoidUpscale) {
      return {
        width: `${naturalWidth}px`,
        maxWidth: '100%',
      };
    }

    if (shouldNarrowUltraWide) {
      return {
        width: isMobile ? '100%' : 'min(100%, 560px)',
        maxWidth: '100%',
      };
    }

    return {
      width: '100%',
      maxWidth: '100%',
    };
  };

  const getSingleImageDisplayStyle = (): React.CSSProperties => ({
    width: '100%',
    height: 'auto',
    objectFit: 'contain',
  });

  const renderContentWithLinks = (text: string) => {
    if (!text) return null;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    return parts.map((part, index) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={`link-${index}`}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-pink-500 hover:underline transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        );
      }
      return part;
    });
  };

  const renderContentWithMentions = (text: string) => {
    if (!text) return null;
    const parts = text.split(/(@\w+)/g);
    
    return parts.map((part, index) => {
      if (part.startsWith('@')) {
        const username = part.substring(1);
        return (
          <Link
            key={`mention-${index}`}
            to={`/u/${username}`}
            className="text-pink-500 hover:underline transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </Link>
        );
      }
      return renderContentWithHashtags(part);
    });
  };

  const renderContentWithHashtags = (text: string) => {
    if (!text) return null;
    const parts = text.split(/(#[^\s#　.,!?:;'"()\[\]{}<>]+)/g);

    return parts.map((part, index) => {
      if (part.startsWith('#')) {
        return (
          <button
            key={`hashtag-${index}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              navigate(`/search?q=${encodeURIComponent(part)}`);
            }}
            className="text-pink-500 hover:underline transition-colors inline-block align-baseline"
          >
            {part}
          </button>
        );
      }
      return renderContentWithLinks(part);
    });
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('投稿を削除しますか？')) return;
    try {
      await deletePost(post.id);
      window.location.reload();
    } catch (err) {
      alert('削除に失敗しました');
    }
  };

  const handleActivityClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(`/post/${post.id}/activity`);
    setShowMenu(false);
  };

  const handleToggleVisibility = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const newVisibility = post.visibility === 'public' ? 'following' : 'public';
    const confirmMsg = newVisibility === 'public' 
      ? 'この投稿を全体公開に切り替えますか？' 
      : 'この投稿を限定公開に切り替えますか？フォロー中のユーザーのみ表示されます。';
    
    if (!confirm(confirmMsg)) return;

    try {
      const { error } = await supabase
        .from('posts')
        .update({ visibility: newVisibility })
        .eq('id', post.id);

      if (error) throw error;
      window.location.reload();
    } catch (err) {
      console.error(err);
      alert('公開設定の変更に失敗しました');
    }
  };

  const handleImageClick = (e: React.MouseEvent, url: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedImageUrl(url);
  };

  const handleCardClick = () => {
    if (showMenu || showPicker || showShareMenu || showLimeDropPanel || shouldSuppressCardNavigation()) {
      setShowMenu(false);
      if (showPicker) setShowPicker(false);
      if (showShareMenu) {
        setShowShareMenu(false);
        setShareMenuPosition(null);
      }
      if (showLimeDropPanel) {
        setShowLimeDropPanel(false);
      }
      return;
    }

    navigate(`/post/${post.id}`);
  };

  const getPostShareUrl = () => {
    if (typeof window === 'undefined') {
      return `/post/${post.id}`;
    }

    const baseUrl = import.meta.env.BASE_URL || '/';
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    return new URL(`post/${post.id}`, new URL(normalizedBaseUrl, window.location.origin)).toString();
  };

  const getPostShareText = () => {
    const rawText = (displayContent || post.content || '').replace(/\s+/g, ' ').trim();
    if (!rawText) {
      return `${post.author.displayName}さんのポスト`;
    }

    const clippedText = rawText.length > 120 ? `${rawText.slice(0, 120)}...` : rawText;
    return `${post.author.displayName}さんのポスト: ${clippedText}`;
  };

  const copyTextToClipboard = async (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      document.execCommand('copy');
    } finally {
      document.body.removeChild(textarea);
    }
  };

  const closeShareMenu = () => {
    suppressCardClickAfterPopupClose();
    setShowShareMenu(false);
    setShareMenuPosition(null);
  };

  const handleShareButtonClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (showShareMenu) {
      closeShareMenu();
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    setShareMenuPosition({
      top: rect.bottom + 4,
      right: Math.max(8, window.innerWidth - rect.right),
    });
    setShowMenu(false);
    setMoreMenuPosition(null);
    setShowPicker(false);
    setShowShareMenu(true);
  };

  const handleCopyPostLink = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      await copyTextToClipboard(getPostShareUrl());
      setShareFeedback('リンクをコピーしました');
      window.setTimeout(() => {
        setShareFeedback(null);
      }, 1400);
      closeShareMenu();
    } catch (err) {
      console.error('Copy post link failed:', err);
      setShareFeedback('コピーに失敗しました');
      window.setTimeout(() => {
        setShareFeedback(null);
      }, 1400);
    }
  };

  const handleNativePostShare = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const url = getPostShareUrl();
    const title = `${post.author.displayName}さんのポスト`;
    const text = getPostShareText();

    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title, text, url });
        closeShareMenu();
        return;
      }

      await copyTextToClipboard(url);
      setShareFeedback('共有非対応のためリンクをコピーしました');
      window.setTimeout(() => {
        setShareFeedback(null);
      }, 1800);
      closeShareMenu();
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        closeShareMenu();
        return;
      }

      console.error('Native post share failed:', err);
      setShareFeedback('共有に失敗しました');
      window.setTimeout(() => {
        setShareFeedback(null);
      }, 1400);
    }
  };

  const fetchLimeDropTargets = async () => {
    if (!currentUserId) {
      setLimeDropTargets([]);
      setLimeDropFeedback('ログイン状態を確認できません');
      return;
    }

    setLimeDropLoading(true);
    setLimeDropFeedback(null);

    try {
      const { data: currentProfile, error: currentProfileError } = await supabase
        .from('profiles')
        .select('is_official')
        .eq('id', currentUserId)
        .maybeSingle();

      if (currentProfileError) throw currentProfileError;

      if (currentProfile?.is_official === true) {
        const { data: allProfileRows, error: allProfileError } = await supabase
          .from('profiles')
          .select('id, username, display_name, avatar_url')
          .neq('id', currentUserId)
          .order('display_name', { ascending: true });

        if (allProfileError) throw allProfileError;

        const targets: LimeDropTarget[] = (allProfileRows || []).map((profile: any) => ({
          id: profile.id,
          username: profile.username || 'unknown',
          displayName: profile.display_name || profile.username || 'ユーザー',
          avatarUrl: profile.avatar_url || '',
        }));

        setLimeDropTargets(targets);
        return;
      }

      const { data: followingRows, error: followingError } = await supabase
        .from('follows')
        .select('followee_id')
        .eq('follower_id', currentUserId);

      if (followingError) throw followingError;

      const followingIds = Array.from(
        new Set(
          (followingRows || [])
            .map((row: any) => row.followee_id)
            .filter(Boolean)
        )
      );

      const { data: followerRows, error: followerError } = followingIds.length > 0
        ? await supabase
            .from('follows')
            .select('follower_id')
            .eq('followee_id', currentUserId)
            .in('follower_id', followingIds)
        : { data: [], error: null };

      if (followerError) throw followerError;

      const mutualIds = Array.from(
        new Set(
          (followerRows || [])
            .map((row: any) => row.follower_id)
            .filter(Boolean)
        )
      );

      const { data: mutualProfileRows, error: mutualProfileError } = mutualIds.length > 0
        ? await supabase
            .from('profiles')
            .select('id, username, display_name, avatar_url')
            .in('id', mutualIds)
        : { data: [], error: null };

      if (mutualProfileError) throw mutualProfileError;

      const targetMap = new Map<string, LimeDropTarget>();
      (mutualProfileRows || []).forEach((profile: any) => {
        targetMap.set(profile.id, {
          id: profile.id,
          username: profile.username || 'unknown',
          displayName: profile.display_name || profile.username || 'ユーザー',
          avatarUrl: profile.avatar_url || '',
        });
      });

      const targets = Array.from(targetMap.values()).sort((a, b) => (
        a.displayName.localeCompare(b.displayName, 'ja')
      ));

      setLimeDropTargets(targets);
    } catch (err) {
      console.error('Fetch LimeDrop targets failed:', err);
      setLimeDropTargets([]);
      setLimeDropFeedback('送信先の取得に失敗しました');
    } finally {
      setLimeDropLoading(false);
    }
  };

  const handleOpenLimeDropPanel = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    closeShareMenu();
    setShowMenu(false);
    setMoreMenuPosition(null);
    setShowPicker(false);
    setLimeDropFeedback(null);
    setShowLimeDropPanel(true);
    await fetchLimeDropTargets();
  };

  const handleCloseLimeDropPanel = () => {
    suppressCardClickAfterPopupClose();
    setShowLimeDropPanel(false);
    setLimeDropSendingUserId(null);
  };

  const handleSendLimeDrop = async (target: LimeDropTarget) => {
    if (!currentUserId) {
      setLimeDropFeedback('ログイン状態を確認できません');
      return;
    }

    setLimeDropSendingUserId(target.id);
    setLimeDropFeedback(null);

    try {
      const url = getPostShareUrl();
      const text = getPostShareText();

      const { error } = await supabase
        .from('lime_drops')
        .insert({
          sender_id: currentUserId,
          recipient_id: target.id,
          post_id: post.id,
          post_url: url,
          post_author_id: post.author.id,
          post_author_username: post.author.username,
          post_author_display_name: post.author.displayName,
          post_text: text,
          status: 'pending',
        });

      if (error) throw error;

      setLimeDropFeedback(`${target.displayName}さんに送信しました`);
      window.setTimeout(() => {
        handleCloseLimeDropPanel();
        setLimeDropFeedback(null);
      }, 900);
    } catch (err) {
      console.error('Send LimeDrop failed:', err);
      setLimeDropFeedback('LimeDropの送信に失敗しました');
    } finally {
      setLimeDropSendingUserId(null);
    }
  };

  const HoverStats = ({ userId }: { userId: string }) => {
    const { data: stats } = useFollowStats(userId);
    return (
      <div className="mt-3 flex items-center gap-4 text-[14px]">
        <div className="flex items-center gap-1">
          <span className="font-bold text-foreground">{stats ? formatDisplayCount(stats.following) : 0}</span>
          <span className="text-muted-foreground">フォロー中</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="font-bold text-foreground">{stats ? formatDisplayCount(stats.followers) : 0}</span>
          <span className="text-muted-foreground">フォロワー</span>
        </div>
      </div>
    );
  };

  const ProfileHoverContent = () => (
    <HoverCardContent 
      side="bottom" 
      align="start" 
      className="w-[280px] rounded-[20px] border border-border/60 bg-card p-4 shadow-xl animate-in fade-in zoom-in duration-200 overflow-hidden"
    >
      <div className="flex justify-between items-start mb-3">
        <Avatar className="h-14 w-14 border border-primary/5">
          <AvatarImage src={post.author.avatarUrl} alt={post.author.displayName} />
          <AvatarFallback>{post.author.displayName.slice(0, 1)}</AvatarFallback>
        </Avatar>
        
        {currentUserId !== post.author.id && (
          <div className="shrink-0 w-[85px] h-[36px]" onClick={(e) => e.stopPropagation()}>
            <div className="w-full h-full [&>*]:!w-full [&>*]:!h-full [&>*]:!min-w-0 [&>*]:!p-0 [&>*]:!flex [&>*]:!items-center [&>*]:!justify-center [&>*]:!bg-foreground [&>*]:!text-background [&>*]:!rounded-full [&>*]:!text-[14px] [&>*]:!font-bold [&>*]:!border-none [&_svg]:!hidden">
              <FollowButton userId={post.author.id} />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-0.5">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-base font-black text-foreground truncate leading-tight shrink">
            {post.author.displayName}
          </span>
          {post.author.isOfficial && (
            <img 
              src={`${import.meta.env.BASE_URL}verified.png`} 
              alt="Official" 
              className="h-[1.1em] w-[1.1em] shrink-0 transform translate-y-[1px]"
            />
          )}
        </div>
        <p className="text-[15px] text-muted-foreground stroke-none">@{post.author.username}</p>
      </div>

      {post.author.bio && (
        <p className="mt-3 text-[15px] leading-normal text-foreground whitespace-pre-wrap line-clamp-3">
          {post.author.bio}
        </p>
      )}

      <div className="mt-3 flex items-center gap-1.5 text-[14px] text-muted-foreground">
        <CalendarDays className="h-4 w-4" />
        <span>{dayjs(post.author.createdAt).format('YYYY年M月')} から参加</span>
      </div>

      <HoverStats userId={post.author.id} />
    </HoverCardContent>
  );

  const timelinePortalThemeClass = timelineGlass
    ? `timeline-portal-picker timeline-portal-picker-${timelinePortalTheme}`
    : 'bg-white dark:bg-[#1e222b]';

  return (
    <>
      <style>{`
        @keyframes misskeyRingExpand {
          0% {
            transform: translate(-50%, -50%) scale(0.6);
            opacity: 1;
            border-width: 5px;
          }
          40% {
            opacity: 1;
            border-width: 4px;
          }
          100% {
            transform: translate(-50%, -50%) scale(1.15);
            opacity: 0;
            border-width: 1px;
          }
        }
        @keyframes misskeyDotBurst {
          0% {
            transform: translate(-50%, -50%) rotate(var(--mk-angle)) translateY(0px) scale(0.2);
            opacity: 0;
          }
          15% {
            opacity: 1;
            transform: translate(-50%, -50%) rotate(var(--mk-angle)) translateY(calc(var(--mk-dist) * 0.4)) scale(1.1);
          }
          60% {
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) rotate(var(--mk-angle)) translateY(var(--mk-dist)) scale(0);
            opacity: 0;
          }
        }
        @keyframes misskeyButtonElastic {
          0% { transform: scale(1); }
          20% { transform: scale(0.84); }
          50% { transform: scale(1.16); }
          75% { transform: scale(0.94); }
          100% { transform: scale(1); }
        }
        .misskey-elastic-active {
          animation: misskeyButtonElastic 420ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards !important;
        }

        /* --- スマホ専用：画面下部から滑らかにスライド湧き出しするアニメーション --- */
        @keyframes slideUpMobile {
          0% {
            transform: translate(-50%, 24px);
            opacity: 0;
          }
          100% {
            transform: translate(-50%, 0);
            opacity: 1;
          }
        }
        .animate-slide-up-mobile {
          animation: slideUpMobile 240ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        /* --- PC専用：プラスボタンの直上(absolute)から上に弾むようにズームインするアニメーション --- */
        @keyframes zoomInPc {
          0% {
            transform: scale(0.9) translateY(8px);
            opacity: 0;
          }
          100% {
            transform: scale(1) translateY(0);
            opacity: 1;
          }
        }
        .animate-zoom-in-pc {
          animation: zoomInPc 160ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        .timeline-glass-card {
          background: hsl(var(--card) / 0.58);
          border: 1px solid hsl(var(--border) / 0.055);
          box-shadow: none;
          color: hsl(var(--foreground));
          -webkit-backdrop-filter: blur(24px) saturate(165%);
          backdrop-filter: blur(24px) saturate(165%);
        }

        .timeline-theme-dark .timeline-glass-card {
          background: linear-gradient(
            135deg,
            rgba(12, 16, 28, 0.72),
            rgba(34, 24, 32, 0.66)
          ) !important;
          border-color: rgba(255, 255, 255, 0.035) !important;
          color: rgba(255, 255, 255, 0.96) !important;
        }

        .timeline-theme-light .timeline-glass-card {
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.60),
            rgba(255, 255, 255, 0.52)
          ) !important;
          border-color: rgba(40, 30, 25, 0.032) !important;
          color: rgba(24, 22, 20, 0.96) !important;
        }

        /*
          背景画像付きタイムライン専用の可読性補正。
          ここではカードごとに light/dark を判定しない。
          Feed 側の timeline-theme-dark / timeline-theme-light が決めたCSS変数に従う。
        */
        .timeline-glass-card,
        .timeline-mobile-readable {
          -webkit-font-smoothing: antialiased;
          text-rendering: optimizeLegibility;
          color: hsl(var(--foreground));
        }

        .timeline-glass-card .text-foreground,
        .timeline-mobile-readable .text-foreground,
        .timeline-glass-card p,
        .timeline-mobile-readable p {
          color: hsl(var(--foreground) / 0.96) !important;
          text-shadow: none !important;
        }

        .timeline-glass-card .text-muted-foreground,
        .timeline-mobile-readable .text-muted-foreground,
        .timeline-glass-card .text-muted-foreground\/70,
        .timeline-mobile-readable .text-muted-foreground\/70,
        .timeline-glass-card .text-muted-foreground\/80,
        .timeline-mobile-readable .text-muted-foreground\/80 {
          color: hsl(var(--muted-foreground) / 0.92) !important;
          text-shadow: none !important;
        }

        .timeline-glass-card .text-pink-500,
        .timeline-mobile-readable .text-pink-500 {
          color: hsl(var(--timeline-link, 330 96% 60%)) !important;
          text-shadow: none !important;
        }

        .timeline-theme-dark .timeline-glass-card,
        .timeline-theme-dark .timeline-mobile-readable,
        .timeline-theme-dark .timeline-glass-card .text-foreground,
        .timeline-theme-dark .timeline-mobile-readable .text-foreground,
        .timeline-theme-dark .timeline-glass-card p,
        .timeline-theme-dark .timeline-mobile-readable p {
          color: rgba(255, 255, 255, 0.96) !important;
        }

        .timeline-theme-dark .timeline-glass-card .text-muted-foreground,
        .timeline-theme-dark .timeline-mobile-readable .text-muted-foreground,
        .timeline-theme-dark .timeline-glass-card .text-muted-foreground\/70,
        .timeline-theme-dark .timeline-mobile-readable .text-muted-foreground\/70,
        .timeline-theme-dark .timeline-glass-card .text-muted-foreground\/80,
        .timeline-theme-dark .timeline-mobile-readable .text-muted-foreground\/80 {
          color: rgba(226, 232, 240, 0.76) !important;
        }

        .timeline-theme-dark .timeline-glass-card .text-pink-500,
        .timeline-theme-dark .timeline-mobile-readable .text-pink-500 {
          color: rgb(255, 87, 166) !important;
        }

        .timeline-theme-light .timeline-glass-card,
        .timeline-theme-light .timeline-mobile-readable,
        .timeline-theme-light .timeline-glass-card .text-foreground,
        .timeline-theme-light .timeline-mobile-readable .text-foreground,
        .timeline-theme-light .timeline-glass-card p,
        .timeline-theme-light .timeline-mobile-readable p {
          color: rgba(24, 22, 20, 0.96) !important;
        }

        .timeline-theme-light .timeline-glass-card .text-muted-foreground,
        .timeline-theme-light .timeline-mobile-readable .text-muted-foreground,
        .timeline-theme-light .timeline-glass-card .text-muted-foreground\/70,
        .timeline-theme-light .timeline-mobile-readable .text-muted-foreground\/70,
        .timeline-theme-light .timeline-glass-card .text-muted-foreground\/80,
        .timeline-theme-light .timeline-mobile-readable .text-muted-foreground\/80 {
          color: rgba(86, 74, 66, 0.74) !important;
        }

        .timeline-theme-light .timeline-glass-card .text-pink-500,
        .timeline-theme-light .timeline-mobile-readable .text-pink-500 {
          color: rgb(224, 32, 122) !important;
        }

        .timeline-glass-card svg,
        .timeline-mobile-readable svg {
          filter: none !important;
        }

        .timeline-portal-picker {
          -webkit-font-smoothing: antialiased;
          text-rendering: optimizeLegibility;
          -webkit-backdrop-filter: blur(26px) saturate(170%);
          backdrop-filter: blur(26px) saturate(170%);
        }

        .timeline-portal-picker-light {
          background: rgba(255, 255, 255, 0.96) !important;
          color: rgba(24, 22, 20, 0.96) !important;
          border-color: rgba(24, 22, 20, 0.10) !important;
        }

        .timeline-portal-picker-dark {
          background: rgba(18, 21, 30, 0.96) !important;
          color: rgba(255, 255, 255, 0.96) !important;
          border-color: rgba(255, 255, 255, 0.10) !important;
        }

        .timeline-portal-picker-light [class*="text-muted-foreground"] {
          color: rgba(86, 74, 66, 0.72) !important;
        }

        .timeline-portal-picker-dark [class*="text-muted-foreground"] {
          color: rgba(226, 232, 240, 0.72) !important;
        }

        .timeline-portal-picker-light button:hover {
          background: rgba(24, 22, 20, 0.06) !important;
        }

        .timeline-portal-picker-dark button:hover {
          background: rgba(255, 255, 255, 0.10) !important;
        }

        .timeline-portal-picker-light .timeline-portal-divider {
          border-color: rgba(24, 22, 20, 0.10) !important;
        }

        .timeline-portal-picker-dark .timeline-portal-divider {
          border-color: rgba(255, 255, 255, 0.10) !important;
        }

        .timeline-portal-picker-light .timeline-portal-search {
          background: rgba(24, 22, 20, 0.035) !important;
          border-color: rgba(24, 22, 20, 0.12) !important;
          color: rgba(24, 22, 20, 0.96) !important;
        }

        .timeline-portal-picker-dark .timeline-portal-search {
          background: rgba(0, 0, 0, 0.26) !important;
          border-color: rgba(255, 255, 255, 0.12) !important;
          color: rgba(255, 255, 255, 0.96) !important;
        }

        @media (max-width: 639px) {
          .timeline-mobile-readable {
            position: relative;
            width: calc(100vw - 32px);
            max-width: 600px;
            margin: 10px auto 14px;
            box-sizing: border-box;
            overflow: hidden;
            border-radius: 28px;
            border: 1px solid hsl(var(--border) / 0.075);
            background: hsl(var(--card) / 0.58);
            color: hsl(var(--foreground));
            box-shadow: none;
            -webkit-backdrop-filter: blur(24px) saturate(170%);
            backdrop-filter: blur(24px) saturate(170%);
          }

          .timeline-theme-dark .timeline-mobile-readable {
            background: linear-gradient(
              135deg,
              rgba(12, 16, 28, 0.72),
              rgba(34, 24, 32, 0.64)
            ) !important;
            border-color: rgba(255, 255, 255, 0.04) !important;
          }

          .timeline-theme-light .timeline-mobile-readable {
            background: linear-gradient(
              135deg,
              rgba(255, 255, 255, 0.62),
              rgba(255, 255, 255, 0.54)
            ) !important;
            border-color: rgba(40, 30, 25, 0.045) !important;
          }
        }
      `}</style>

      {/* --- 高度グラフィックアニメーションレイヤー --- */}
      {(activeRings.length > 0 || activeDots.length > 0) && (
        <div className="fixed inset-0 pointer-events-none z-[9999] overflow-hidden">
          {activeRings.map((r) => (
            <div
              key={r.id}
              style={{
                position: 'fixed',
                left: r.x,
                top: r.y,
                width: `${r.width}px`,
                height: `${r.height}px`,
                borderRadius: '9999px',
                border: '4px solid #d4f022', 
                backgroundColor: 'transparent',
                transformOrigin: 'center center',
                animation: 'misskeyRingExpand 460ms cubic-bezier(0.1, 0.8, 0.3, 1) forwards'
              }}
            />
          ))}

          {activeDots.map((d) => (
            <div
              key={d.id}
              style={{
                position: 'fixed',
                left: d.x,
                top: d.y,
                width: `${d.size}px`,
                height: `${d.size}px`,
                backgroundColor: d.color,
                borderRadius: '50%',
                transformOrigin: 'center center',
                ['--mk-angle' as any]: `${d.angle}deg`,
                ['--mk-dist' as any]: `${d.distance}px`,
                animation: `misskeyDotBurst 480ms cubic-bezier(0.12, 0.85, 0.3, 1) forwards`,
                animationDelay: `${d.delay}ms`
              }}
            />
          ))}
        </div>
      )}

      <article 
        ref={cardRootRef}
        onClickCapture={handleCardClickCapture}
        onClick={handleCardClick}
        className={
          timelineGlass
            ? isMobile
              ? "timeline-mobile-readable px-5 py-4 cursor-pointer"
              : "timeline-glass-card rounded-3xl p-5 transition relative cursor-pointer"
            : isMobile
              ? "relative mx-auto w-full max-w-[600px] px-0 py-3 cursor-pointer"
              : "rounded-3xl border border-border/60 bg-card p-5 shadow-soft transition hover:shadow-card-soft relative cursor-pointer"
        }
        style={{
          contentVisibility: showMenu || showPicker || showShareMenu || showLimeDropPanel || selectedImageUrl ? 'visible' : 'auto',
          containIntrinsicSize: isMobile ? '0 340px' : '0 380px',
        } as React.CSSProperties}
      >
        {isMobile && !timelineGlass && (
          <div className="pointer-events-none absolute bottom-0 left-1/2 w-screen -translate-x-1/2 border-b border-border/60" />
        )}

        <div className="flex items-start gap-3">
          <HoverCard openDelay={300}>
            <HoverCardTrigger asChild>
              <Link 
                to={`/u/${post.author.username}`} 
                className="shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <Avatar className={isMobile ? "h-11 w-11 border-2 border-primary/30" : "h-11 w-11 border-2 border-primary/30"}>
                  <AvatarImage src={post.author.avatarUrl} alt={post.author.displayName} />
                  <AvatarFallback>{post.author.displayName.slice(0, 1)}</AvatarFallback>
                </Avatar>
              </Link>
            </HoverCardTrigger>
            <ProfileHoverContent />
          </HoverCard>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center overflow-hidden w-full min-w-0">
                <HoverCard openDelay={300}>
                  <HoverCardTrigger asChild>
                    <Link 
                      to={`/u/${post.author.username}`} 
                      className="flex items-center min-w-0 shrink font-display font-bold text-foreground hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-0.5 min-w-0">
                        <span className={isMobile ? "truncate text-[16px]" : "truncate text-base"}>
                          {post.author.displayName}
                        </span>
                        {post.author.isOfficial && (
                          <img 
                            src={`${import.meta.env.BASE_URL}verified.png`}
                            alt="Official" 
                            className="h-4 w-4 shrink-0 transform translate-y-[0.5px]"
                            loading="eager"
                          />
                        )}
                      </div>
                    </Link>
                  </HoverCardTrigger>
                  <ProfileHoverContent />
                </HoverCard>
                
                <span className={isMobile ? "truncate text-[16px] text-muted-foreground ml-1 opacity-80 shrink" : "truncate text-base text-muted-foreground ml-1 opacity-80 shrink"}>
                  @{post.author.username}
                </span>
                
                <span className="text-muted-foreground mx-1 shrink-0">·</span>
                <span className={isMobile ? "text-[16px] text-muted-foreground whitespace-nowrap shrink-0" : "text-sm text-muted-foreground whitespace-nowrap shrink-0"}>
                  {formatRelative(post.createdAt)}
                </span>
              </div>
              
              <div className="flex items-center shrink-0 ml-2">
                {post.visibility === 'following' && (
                  <span className={isMobile ? "text-[13px] font-bold text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-md whitespace-nowrap mr-1" : "text-[14px] font-bold text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-md whitespace-nowrap mr-1"}>
                    限定公開
                  </span>
                )}
                <div className="relative shrink-0">
                  <button
                    ref={moreButtonRef}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();

                      if (showMenu) {
                        setShowMenu(false);
                        setMoreMenuPosition(null);
                        return;
                      }

                      const rect = e.currentTarget.getBoundingClientRect();
                      setMoreMenuPosition({
                        top: rect.bottom + 4,
                        right: Math.max(8, window.innerWidth - rect.right),
                      });
                      setShowShareMenu(false);
                      setShareMenuPosition(null);
                      setShowPicker(false);
                      setShowMenu(true);
                    }}
                    className="p-1 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <MoreHorizontal className="h-5 w-5" />
                  </button>
                  {showMenu && typeof document !== 'undefined' && createPortal(
                    <>
                      <div
                        className="fixed inset-0 bg-transparent"
                        style={{ zIndex: 2147483646 }}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          suppressCardClickAfterPopupClose();
                          setShowMenu(false);
                          setMoreMenuPosition(null);
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      />
                      <div 
                        ref={moreMenuRef}
                        className="fixed w-44 rounded-xl border border-border bg-card p-1 shadow-lg overflow-hidden animate-in fade-in zoom-in duration-100"
                        style={{
                          top: moreMenuPosition?.top ?? 0,
                          right: moreMenuPosition?.right ?? 8,
                          zIndex: 2147483647,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={handleActivityClick}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted transition-colors"
                        >
                          <ChartBarBig className="h-4 w-4" />
                          ポストアクティビティー
                        </button>

                        {isMyPost && (
                          <button
                            onClick={handleToggleVisibility}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted transition-colors"
                          >
                            {post.visibility === 'public' ? (
                              <>
                                <Lock className="h-4 w-4" />
                                限定公開にする
                              </>
                            ) : (
                              <>
                                <Globe className="h-4 w-4" />
                                全体公開にする
                              </>
                            )}
                          </button>
                        )}
                        
                        {isMyPost && (
                          <button
                            onClick={handleDelete}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-destructive hover:bg-destructive/10 transition-colors border-t border-border/50 mt-1"
                          >
                            <Trash2 className="h-4 w-4" />
                            削除
                          </button>
                        )}
                      </div>
                    </>,
                    document.body
                  )}
                </div>
              </div>
            </div>

            <div>
              <div onClick={(e) => { e.stopPropagation(); if (!shouldSuppressCardNavigation()) navigate(`/post/${post.id}`); }}>
                {displayContent && (
                  <p className={isMobile ? "whitespace-pre-wrap break-words text-[16px] leading-normal text-foreground mt-1" : "whitespace-pre-wrap break-words text-base leading-relaxed text-foreground mt-1"}>
                    {renderContentWithMentions(displayContent)}
                  </p>
                )}
                {failedUrls.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {failedUrls.map((url, idx) => (
                      <div key={`failed-${idx}`}>
                        {renderContentWithLinks(url)}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {((post as any).is_bot || post.isBot) && (
                <div className="flex items-center gap-1 mt-1.5 text-muted-foreground/70">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span className={isMobile ? "text-[13px] font-medium" : "text-[15px] font-medium"}>AIで生成</span>
                </div>
              )}

              {youtubeId && (
                <div onClick={(e) => e.stopPropagation()} className="mt-3">
                  <YouTubeEmbed videoId={youtubeId} />
                </div>
              )}
              {spotifyUrls.length > 0 && (
                <div onClick={(e) => e.stopPropagation()} className="space-y-2 mt-3">
                  {spotifyUrls.map((url, idx) => (
                    <SpotifyEmbed key={`spotify-${idx}`} url={url} />
                  ))}
                </div>
              )}
              {singleImageUrl ? (
                <div className="mt-3 flex max-w-full justify-start" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="block max-w-full cursor-zoom-in overflow-hidden rounded-2xl border border-border/50 bg-black/[0.025] text-left shadow-none dark:bg-white/[0.035]"
                    style={getSingleImageFrameStyle()}
                    onClick={(e) => handleImageClick(e, singleImageUrl)}
                    aria-label="画像を拡大表示"
                  >
                    <img
                      src={singleImageUrl}
                      alt="投稿画像"
                      className="block select-none"
                      style={getSingleImageDisplayStyle()}
                      draggable={false}
                      loading="lazy"
                      decoding="async"
                      onLoad={(e) => {
                        const img = e.currentTarget;
                        if (img.naturalWidth && img.naturalHeight) {
                          const nextNaturalSize = {
                            width: img.naturalWidth,
                            height: img.naturalHeight,
                          };
                          setCachedNaturalSize(singleImageUrl, nextNaturalSize);
                          setSingleImageNaturalSize(nextNaturalSize);
                        }
                      }}
                      onError={() => {
                        setFailedUrls((prev) => (
                          prev.includes(singleImageUrl) ? prev : [...prev, singleImageUrl]
                        ));
                      }}
                    />
                  </button>
                </div>
              ) : (
                <div 
                  className="cursor-zoom-in"
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    if (target.tagName === 'IMG' && (target as HTMLImageElement).src) {
                      handleImageClick(e, (target as HTMLImageElement).src);
                    } else {
                      handleCardClick();
                    }
                  }}
                >
                  <PostImages 
                    urls={allImageUrls} 
                    onImageError={(url) => {
                      if (!failedUrls.includes(url)) {
                        setFailedUrls(prev => [...prev, url]);
                      }
                    }}
                  />
                </div>
              )}
            </div>

            {/* --- リアクションバッジエリア（reactionsがある時のみレンダリングされ、ない時は完全に消滅） --- */}
            {reactions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 relative" onClick={(e) => e.stopPropagation()}>
                {reactions.map((g) => {
                  const hasMyReaction = currentUserId ? g.user_ids.includes(currentUserId) : false;
                  const isPopupOpen = activePopupEmoji === g.emoji;

                  return (
                    <div 
                      key={g.emoji} 
                      className="relative inline-block"
                      onMouseEnter={() => setActivePopupEmoji(g.emoji)}
                      onMouseLeave={() => setActivePopupEmoji(null)}
                    >
                      <button
                        onClick={(e) => handleAddReaction(g.emoji, e)}
                        onTouchStart={() => handleTouchStart(g.emoji)}
                        onTouchEnd={handleTouchEnd}
                        className={`inline-flex items-center gap-1.5 h-[45px] px-2.5 rounded-xl text-[15px] font-bold transition-all select-none outline-none border-none origin-center ${
                          hasMyReaction
                            ? 'bg-sky-500/15 dark:bg-sky-500/15 text-sky-500 dark:text-sky-400'
                            : 'bg-black/[0.05] dark:bg-muted/50 text-muted-foreground hover:bg-black/[0.08] dark:hover:bg-muted/80 hover:text-foreground'
                        }`}
                      >
                        {renderEmojiElement(g.emoji, "h-5 w-5 object-contain")}
                        <span className="tabular-nums text-sm font-black">{g.count}</span>
                      </button>

                      {/* --- リアクションユーザーポップアップ --- */}
                      {isPopupOpen && g.users.length > 0 && (
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-[260px] bg-white dark:bg-[#252932] border border-black/[0.08] dark:border-white/5 rounded-2xl shadow-2xl z-[60] flex p-3 pointer-events-none">
                          
                          <div className="w-[64px] h-[64px] shrink-0 flex items-center justify-center border-r border-black/[0.08] dark:border-white/10 pr-2.5 mr-2.5">
                            {renderEmojiElement(g.emoji, "h-12 w-12 object-contain")}
                          </div>

                          <div className="flex-1 min-w-0 flex flex-col gap-1.5 max-h-[160px] overflow-y-auto scrollbar-none">
                            {g.users.map((u) => (
                              <div key={u.id} className="flex items-center gap-2 min-w-0">
                                <Avatar className="h-5 w-5 shrink-0 border border-black/[0.08] dark:border-white/10">
                                  <AvatarImage src={u.avatarUrl} />
                                  <AvatarFallback className="text-[9px]">{u.displayName.slice(0, 1)}</AvatarFallback>
                                </Avatar>
                                <div className="min-w-0 flex-1 flex flex-col">
                                  <span className="text-[12px] font-black text-foreground dark:text-white truncate leading-none mb-0.5">
                                    {u.displayName}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground/70 truncate leading-none">
                                    @{u.username}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>

                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* --- アクションボタンエリア（上部要素とのマージンを mt-3 に均一化） --- */}
            <div className={isMobile ? "mt-2 flex items-center gap-1 text-muted-foreground relative h-8" : "mt-3 flex items-center gap-1 text-muted-foreground relative h-9"}>
              <div onClick={(e) => e.stopPropagation()} className="flex items-center h-full">
                <LikeButton 
                  postId={post.id} 
                  liked={post.likedByMe} 
                  count={post.likesCount} 
                />
              </div>
              <Link
                to={`/post/${post.id}`}
                onClick={(e) => e.stopPropagation()}
                className={isMobile ? "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] transition-colors hover:text-accent h-full" : "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors hover:text-accent h-full"}
              >
                <MessageCircle className="h-5 w-5" />
                <span className={isMobile ? "font-bold tabular-nums text-[15px]" : "font-bold tabular-nums text-sm"}>{formatDisplayCount(post.commentsCount)}</span>
              </Link>

              <div className="relative inline-flex items-center h-full" onClick={(e) => e.stopPropagation()}>
                <button
                  ref={buttonRef}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowShareMenu(false);
                    setShareMenuPosition(null);
                    setShowMenu(false);
                    setMoreMenuPosition(null);
                    setShowPicker(!showPicker);
                  }}
                  className={
                    isMobile
                      ? `inline-flex items-center justify-center gap-1.5 rounded-full px-2 py-1 text-[13px] transition-colors hover:text-accent h-full origin-center ${
                          showPicker ? 'text-accent bg-accent/10' : 'text-muted-foreground'
                        }`
                      : `inline-flex items-center justify-center p-1.5 rounded-full transition-colors hover:text-accent h-8 w-8 origin-center ${
                          showPicker ? 'text-accent bg-accent/10' : 'text-muted-foreground'
                        }`
                  }
                >
                  <Plus className="h-5 w-5" />
                </button>

                {showPicker && isMobile && typeof document !== 'undefined' && createPortal(
                  <>
                    {/* スマホでは body 直下へ出す。backdrop-filter/transform の親に固定配置を壊されないようにする */}
                    <div 
                      ref={pickerPanelRef}
                      className={`fixed bottom-[76px] left-1/2 transform -translate-x-1/2 w-[92vw] max-w-[340px] h-[430px] rounded-[24px] border border-border/80 shadow-2xl p-4 animate-slide-up-mobile overflow-y-auto overflow-x-hidden touch-pan-y ${timelinePortalThemeClass}`} 
                      style={{ zIndex: 2147483647 }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      onScroll={(e) => e.stopPropagation()}
                    >
                      {/* デフォルト絵文字 */}
                      <div className="grid grid-cols-5 gap-2.5 mb-3.5 shrink-0">
                        {defaultEmojis.map((emoji) => (
                          <button
                            key={emoji}
                            onClick={(e) => handleAddReaction(emoji, e)}
                            className="flex items-center justify-center h-11 w-11 text-2xl rounded-2xl hover:bg-black/[0.05] dark:hover:bg-white/10 transition-all origin-center"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>

                      {recentEmojis.length > 0 && (
                        <div className="mb-3.5 shrink-0">
                          <div className="text-[11px] font-bold text-muted-foreground/60 mb-1.5 px-0.5">最近使用</div>
                          <div className="flex flex-wrap gap-2.5">
                            {recentEmojis.map((emoji) => (
                              <button
                                key={`recent-${emoji}`}
                                onClick={(e) => handleAddReaction(emoji, e)}
                                className="flex items-center justify-center h-9 w-9 rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/10 transition-all origin-center"
                              >
                                {renderEmojiElement(emoji, "h-6 w-6 object-contain")}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* カスタム絵文字：内側の高さ固定を解除しバー全体のスクロールに統合 */}
                      <div className="timeline-portal-divider flex flex-col border-t border-black/[0.08] dark:border-white/5 pt-2">
                        <button
                          onClick={() => setIsEmojisOpen(!isEmojisOpen)}
                          className="flex items-center justify-between w-full px-0.5 py-1 text-[11px] font-black text-muted-foreground/80 hover:text-foreground transition-colors shrink-0"
                        >
                          <span className="truncate">カスタム絵文字</span>
                          <span className="text-[10px] opacity-60">{isEmojisOpen ? '▲' : '▼'}</span>
                        </button>

                        {isEmojisOpen && (
                          <div className="p-0.5 block mt-1">
                            {filteredCustomEmojis.length > 0 ? (
                              <div className="grid grid-cols-4 gap-2.5">
                                {filteredCustomEmojis.map((emoji) => (
                                  <button
                                    key={emoji.id}
                                    onClick={(e) => handleAddReaction(`:${emoji.name}:`, e)}
                                    title={`:${emoji.name}:`}
                                    className="flex items-center justify-center h-12 w-12 rounded-2xl hover:bg-black/[0.05] dark:hover:bg-white/10 transition-all p-1.5 origin-center"
                                  >
                                    {renderEmojiElement(`:${emoji.name}:`, "h-9 w-9 object-contain")}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div className="text-center text-[11px] text-muted-foreground/50 py-6">絵文字が見つかりません</div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </>,
                  document.body
                )}

                {showPicker && !isMobile && (
                  <>
                    {/* =========================================================================
                       【PC専用ポップアップ：バー全体をスクロール対応化・縦幅 h-[280px]】
                       ========================================================================= */}
                    <div 
                      ref={pickerPanelRef}
                      className={`absolute bottom-full left-0 mb-2 w-[260px] h-[280px] rounded-[20px] border border-border/80 shadow-2xl z-[100001] p-2.5 animate-zoom-in-pc overflow-y-auto overflow-x-hidden ${timelinePortalThemeClass}`} 
                      onWheel={(e) => e.stopPropagation()}
                    >
                      {/* デフォルト絵文字 */}
                      <div className="grid grid-cols-7 gap-1 mb-2 shrink-0">
                        {defaultEmojis.map((emoji) => (
                          <button
                            key={emoji}
                            onClick={(e) => handleAddReaction(emoji, e)}
                            className="flex items-center justify-center h-8 w-8 text-xl rounded-lg hover:bg-black/[0.05] dark:hover:bg-white/10 transition-all origin-center"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>

                      {recentEmojis.length > 0 && (
                        <div className="mb-2 shrink-0">
                          <div className="text-[11px] font-bold text-muted-foreground/60 mb-1 px-0.5">最近使用</div>
                          <div className="flex flex-wrap gap-1">
                            {recentEmojis.map((emoji) => (
                              <button
                                key={`recent-${emoji}`}
                                onClick={(e) => handleAddReaction(emoji, e)}
                                className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-black/[0.05] dark:hover:bg-white/10 transition-all origin-center"
                              >
                                {renderEmojiElement(emoji, "h-[18px] w-[18px] object-contain")}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* カスタム絵文字：内側の高さ制限を外し全体のスクロールに委ねる */}
                      <div className="timeline-portal-divider flex flex-col border-t border-black/[0.08] dark:border-white/5 pt-1.5">
                        <button
                          onClick={() => setIsEmojisOpen(!isEmojisOpen)}
                          className="flex items-center justify-between w-full px-0.5 py-1 text-[11px] font-black text-muted-foreground/80 hover:text-foreground transition-colors shrink-0"
                        >
                          <span className="truncate">カスタム絵文字</span>
                          <span className="text-[10px] opacity-60">{isEmojisOpen ? '▲' : '▼'}</span>
                        </button>

                        {isEmojisOpen && (
                          <div className="p-0.5 mt-1">
                            {filteredCustomEmojis.length > 0 ? (
                              <div className="grid grid-cols-6 gap-1">
                                {filteredCustomEmojis.map((emoji) => (
                                  <button
                                    key={emoji.id}
                                    onClick={(e) => handleAddReaction(`:${emoji.name}:`, e)}
                                    title={`:${emoji.name}:`}
                                    className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-black/[0.05] dark:hover:bg-white/10 transition-all p-0.5 origin-center"
                                  >
                                    {renderEmojiElement(`:${emoji.name}:`, "h-6 w-6 object-contain")}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div className="text-center text-[11px] text-muted-foreground/50 py-4">絵文字が見つかりません</div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* 検索バー */}
                      <div className="timeline-portal-divider mt-2 pt-1.5 border-t border-black/[0.08] dark:border-white/5 shrink-0">
                        <input
                          type="text"
                          placeholder="検索"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="timeline-portal-search w-full h-8 bg-black/[0.03] dark:bg-black/30 border border-black/[0.08] dark:border-white/10 rounded-lg px-2.5 text-xs font-medium text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-pink-500/50 transition-colors"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="relative ml-auto inline-flex items-center h-full shrink-0" onClick={(e) => e.stopPropagation()}>
                <button
                  ref={shareButtonRef}
                  onClick={handleShareButtonClick}
                  aria-label="ポストを共有"
                  className={
                    isMobile
                      ? `inline-flex items-center justify-center gap-1.5 rounded-full px-2 py-1 text-[13px] transition-colors hover:text-accent h-full origin-center ${
                          showShareMenu ? 'text-accent bg-accent/10' : 'text-muted-foreground'
                        }`
                      : `inline-flex items-center justify-center p-1.5 rounded-full transition-colors hover:text-accent h-8 w-8 origin-center ${
                          showShareMenu ? 'text-accent bg-accent/10' : 'text-muted-foreground'
                        }`
                  }
                >
                  <Upload className="h-5 w-5" />
                </button>

                {showShareMenu && typeof document !== 'undefined' && createPortal(
                  <>
                    <div
                      className="fixed inset-0 bg-transparent"
                      style={{ zIndex: 2147483646 }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        closeShareMenu();
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    />
                    <div
                      ref={shareMenuRef}
                      className="fixed w-[min(calc(100vw-16px),16rem)] rounded-xl border border-border bg-card p-1 shadow-lg overflow-hidden animate-in fade-in zoom-in duration-100"
                      style={{
                        top: shareMenuPosition?.top ?? 0,
                        right: shareMenuPosition?.right ?? 8,
                        zIndex: 2147483647,
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={handleOpenLimeDropPanel}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted transition-colors"
                      >
                        <Send className="h-4 w-4 shrink-0" />
                        <span>LimeDropで送信</span>
                      </button>

                      <button
                        onClick={handleCopyPostLink}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted transition-colors"
                      >
                        <LinkIcon className="h-4 w-4 shrink-0" />
                        <span>{shareFeedback ?? 'リンクをコピー'}</span>
                      </button>

                      <button
                        onClick={handleNativePostShare}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted transition-colors"
                      >
                        <Upload className="h-4 w-4 shrink-0" />
                        <span>その他の方法でポストを送信</span>
                      </button>
                    </div>
                  </>,
                  document.body
                )}
              </div>

            </div>
          </div>
        </div>
      </article>

      {/* LimeDrop送信先選択 */}
      {showLimeDropPanel && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          style={{ zIndex: 2147483647 }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              handleCloseLimeDropPanel();
            }
          }}
        >
          <div
            ref={limeDropPanelRef}
            className="w-full max-w-[520px] overflow-hidden rounded-t-[28px] border border-border bg-card shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 sm:rounded-[28px]"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-border/70 px-5 py-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Send className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-muted-foreground">LimeDrop</p>
                <h2 className="truncate text-lg font-black text-foreground">ポストを共有</h2>
              </div>
              <button
                type="button"
                onClick={handleCloseLimeDropPanel}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-muted/80"
                aria-label="LimeDropを閉じる"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-5 py-4">
              <div className="mb-4 rounded-2xl border border-border/70 bg-muted/35 px-4 py-3">
                <p className="line-clamp-2 text-sm font-medium leading-relaxed text-foreground">
                  {getPostShareText()}
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {getPostShareUrl()}
                </p>
              </div>

              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-black text-foreground">人</h3>
                {limeDropLoading && (
                  <span className="text-xs font-bold text-muted-foreground">読み込み中...</span>
                )}
              </div>

              {limeDropFeedback && (
                <div className="mb-3 rounded-xl bg-primary/10 px-3 py-2 text-sm font-bold text-primary">
                  {limeDropFeedback}
                </div>
              )}

              {!limeDropLoading && limeDropTargets.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center">
                  <p className="text-sm font-bold text-foreground">送信できる相互フォロー中のユーザーがいません</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    LimeDropは相互フォロー中のユーザーにだけ送信できます。
                  </p>
                </div>
              )}

              {limeDropTargets.length > 0 && (
                <div className="grid max-h-[320px] grid-cols-3 gap-3 overflow-y-auto pb-1 sm:grid-cols-4">
                  {limeDropTargets.map((target) => {
                    const isSending = limeDropSendingUserId === target.id;

                    return (
                      <button
                        key={target.id}
                        type="button"
                        disabled={Boolean(limeDropSendingUserId)}
                        onClick={() => handleSendLimeDrop(target)}
                        className="flex min-w-0 flex-col items-center rounded-2xl px-2 py-3 text-center transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-70"
                      >
                        <Avatar className="h-14 w-14 border border-border">
                          <AvatarImage src={target.avatarUrl} alt={target.displayName} />
                          <AvatarFallback>{target.displayName.slice(0, 1)}</AvatarFallback>
                        </Avatar>
                        <span className="mt-2 w-full truncate text-xs font-black text-foreground">
                          {isSending ? '送信中...' : target.displayName}
                        </span>
                        <span className="mt-0.5 w-full truncate text-[11px] text-muted-foreground">
                          @{target.username}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 画像拡大オーバーレイ */}
      {selectedImageUrl && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 flex flex-col items-center justify-center bg-black/95 backdrop-blur-sm animate-in fade-in duration-200"
          style={{ zIndex: 2147483647 }}
          onClick={() => setSelectedImageUrl(null)}
        >
          <button
            className="absolute top-5 left-5 z-10 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
            onClick={() => setSelectedImageUrl(null)}
          >
            <X className="h-6 w-6" />
          </button>

          <div className="relative flex max-h-full max-w-full items-center justify-center p-4">
            <img
              src={selectedImageUrl}
              alt="Expanded view"
              className="max-h-[85vh] max-w-[95vw] object-contain shadow-2xl animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div
            className="absolute bottom-0 left-0 right-0 flex items-center justify-center bg-gradient-to-t from-black/80 to-transparent pb-8 pt-10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-8 rounded-full bg-black/40 px-6 py-3 backdrop-blur-md border border-white/10">
              <div className="scale-125">
                <LikeButton
                  postId={post.id}
                  liked={post.likedByMe}
                  count={post.likesCount}
                />
              </div>
              <button
                onClick={() => {
                  setSelectedImageUrl(null);
                  navigate(`/post/${post.id}`);
                }}
                className="inline-flex items-center gap-2 text-white/90 hover:text-white transition-colors"
              >
                <MessageCircle className="h-6 w-6" />
                <span className="font-bold tabular-nums text-lg">{formatDisplayCount(post.commentsCount)}</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export const PostCard = memo(PostCardComponent);
PostCard.displayName = 'PostCard';
