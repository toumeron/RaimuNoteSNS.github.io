import { accountReviewsKey } from '@/api/account-reviews';
import { AccountReviewsTab } from '@/components/reviews/AccountReviewsTab';
import { useProfileHighlights } from '@/hooks/useProfileHighlights';
import {splitMentionText,mentionProfileHandle} from '@/lib/utils';
import { ProfileVirtualizedListItem } from '@/components/profile/ProfileVirtualizedRow';
import { openMediaViewer } from '@/components/media/openMediaViewer';
import {getPostById} from '@/api/posts';
import {getProfilePin,profilePinKey} from '@/api/profile-pins';
import {PostLinkPreview} from '@/components/post/LinkPreviewCard';
import { renderStickerText } from '@/components/stickers/renderStickerText';
import { hasStickers } from '@/lib/stickers';
import { profilePostIdentity } from '@/lib/profilePostIdentity';
import { SpacePostCard } from '@/components/spaces/SpacePostCard';
import { spaceLinkIn } from '@/lib/spaceLinks';
import { BookmarkButton } from '@/components/post/BookmarkButton';
import { ReplyShare } from '@/components/post/ReplyShare';
import { useAuth } from '@/hooks/useAuth';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { buildProfileReplyThreads } from '@/lib/profileReplyThreads';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { useInView } from 'react-intersection-observer';
import { Loader2, MoreHorizontal, ChartBarBig, Image as ImageIcon, X, MessageCircle, Plus, Upload, Link as LinkIcon, Send, Globe, Heart } from 'lucide-react';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { PostCard } from '@/components/feed/PostCard';
import { RepostButton } from '@/components/feed/RepostButton';
import { RepostedReplyCard } from '@/components/post/RepostedReplyCard';
import { replyToPost } from '@/api/reply-reposts';
import { PostCardSkeleton } from '@/components/feed/PostCardSkeleton';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LikeButton } from '@/components/post/LikeButton';
import { Commentlikebutton } from '@/components/post/Commentlikebutton';
import { PostImages } from '@/components/feed/PostImages';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { SpotifyEmbed } from '@/components/SpotifyEmbed';
import { formatRelative } from '@/lib/format';
import { getYouTubeId } from '@/lib/utils';
import { getCurrentUserId } from '@/lib/currentUser';
import { supabase } from '@/lib/supabase';
import { fetchBlueskyAuthorFeed, fetchBlueskyProfile } from '@/lib/bluesky';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  useProfile,
  useUserPostsInfinite,
  useUserLikesInfinite,
  useUserMediaInfinite,
  useUserReactionsInfinite,
} from '@/hooks/useProfile';

type ProfileTabValue = 'posts' | 'likes' | 'media' | 'reactions' | 'highlights' | 'reviews';

const profileTabs: Array<{ value: ProfileTabValue; label: string }> = [
  { value: 'posts', label: 'ポスト' },
  { value: 'highlights', label: 'ハイライト' },
  { value: 'media', label: 'メディア' },
  { value: 'reviews', label: 'レビュー' },
  { value: 'likes', label: 'いいね' },
  { value: 'reactions', label: 'リアクション' },
];

const PROFILE_REPLY_ITEM = 'profile-reply';
const PROFILE_POST_ITEM = 'profile-post';
const PROFILE_REPLY_LIMIT = 80;

// data.pages が未取得の間 `?? []` を書くと毎レンダー新しい配列参照が
// 生成され、それに依存する useMemo が無駄に再計算されてしまう。
// 同じ空配列を使い回すことでその再計算を防ぐ。
const EMPTY_ARRAY: any[] = [];

const normalizePostVisibility = (visibility: unknown) => {
  const normalized = typeof visibility === 'string' ? visibility.trim().toLowerCase() : '';
  return normalized || 'public';
};

const getPostOwnerId = (post: any) => (
  post?.user_id ?? post?.userId ?? post?.author?.id ?? post?.profiles?.id ?? post?.user?.id ?? ''
);

const canShowParentPostInsideProfileReplies = ({
  post,
  currentUserId,
  visibleLimitedParentAuthorIds = new Set<string>(),
}: {
  post: any;
  currentUserId: string | null;
  visibleLimitedParentAuthorIds?: Set<string>;
}) => {
  if (!post?.id) return false;

  const authorId = getPostOwnerId(post);
  const visibility = normalizePostVisibility(post.visibility);

  if (visibility === 'public') return true;

  // プロフィールの返信欄では、非公開/限定公開の親投稿は投稿者本人か、投稿者が閲覧者をフォローしている場合だけ出す。
  if (currentUserId && authorId && authorId === currentUserId) return true;
  if (currentUserId && authorId && visibleLimitedParentAuthorIds.has(authorId)) return true;

  return false;
};

// --- Blueskyの投稿を判定・表示するためのヘルパー（PostCard/Feedと同じロジック） ---
// プロフィールの返信スレッドで表示する「親ポスト」がBluesky由来だった場合、
// 外部リンクへ飛ばさずに内容（本文・画像・埋め込み）はそのまま表示しつつ、
// プロフィール遷移やリアクション・返信などの実操作だけBluesky側で行ってもらう。
type BlueskyPostFields = {
  source?: 'lime' | 'bluesky' | 'misskey';
  blueskyUrl?: string;
  blueskyUri?: string;
};

const isBlueskyPostLike = (post: { id?: string; source?: string }) => (
  post.source === 'bluesky' || (String(post.id || '').startsWith('bsky:') || String(post.id || '').startsWith('misskey:'))
);

const getBlueskyPostUrl = (post: Pick<BlueskyPostFields, 'blueskyUrl'> & { author?: { username?: string }; id?: string }) => {
  if (post.blueskyUrl) return post.blueskyUrl;

  const id = String(post.id || '');
  if (id.startsWith('misskey:')) return id.slice('misskey:'.length);
  if (!id.startsWith('bsky:')) return null;

  const uri = id.slice('bsky:'.length);
  const rkey = uri.split('/').pop();
  const handle = post.author?.username;
  if (!rkey || !handle) return null;
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
};

// Bluesky由来の投稿IDは `bsky:at://did:.../app.bsky.feed.post/rkey` のようにスラッシュを含む。
// エンコードせず /post/:id に渡すと経路が分割されて404になるため、遷移前に必ずエンコードする（PostCard.tsxと同様）。
const getAppPostPath = (postId: string) => `/post/${encodeURIComponent(String(postId || ''))}`;

const imageRegex =
  /https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s]*)?|https?:\/\/pbs\.twimg\.com\/media\/[^\s?]+(?:\?[^\s]*)?/gi;

const spotifyRegex = /https:\/\/open\.spotify\.com\/(?:[\w-]+\/)?(track|album|playlist)\/[a-zA-Z0-9._?=&/%-]+/gi;
const youtubeUrlRegex = /(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/(watch\?v=|embed\/|shorts\/)?([a-zA-Z0-9_-]{11})([^?\s\n]*)?(\S+)?/g;

interface ProfileThreadReactionGroup {
  emoji: string;
  count: number;
  userIds: string[];
}

interface ProfileThreadImageSelection {
  url: string;
  targetType: 'post' | 'comment';
  targetId: string;
  postId: string;
  liked: boolean;
  likesCount: number;
  replyCount?: number;
}

type ProfileThreadImageTarget = Omit<ProfileThreadImageSelection, 'url'>;

interface ProfileReplyThreadComment {
  parentCommentId?: string | null;
  replyToUsername?: string;
  clientName?: string;
  id: string;
  postId: string;
  userId: string;
  content: string;
  imageUrls?: string[];
  createdAt: string;
  likesCount: number;
  likedByMe: boolean;
  author: any;
  reactions: ProfileThreadReactionGroup[];
}

interface ProfileReplyThread {
  id: string;
  createdAt: string;
  comment: ProfileReplyThreadComment;
  comments: ProfileReplyThreadComment[];
  parentPost: any | null;
  parentReactions: ProfileThreadReactionGroup[];
}

interface ProfilePostItem {
  __profileItemType: typeof PROFILE_POST_ITEM;
  sortAt: string;
  post: any;
}

interface ProfileReplyItem {
  __profileItemType: typeof PROFILE_REPLY_ITEM;
  sortAt: string;
  reply: ProfileReplyThread;
}

interface CustomEmoji {
  id: string;
  name: string;
  public_id: string;
  format: string;
  uploaded_by?: string;
}

interface LimeDropTarget {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

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

const createProfileReactionBurst = (targetElement: HTMLElement) => {
  const rect = targetElement.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  targetElement.classList.remove('misskey-elastic-active');
  void targetElement.offsetWidth;
  targetElement.classList.add('misskey-elastic-active');

  const batchId = Math.random().toString(36).substring(2, 9);
  const ring: ReplicatedRing = {
    id: `ring-${batchId}`,
    x: centerX,
    y: centerY,
    width: rect.width + 4,
    height: rect.height + 4,
  };

  const colors = ['#d4f022', '#e6007e', '#22f0d8', '#d4f022', '#e6007e'];
  const dots: ReplicatedDot[] = Array.from({ length: 16 }).map((_, index) => ({
    id: `dot-${batchId}-${index}`,
    x: centerX,
    y: centerY,
    angle: (index / 16) * 360 + (Math.random() * 20 - 10),
    distance: rect.width / 2 + (Math.random() * 16 - 4),
    color: colors[Math.floor(Math.random() * colors.length)],
    size: Math.random() * 5 + 5,
    delay: Math.random() * 40,
  }));

  return { batchId, ring, dots };
};

let cachedProfileCurrentUserId: string | null | undefined;
let cachedProfileCurrentUserIdPromise: Promise<string | null> | null = null;

const getCachedCurrentUserId = async () => {
  if (cachedProfileCurrentUserId !== undefined) {
    return cachedProfileCurrentUserId;
  }

  if (!cachedProfileCurrentUserIdPromise) {
    cachedProfileCurrentUserIdPromise = getCurrentUserId()
      .then((id) => {
        cachedProfileCurrentUserId = id;
        return id;
      })
      .catch((error) => {
        cachedProfileCurrentUserIdPromise = null;
        throw error;
      });
  }

  return cachedProfileCurrentUserIdPromise;
};

let cachedProfileCustomEmojis: CustomEmoji[] | null = null;
let cachedProfileCustomEmojisPromise: Promise<CustomEmoji[]> | null = null;

const loadCachedProfileCustomEmojis = async () => {
  if (cachedProfileCustomEmojis) {
    return cachedProfileCustomEmojis;
  }

  if (!cachedProfileCustomEmojisPromise) {
    cachedProfileCustomEmojisPromise = (async (): Promise<CustomEmoji[]> => {
      const { data, error } = await supabase
        .from('custom_emojis')
        .select('id, name, public_id, format, uploaded_by')
        .order('created_at', { ascending: false });

      if (error) throw error;

      cachedProfileCustomEmojis = data || [];
      return cachedProfileCustomEmojis;
    })().catch((error) => {
      cachedProfileCustomEmojisPromise = null;
      throw error;
    });
  }

  return cachedProfileCustomEmojisPromise;
};

let sharedProfileIsMobile = typeof window !== 'undefined' ? window.innerWidth < 640 : false;
let sharedProfileViewportListenerAttached = false;
const sharedProfileViewportListeners = new Set<(value: boolean) => void>();

const subscribeProfileViewport = (listener: (value: boolean) => void) => {
  if (typeof window === 'undefined') return () => {};

  sharedProfileViewportListeners.add(listener);

  if (!sharedProfileViewportListenerAttached) {
    sharedProfileViewportListenerAttached = true;

    window.addEventListener('resize', () => {
      const next = window.innerWidth < 640;
      if (next === sharedProfileIsMobile) return;

      sharedProfileIsMobile = next;
      sharedProfileViewportListeners.forEach((callback) => callback(next));
    }, { passive: true });
  }

  return () => {
    sharedProfileViewportListeners.delete(listener);
  };
};

const useProfileViewportIsMobile = () => {
  const [isMobile, setIsMobile] = useState(sharedProfileIsMobile);

  useEffect(() => subscribeProfileViewport(setIsMobile), []);

  return isMobile;
};

// ==== プルダウン更新（Pull to refresh） ====
// Twitter同様に、タイムライン最上部でさらに上へ引っ張ると最新の投稿を
// 再取得できるようにする。モバイルはタッチ操作、PCはマウスドラッグの
// 両方に対応する（スクロール位置が最上部のときだけ反応し、それ以外の
// 通常のスクロール・クリック操作には一切影響しない）。
const PULL_REFRESH_THRESHOLD = 64; // これ以上引っ張ると離した時に更新される
const PULL_REFRESH_MAX = 96; // インジケーターが追従する見た目上の最大距離

const usePullToRefresh = (onRefresh: () => Promise<void> | void, enabled: boolean) => {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);

  const startYRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const pullDistanceRef = useRef(0);
  const isRefreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const applyPullDistance = useCallback((value: number) => {
    pullDistanceRef.current = value;
    setPullDistance(value);
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const getScrollTop = () => window.scrollY || document.documentElement.scrollTop || 0;

    const beginDrag = (clientY: number) => {
      if (getScrollTop() > 0 || isRefreshingRef.current) {
        startYRef.current = null;
        draggingRef.current = false;
        return;
      }

      startYRef.current = clientY;
      draggingRef.current = true;
    };

    const updateDrag = (clientY: number, event: { preventDefault: () => void; cancelable?: boolean }) => {
      if (!draggingRef.current || startYRef.current === null) return;

      if (getScrollTop() > 0) {
        // 引っ張っている最中に本文側がスクロールしてしまったら中断する
        draggingRef.current = false;
        startYRef.current = null;
        setIsPulling(false);
        applyPullDistance(0);
        return;
      }

      const delta = clientY - startYRef.current;

      if (delta <= 0) {
        applyPullDistance(0);
        return;
      }

      if (event.cancelable !== false) {
        event.preventDefault();
      }

      setIsPulling(true);
      // 引っ張るほど抵抗が強くなるようにダンピングをかける（Twitter等と同様の挙動）
      applyPullDistance(Math.min(PULL_REFRESH_MAX, delta * 0.5));
    };

    const endDrag = async () => {
      if (!draggingRef.current) return;

      draggingRef.current = false;
      startYRef.current = null;
      setIsPulling(false);

      const shouldRefresh = pullDistanceRef.current >= PULL_REFRESH_THRESHOLD;

      if (shouldRefresh && !isRefreshingRef.current) {
        isRefreshingRef.current = true;
        setIsRefreshing(true);
        applyPullDistance(PULL_REFRESH_THRESHOLD);

        try {
          await onRefreshRef.current();
        } catch (error) {
          console.error('Pull to refresh failed:', error);
        } finally {
          isRefreshingRef.current = false;
          setIsRefreshing(false);
          applyPullDistance(0);
        }
      } else {
        applyPullDistance(0);
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || (event.target as HTMLElement)?.closest('.lime-media-lightbox')) return;
      beginDrag(event.touches[0].clientY);
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      updateDrag(event.touches[0].clientY, event);
    };

    const handleTouchEnd = () => {
      void endDrag();
    };

    const handleMouseDown = (event: MouseEvent) => {
      // 左クリックのみ対象。入力欄・ボタン・リンク上でのドラッグ開始は無視して
      // 既存の操作（テキスト選択やクリック）を邪魔しないようにする。
      if (event.button !== 0) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, a, [role="button"], [contenteditable="true"]')) {
        return;
      }

      beginDrag(event.clientY);
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!draggingRef.current) return;
      updateDrag(event.clientY, event);
    };

    const handleMouseUp = () => {
      void endDrag();
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);

      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [enabled, applyPullDistance]);

  // ドラッグ中はブラウザ標準のテキスト選択が走らないようにする
  useEffect(() => {
    if (typeof document === 'undefined') return;

    document.body.style.userSelect = isPulling ? 'none' : '';

    return () => {
      document.body.style.userSelect = '';
    };
  }, [isPulling]);

  return { pullDistance, isRefreshing, isPulling };
};

type ProfileFeedItem = ProfilePostItem | ProfileReplyItem | any;

const isProfileReplyItem = (item: ProfileFeedItem): item is ProfileReplyItem => {
  return item?.__profileItemType === PROFILE_REPLY_ITEM;
};

const formatDisplayCount = (count: number) => {
  const safeCount = Number(count) || 0;

  if (safeCount >= 10000) {
    return (safeCount / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  }

  return safeCount.toLocaleString();
};

const uniqueStrings = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const getImageUrlsFromItem = (item: any) => {
  const dbImages = Array.isArray(item?.imageUrls)
    ? item.imageUrls
    : Array.isArray(item?.image_urls)
      ? item.image_urls
      : [];

  const extractedImages = typeof item?.content === 'string' ? item.content.match(imageRegex) || [] : [];

  return uniqueStrings([...dbImages, ...extractedImages]).slice(0, 4);
};

const getSpotifyUrls = (content: string) => {
  return content.match(spotifyRegex) || [];
};

const stripPreviewUrls = (content: string) => {
  return content
    .replace(youtubeUrlRegex, '')
    .replace(imageRegex, '')
    .replace(spotifyRegex, '')
    .trim();
};

const renderProfileThreadTextWithUrls = (text: string) => {
  if (!text) return null;

  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);

  return parts.map((part, index) => {
    if (part.match(urlRegex)) {
      return (
        <a
          key={`profile-thread-url-${index}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-pink-500 hover:underline transition-colors"
          onClick={(event) => event.stopPropagation()}
        >
          {part}
        </a>
      );
    }

    return part;
  });
};

const renderProfileThreadTextWithHashtags = (text: string, navigate: (to: string) => void) => {
  if (!text) return null;

  const parts = text.split(/(#[^\s#　.,!?:;'"()\[\]{}<>]+)/g);

  return parts.map((part, index) => {
    if (part.startsWith('#')) {
      return (
        <button
          key={`profile-thread-hashtag-${index}`}
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            navigate(`/search?q=${encodeURIComponent(part)}`);
          }}
          className="text-pink-500 hover:underline transition-colors inline-block align-baseline"
        >
          {part}
        </button>
      );
    }

    return renderProfileThreadTextWithUrls(part);
  });
};

const renderProfileThreadTextWithMentions = (text: string, navigate: (to: string) => void, author?:{id?:string;username?:string}): React.ReactNode => {
  if (hasStickers(text)) return renderStickerText(text, part=>renderProfileThreadTextWithMentions(part,navigate,author));
  if (!text) return null;

  const parts = splitMentionText(text);

  return parts.map((part, index) => {
    if (part.startsWith('@')) {
      const username = mentionProfileHandle(part,author);

      return (
        <Link
          key={`profile-thread-mention-${index}`}
          to={`/u/${username}`}
          className="text-pink-500 hover:underline transition-colors"
          onClick={(event) => event.stopPropagation()}
        >
          {part}
        </Link>
      );
    }

    return renderProfileThreadTextWithHashtags(part, navigate);
  });
};

// 投稿者情報の補完処理。以前は Profile() コンポーネント内で毎レンダー
// 再生成されていたが、props/state に依存しない純粋関数なのでモジュール
// スコープに固定し、レンダーごとの関数再生成コストをなくす。
const normalizeAuthor = (author: any, fallbackUserId = ''): any => {
  const safeUsername = author?.username ?? '';
  const safeDisplayName = author?.display_name ?? author?.displayName ?? safeUsername;

  return {
    ...author,
    id: author?.id ?? fallbackUserId ?? '',
    username: safeUsername,
    display_name: safeDisplayName,
    displayName: safeDisplayName,
    bio: author?.bio ?? '',
    avatar_url: author?.avatar_url ?? author?.avatarUrl ?? null,
    avatarUrl: author?.avatarUrl ?? author?.avatar_url ?? null,
    cover_url: author?.cover_url ?? author?.coverUrl ?? null,
    coverUrl: author?.coverUrl ?? author?.cover_url ?? null,
    created_at: author?.created_at ?? author?.createdAt ?? new Date().toISOString(),
    createdAt: author?.createdAt ?? author?.created_at ?? new Date().toISOString(),
    is_official: !!(author?.is_official ?? author?.isOfficial),
    isOfficial: !!(author?.isOfficial ?? author?.is_official),
    emoji_effect: author?.emoji_effect ?? author?.emojiEffect ?? '',
    emojiEffect: author?.emojiEffect ?? author?.emoji_effect ?? '',
    bot_enabled: !!(author?.bot_enabled ?? author?.botEnabled),
    botEnabled: !!(author?.botEnabled ?? author?.bot_enabled),
    bot_prompt: author?.bot_prompt ?? author?.botPrompt ?? '',
    botPrompt: author?.botPrompt ?? author?.bot_prompt ?? '',
    bot_interval_hours: author?.bot_interval_hours ?? author?.botIntervalHours ?? 5,
    botIntervalHours: author?.botIntervalHours ?? author?.bot_interval_hours ?? 5,
    prefecture: author?.prefecture ?? '',
    city: author?.city ?? '',
  };
};

// PostCardに渡す前に、undefinedになりやすい投稿情報を補完する
// （こちらも純粋関数のためモジュールスコープに固定）
const normalizePost = (post: any, reaction?: any): any | null => {
  if (!post) return null;

  const baseAuthor = post.author ?? post.profiles ?? post.user ?? null;
  const safeAuthor = normalizeAuthor(baseAuthor, post.user_id ?? post.userId ?? '');

  const imageUrls = Array.isArray(post.imageUrls)
    ? post.imageUrls
    : Array.isArray(post.image_urls)
      ? post.image_urls
      : [];

  return {
    ...post,

    id: post.id ?? '',

    user_id: post.user_id ?? post.userId ?? safeAuthor.id,
    userId: post.userId ?? post.user_id ?? safeAuthor.id,

    content: post.content ?? '',

    image_urls: imageUrls,
    imageUrls,

    created_at: post.created_at ?? post.createdAt ?? new Date().toISOString(),
    createdAt: post.createdAt ?? post.created_at ?? new Date().toISOString(),

    likes_count: Number(post.likes_count ?? post.likesCount ?? 0),
    likesCount: Number(post.likesCount ?? post.likes_count ?? 0),

    comments_count: Number(post.comments_count ?? post.commentsCount ?? 0),
    commentsCount: Number(post.commentsCount ?? post.comments_count ?? 0),

    reposts_count: Number(post.reposts_count ?? post.repostsCount ?? 0),
    repostsCount: Number(post.repostsCount ?? post.reposts_count ?? 0),

    liked_by_me: !!(post.liked_by_me ?? post.likedByMe),
    likedByMe: !!(post.likedByMe ?? post.liked_by_me),

    reposted_by_me: !!(post.reposted_by_me ?? post.repostedByMe),
    repostedByMe: !!(post.repostedByMe ?? post.reposted_by_me),

    client_name: post.client_name ?? post.clientName ?? '',
    clientName: post.clientName ?? post.client_name ?? '',

    parent_id: post.parent_id ?? post.parentId ?? null,
    parentId: post.parentId ?? post.parent_id ?? null,

    is_quote: !!(post.is_quote ?? post.isQuote),
    isQuote: !!(post.isQuote ?? post.is_quote),

    visibility: post.visibility ?? 'public',

    is_bot: !!(post.is_bot ?? post.isBot),
    isBot: !!(post.isBot ?? post.is_bot),

    source_twitter: !!(post.source_twitter ?? post.sourceTwitter),
    sourceTwitter: !!(post.sourceTwitter ?? post.source_twitter),

    origin_url: post.origin_url ?? post.originUrl ?? '',
    originUrl: post.originUrl ?? post.origin_url ?? '',

    prefecture: post.prefecture ?? '',
    city: post.city ?? '',

    author: safeAuthor,
    profiles: safeAuthor,
    user: safeAuthor,

    reactionId: reaction?.id ?? post.reactionId ?? null,
    reactionEmoji: reaction?.emoji ?? post.reactionEmoji ?? '',
    reactionCreatedAt: reaction?.created_at ?? post.reactionCreatedAt ?? null,

    reactionEmojis: Array.isArray(post.reactionEmojis)
      ? post.reactionEmojis
      : reaction?.emoji
        ? [reaction.emoji]
        : [],
  };
};

// 通常投稿・いいね投稿でも同じ投稿が重複した場合に key 警告を防ぐ
const uniquePostsById = (posts: any[]) => {
  const map = new Map<string, any>();

  posts.forEach((post: any) => {
    const normalized = normalizePost(post);
    if (!normalized?.id) return;

    const key = profilePostIdentity(normalized);
    if (!map.has(key)) {
      map.set(key, normalized);
    }
  });

  return Array.from(map.values());
};

// リアクション欄用：全ページをまとめてから同じ投稿を1枚にまとめる
const groupReactionPosts = (reactions: any[]) => {
  const grouped = new Map<string, any>();

  reactions.forEach((reaction: any) => {
    const rawPost = reaction.posts ?? reaction.post;
    const post = normalizePost(rawPost, reaction);

    if (!post?.id) return;

    const existing = grouped.get(post.id);
    const nextEmoji = reaction.emoji ?? post.reactionEmoji ?? '';

    if (!existing) {
      grouped.set(post.id, {
        ...post,
        reactionId: reaction.id ?? post.reactionId ?? post.id,
        reactionEmoji: nextEmoji,
        reactionCreatedAt: reaction.created_at ?? post.reactionCreatedAt ?? null,
        reactionEmojis: nextEmoji ? [nextEmoji] : [],
      });
      return;
    }

    const currentEmojis = Array.isArray(existing.reactionEmojis)
      ? existing.reactionEmojis
      : existing.reactionEmoji
        ? [existing.reactionEmoji]
        : [];

    const mergedEmojis =
      nextEmoji && !currentEmojis.includes(nextEmoji)
        ? [...currentEmojis, nextEmoji]
        : currentEmojis;

    grouped.set(post.id, {
      ...existing,
      reactionId: existing.reactionId ?? reaction.id ?? post.id,
      reactionCreatedAt: existing.reactionCreatedAt ?? reaction.created_at ?? null,
      reactionEmojis: mergedEmojis,
      reactionEmoji: mergedEmojis.join(' '),
    });
  });

  return Array.from(grouped.values());
};

const ProfileThreadEmbeds = memo(function ProfileThreadEmbeds({
  item,
  imageTarget,
  onImageClick,
  onImageError,
}: {
  item: any;
  imageTarget: ProfileThreadImageTarget;
  onImageClick: (selection: ProfileThreadImageSelection) => void;
  onImageError: (url: string) => void;
}) {
  const content = item?.content ?? '';
  const youtubeId = getYouTubeId(content);
  const spotifyUrls = getSpotifyUrls(content);
  const allImageUrls = getImageUrlsFromItem(item);
  const singleImageUrl = allImageUrls.length === 1 ? allImageUrls[0] : null;

  const isMobile = useProfileViewportIsMobile();
  const [singleImageNaturalSize, setSingleImageNaturalSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    setSingleImageNaturalSize(null);
  }, [singleImageUrl]);

  const openImage = (url: string) => {
    onImageClick({
      ...imageTarget,
      url,
    });
  };

  const getSingleImageFrameStyle = (): CSSProperties => {
    if (!singleImageNaturalSize) {
      return {
        width: '100%',
        maxWidth: '100%',
      };
    }

    const naturalWidth = Math.max(1, singleImageNaturalSize.width);
    const naturalHeight = Math.max(1, singleImageNaturalSize.height);
    const ratio = naturalWidth / naturalHeight;

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

  const getSingleImageDisplayStyle = (): CSSProperties => ({
    width: '100%',
    height: 'auto',
    objectFit: 'contain',
  });

  return (
    <>
      <SpacePostCard content={content} />
      <PostLinkPreview content={content} />
      {youtubeId && (
        <div className="mt-3" onClick={(e) => e.stopPropagation()}>
          <YouTubeEmbed videoId={youtubeId} />
        </div>
      )}

      {spotifyUrls.length > 0 && (
        <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
          {spotifyUrls.map((url, idx) => (
            <SpotifyEmbed key={`profile-thread-spotify-${idx}-${url}`} url={url} />
          ))}
        </div>
      )}

      {singleImageUrl ? (
        <div className="mt-3 flex max-w-full justify-start">
          <button
            type="button"
            className="block max-w-full cursor-zoom-in overflow-hidden rounded-2xl border border-border/50 bg-black/[0.025] text-left shadow-none dark:bg-white/[0.035]"
            style={getSingleImageFrameStyle()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openImage(singleImageUrl);
            }}
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
              onLoad={(event) => {
                const img = event.currentTarget;
                if (img.naturalWidth && img.naturalHeight) {
                  setSingleImageNaturalSize({
                    width: img.naturalWidth,
                    height: img.naturalHeight,
                  });
                }
              }}
              onError={() => {
                onImageError(singleImageUrl);
              }}
            />
          </button>
        </div>
      ) : allImageUrls.length > 0 ? (
        <div
          className="cursor-zoom-in"
          onClick={(e) => {
            const target = e.target as HTMLElement;

            if (target.tagName === 'IMG' && (target as HTMLImageElement).src) {
              e.preventDefault();
              e.stopPropagation();
              openImage((target as HTMLImageElement).src);
            }
          }}
        >
          <PostImages urls={allImageUrls} onImageError={onImageError} />
        </div>
      ) : null}
    </>
  );
});

const ProfileThreadAuthorLine = memo(function ProfileThreadAuthorLine({
  author,
  createdAt,
  onAuthorClick,
}: {
  author: any;
  createdAt: string;
  onAuthorClick?: (event: ReactMouseEvent) => void;
}) {
  const displayName = author?.displayName ?? author?.display_name ?? author?.username ?? 'ユーザー';
  const username = author?.username ?? 'unknown';
  const isOfficial = !!(author?.isOfficial ?? author?.is_official);

  return (
    <div className="flex items-center overflow-hidden w-full min-w-0">
      <Link
        to={`/u/${username}`}
        className="flex items-center min-w-0 shrink font-display font-bold text-foreground hover:underline"
        onClick={(event) => {
          event.stopPropagation();
          onAuthorClick?.(event);
        }}
      >
        <div className="flex items-center gap-0.5 min-w-0">
          <span className="truncate text-[16px] sm:text-base">
            {displayName}
          </span>
          {isOfficial && (
            <img
              src={`${import.meta.env.BASE_URL}verified.png`}
              alt="Official"
              className="h-4 w-4 shrink-0 transform translate-y-[0.5px]"
              loading="eager"
            />
          )}
        </div>
      </Link>

      <span className="truncate text-[16px] text-muted-foreground ml-1 opacity-80 shrink sm:text-base">
        @{username}
      </span>
      <span className="text-muted-foreground mx-1 shrink-0">·</span>
      <span className="text-[16px] text-muted-foreground whitespace-nowrap shrink-0 sm:text-sm">
        {formatRelative(createdAt)}
      </span>
    </div>
  );
});

const PROFILE_DEFAULT_EMOJIS = ['👍', '❤️', '😆', '🤔', '😮', '🎉', '💢', '😢', '😇', '🍮'];

const getProfilePostShareUrl = (postId: string) => {
  if (typeof window === 'undefined') {
    return `/post/${postId}`;
  }

  const baseUrl = import.meta.env.BASE_URL || '/';
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(`post/${postId}`, new URL(normalizedBaseUrl, window.location.origin)).toString();
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

const getProfileReactionTableConfig = (targetType: 'post' | 'comment') => (
  targetType === 'post'
    ? { table: 'post_reactions', idColumn: 'post_id' }
    : { table: 'comment_reactions', idColumn: 'comment_id' }
);

const dispatchProfileThreadReactionChanged = (targetType: 'post' | 'comment', targetId: string) => {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent('profile-thread-reaction-changed', {
    detail: { targetType, targetId },
  }));
};

const toggleProfileThreadReaction = async ({
  targetType,
  targetId,
  userId,
  emoji,
}: {
  targetType: 'post' | 'comment';
  targetId: string;
  userId: string;
  emoji: string;
}) => {
  const { table, idColumn } = getProfileReactionTableConfig(targetType);

  const { data: existing, error: checkError } = await supabase
    .from(table)
    .select('id')
    .eq(idColumn, targetId)
    .eq('user_id', userId)
    .eq('emoji', emoji)
    .maybeSingle();

  if (checkError) throw checkError;

  if (existing?.id) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('id', existing.id);

    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from(table)
    .insert({
      [idColumn]: targetId,
      user_id: userId,
      emoji,
    });

  if (error) throw error;
};

const groupProfileReactionRows = (
  rows: any[],
  targetColumn: 'post_id' | 'comment_id',
  currentUserId?: string | null
) => {
  const grouped = new Map<string, Map<string, { count: number; reactedByMe: boolean }>>();

  rows.forEach((row: any) => {
    const targetId = row?.[targetColumn];
    const emoji = row?.emoji;
    const userId = row?.user_id;

    if (!targetId || !emoji || !userId) return;

    if (!grouped.has(targetId)) {
      grouped.set(targetId, new Map());
    }

    const emojiMap = grouped.get(targetId)!;
    const current = emojiMap.get(emoji) ?? { count: 0, reactedByMe: false };

    current.count += 1;
    if (currentUserId && userId === currentUserId) {
      current.reactedByMe = true;
    }

    emojiMap.set(emoji, current);
  });

  const result = new Map<string, ProfileThreadReactionGroup[]>();

  grouped.forEach((emojiMap, targetId) => {
    result.set(
      targetId,
      Array.from(emojiMap.entries())
        .map(([emoji, value]) => ({
          emoji,
          count: value.count,
          userIds: value.reactedByMe && currentUserId ? [currentUserId] : [],
        }))
        .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji, 'ja'))
    );
  });

  return result;
};

const normalizeEmojiName = (value: string) => {
  return String(value || '')
    .trim()
    .replace(/^:+/, '')
    .replace(/:+$/, '');
};

// リアクションボタン／リアクションバッジの両方で全く同じリング＋ドットの
// バーストアニメーション実装が重複していたため共通フックに集約。
// DOM出力・アニメーション内容は元の実装と完全に同一。
const useProfileReactionBurstEffect = () => {
  const [activeRings, setActiveRings] = useState<ReplicatedRing[]>([]);
  const [activeDots, setActiveDots] = useState<ReplicatedDot[]>([]);

  const triggerBurst = useCallback((targetElement: HTMLElement) => {
    const { batchId, ring, dots } = createProfileReactionBurst(targetElement);

    setActiveRings((prev) => [...prev, ring]);
    setActiveDots((prev) => [...prev, ...dots]);

    window.setTimeout(() => {
      setActiveRings((prev) => prev.filter((item) => item.id !== `ring-${batchId}`));
      setActiveDots((prev) => prev.filter((item) => !item.id.startsWith(`dot-${batchId}-`)));
    }, 550);
  }, []);

  const burstPortal = (activeRings.length > 0 || activeDots.length > 0) && typeof document !== 'undefined'
    ? createPortal(
        <div className="fixed inset-0 pointer-events-none z-[9999] overflow-hidden">
          {activeRings.map((ring) => (
            <div
              key={ring.id}
              style={{
                position: 'fixed',
                left: ring.x,
                top: ring.y,
                width: `${ring.width}px`,
                height: `${ring.height}px`,
                borderRadius: '9999px',
                border: '4px solid #d4f022',
                backgroundColor: 'transparent',
                transformOrigin: 'center center',
                animation: 'misskeyRingExpand 460ms cubic-bezier(0.1, 0.8, 0.3, 1) forwards',
              }}
            />
          ))}
          {activeDots.map((dot) => (
            <div
              key={dot.id}
              style={{
                position: 'fixed',
                left: dot.x,
                top: dot.y,
                width: `${dot.size}px`,
                height: `${dot.size}px`,
                backgroundColor: dot.color,
                borderRadius: '50%',
                transformOrigin: 'center center',
                ['--mk-angle' as any]: `${dot.angle}deg`,
                ['--mk-dist' as any]: `${dot.distance}px`,
                animation: 'misskeyDotBurst 480ms cubic-bezier(0.12, 0.85, 0.3, 1) forwards',
                animationDelay: `${dot.delay}ms`,
              }}
            />
          ))}
        </div>,
        document.body
      )
    : null;

  return { triggerBurst, burstPortal };
};

const ProfileReactionButton = memo(function ProfileReactionButton({
  targetType,
  targetId,
  buttonClassName = '',
}: {
  targetType: 'post' | 'comment';
  targetId: string;
  buttonClassName?: string;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([]);
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isEmojisOpen, setIsEmojisOpen] = useState(true);
  const [isPending, setIsPending] = useState(false);
  const isMobile = useProfileViewportIsMobile();
  const { triggerBurst, burstPortal } = useProfileReactionBurstEffect();

  const buttonRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getCachedCurrentUserId().then((id) => {
      setCurrentUserId(id);
      if (!id) return;

      const saved = localStorage.getItem(`recent_emojis_${id}`);
      if (!saved) return;

      try {
        setRecentEmojis(JSON.parse(saved));
      } catch (error) {
        console.error('Parse profile thread recent emojis failed:', error);
      }
    });
  }, []);

  useEffect(() => {
    if (!showPicker || customEmojis.length > 0) return;

    let cancelled = false;

    loadCachedProfileCustomEmojis()
      .then((emojis) => {
        if (!cancelled) setCustomEmojis(emojis);
      })
      .catch((error) => {
        console.error('Fetch profile thread custom emojis failed:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [showPicker, customEmojis.length]);

  useEffect(() => {
    if (!showPicker) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (buttonRef.current?.contains(target)) return;
      if (pickerRef.current?.contains(target)) return;

      setShowPicker(false);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [showPicker]);

  const getCustomEmojiObj = (emojiStr: string) => {
    const cleanName = normalizeEmojiName(emojiStr);
    if (!cleanName) return null;

    return customEmojis.find((emoji) => normalizeEmojiName(emoji.name) === cleanName) ?? null;
  };

  const renderEmojiElement = (emojiStr: string, className = 'h-5 w-5 object-contain inline-block') => {
    const customEmoji = getCustomEmojiObj(emojiStr);

    if (customEmoji) {
      const cleanPublicId = customEmoji.public_id.startsWith('custom_emojis/')
        ? customEmoji.public_id
        : `custom_emojis/${customEmoji.public_id}`;

      const imageUrl = `https://res.cloudinary.com/dveiikhhw/image/upload/${cleanPublicId}.${customEmoji.format}`;
      return <img src={imageUrl} alt={customEmoji.name} className={className} loading="lazy" decoding="async" />;
    }

    return <span className="select-none text-lg leading-none">{emojiStr}</span>;
  };

  const handleAddReaction = async (emoji: string, event?: ReactMouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    event?.stopPropagation();

    if (isPending) return;

    const userId = currentUserId ?? await getCachedCurrentUserId();
    if (!userId) {
      alert('ログインが必要です');
      return;
    }

    setCurrentUserId(userId);
    setIsPending(true);

    if (event?.currentTarget) {
      triggerBurst(event.currentTarget as HTMLElement);
    }

    const updatedRecents = [emoji, ...recentEmojis.filter((item) => item !== emoji)].slice(0, 10);

    setRecentEmojis(updatedRecents);
    localStorage.setItem(`recent_emojis_${userId}`, JSON.stringify(updatedRecents));

    try {
      await toggleProfileThreadReaction({ targetType, targetId, userId, emoji });
      dispatchProfileThreadReactionChanged(targetType, targetId);
      setShowPicker(false);
    } catch (error) {
      console.error('Toggle profile thread reaction failed:', error);
    } finally {
      setIsPending(false);
    }
  };

  const filteredCustomEmojis = customEmojis.filter((emoji) => (
    emoji.name.toLowerCase().includes(searchQuery.toLowerCase())
  ));

  const picker = (
    <div
      ref={pickerRef}
      className={isMobile
        ? 'fixed left-1/2 w-[92vw] max-w-[340px] h-[430px] rounded-[24px] border border-border/80 bg-white dark:bg-[#1e222b] shadow-2xl p-4 animate-slide-up-mobile overflow-y-auto overflow-x-hidden touch-pan-y'
        : 'absolute bottom-full left-0 mb-2 w-[260px] h-[280px] rounded-[20px] border border-border/80 bg-white dark:bg-[#1e222b] shadow-2xl z-[9999] p-2.5 animate-zoom-in-pc overflow-y-auto overflow-x-hidden'
      }
      style={isMobile
        ? {
            bottom: 'calc(76px + env(safe-area-inset-bottom))',
            zIndex: 2147483647,
            transform: 'translateX(-50%)',
          }
        : undefined
      }
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className={isMobile ? 'grid grid-cols-5 gap-2.5 mb-3.5 shrink-0' : 'grid grid-cols-7 gap-1 mb-2 shrink-0'}>
        {PROFILE_DEFAULT_EMOJIS.map((emoji) => (
          <button
            key={`profile-default-${targetType}-${targetId}-${emoji}`}
            type="button"
            onClick={(event) => handleAddReaction(emoji, event)}
            className={isMobile
              ? 'flex h-11 w-11 items-center justify-center rounded-2xl text-2xl transition-all hover:bg-black/[0.05] dark:hover:bg-white/10 origin-center'
              : 'flex h-8 w-8 items-center justify-center rounded-lg text-xl transition-all hover:bg-black/[0.05] dark:hover:bg-white/10 origin-center'
            }
          >
            {emoji}
          </button>
        ))}
      </div>

      {recentEmojis.length > 0 && (
        <div className={isMobile ? 'mb-3.5 shrink-0' : 'mb-2 shrink-0'}>
          <div className="mb-1.5 px-0.5 text-[11px] font-bold text-muted-foreground/60">最近使用</div>
          <div className={isMobile ? 'flex flex-wrap gap-2.5' : 'flex flex-wrap gap-1'}>
            {recentEmojis.map((emoji) => (
              <button
                key={`profile-recent-${targetType}-${targetId}-${emoji}`}
                type="button"
                onClick={(event) => handleAddReaction(emoji, event)}
                className={isMobile
                  ? 'flex h-9 w-9 items-center justify-center rounded-xl transition-all hover:bg-black/[0.05] dark:hover:bg-white/10 origin-center'
                  : 'flex h-7 w-7 items-center justify-center rounded-md transition-all hover:bg-black/[0.05] dark:hover:bg-white/10 origin-center'
                }
              >
                {renderEmojiElement(emoji, isMobile ? 'h-6 w-6 object-contain' : 'h-[18px] w-[18px] object-contain')}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col border-t border-black/[0.08] pt-2 dark:border-white/5">
        <button
          type="button"
          onClick={() => setIsEmojisOpen((value) => !value)}
          className="flex w-full items-center justify-between px-0.5 py-1 text-[11px] font-black text-muted-foreground/80 transition-colors hover:text-foreground"
        >
          <span className="truncate">カスタム絵文字</span>
          <span className="text-[10px] opacity-60">{isEmojisOpen ? '▲' : '▼'}</span>
        </button>

        {isEmojisOpen && (
          <div className="mt-1 p-0.5">
            {filteredCustomEmojis.length > 0 ? (
              <div className={isMobile ? 'grid grid-cols-4 gap-2.5' : 'grid grid-cols-6 gap-1'}>
                {filteredCustomEmojis.map((emoji) => (
                  <button
                    key={emoji.id}
                    type="button"
                    title={`:${emoji.name}:`}
                    onClick={(event) => handleAddReaction(`:${emoji.name}:`, event)}
                    className={isMobile
                      ? 'flex h-12 w-12 items-center justify-center rounded-2xl p-1.5 transition-all hover:bg-black/[0.05] dark:hover:bg-white/10 origin-center'
                      : 'flex h-8 w-8 items-center justify-center rounded-lg p-0.5 transition-all hover:bg-black/[0.05] dark:hover:bg-white/10 origin-center'
                    }
                  >
                    {renderEmojiElement(`:${emoji.name}:`, isMobile ? 'h-9 w-9 object-contain' : 'h-6 w-6 object-contain')}
                  </button>
                ))}
              </div>
            ) : (
              <div className="py-4 text-center text-[11px] text-muted-foreground/50">絵文字が見つかりません</div>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 shrink-0 border-t border-black/[0.08] pt-1.5 dark:border-white/5">
        <input
          type="text"
          placeholder="検索"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="h-8 w-full rounded-lg border border-black/[0.08] bg-black/[0.03] px-2.5 text-xs font-medium text-foreground placeholder:text-muted-foreground/40 transition-colors focus:border-pink-500/50 focus:outline-none dark:border-white/10 dark:bg-black/30"
        />
      </div>
    </div>
  );

  return (
    <div className="relative inline-flex h-full items-center" onClick={(event) => event.stopPropagation()}>
      {burstPortal}

      <button
        ref={buttonRef}
        type="button"
        disabled={isPending}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setShowPicker((value) => !value);
        }}
        className={`${buttonClassName} ${showPicker ? 'bg-accent/10 text-accent' : 'text-muted-foreground'} ${isPending ? 'pointer-events-none opacity-60' : ''}`}
        aria-label="リアクションを追加"
      >
        <Plus className="h-5 w-5" />
      </button>

      {showPicker && (
        isMobile && typeof document !== 'undefined' ? createPortal(
          <>
            <div
              className="fixed inset-0 bg-transparent"
              style={{ zIndex: 2147483646 }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setShowPicker(false);
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            />
            {picker}
          </>,
          document.body
        ) : (
          <>
            <div
              className="fixed inset-0 bg-transparent z-[9998]"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setShowPicker(false);
              }}
            />
            {picker}
          </>
        )
      )}
    </div>
  );
});

const ProfileThreadReactionBadges = memo(function ProfileThreadReactionBadges({
  targetType,
  targetId,
  groups,
}: {
  targetType: 'post' | 'comment';
  targetId: string;
  groups: ProfileThreadReactionGroup[];
}) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([]);
  const [pendingEmoji, setPendingEmoji] = useState<string | null>(null);
  const { triggerBurst, burstPortal } = useProfileReactionBurstEffect();

  useEffect(() => {
    getCachedCurrentUserId().then(setCurrentUserId);
  }, []);

  useEffect(() => {
    if (!groups.some((group) => group.emoji.startsWith(':') && group.emoji.endsWith(':'))) return;

    let cancelled = false;

    loadCachedProfileCustomEmojis()
      .then((emojis) => {
        if (!cancelled) setCustomEmojis(emojis);
      })
      .catch((error) => {
        console.error('Fetch profile thread reaction badge emojis failed:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [groups]);

  if (groups.length === 0) return null;

  const renderEmojiElement = (emojiStr: string) => {
    if (emojiStr.startsWith(':') && emojiStr.endsWith(':')) {
      const cleanName = normalizeEmojiName(emojiStr);
      const customEmoji = customEmojis.find((emoji) => normalizeEmojiName(emoji.name) === cleanName);

      if (customEmoji) {
        const cleanPublicId = customEmoji.public_id.startsWith('custom_emojis/')
          ? customEmoji.public_id
          : `custom_emojis/${customEmoji.public_id}`;

        return (
          <img
            src={`https://res.cloudinary.com/dveiikhhw/image/upload/${cleanPublicId}.${customEmoji.format}`}
            alt={customEmoji.name}
            className="h-5 w-5 object-contain"
            loading="lazy"
            decoding="async"
          />
        );
      }
    }

    return <span className="text-base leading-none">{emojiStr}</span>;
  };

  const handleBadgeClick = async (emoji: string, event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (pendingEmoji) return;

    if (event.currentTarget) {
      triggerBurst(event.currentTarget as HTMLElement);
    }

    const userId = currentUserId ?? await getCachedCurrentUserId();
    if (!userId) {
      alert('ログインが必要です');
      return;
    }

    setCurrentUserId(userId);
    setPendingEmoji(emoji);

    try {
      await toggleProfileThreadReaction({ targetType, targetId, userId, emoji });
      dispatchProfileThreadReactionChanged(targetType, targetId);
    } catch (error) {
      console.error('Toggle profile thread reaction badge failed:', error);
    } finally {
      setPendingEmoji(null);
    }
  };

  return (
    <>
      {burstPortal}

      <div className="mt-3 flex flex-wrap gap-1.5 relative" onClick={(event) => event.stopPropagation()}>
        {groups.map((group) => {
        const reactedByMe = Boolean(currentUserId && group.userIds.includes(currentUserId));

        return (
          <button
            key={`${targetType}-${targetId}-reaction-${group.emoji}`}
            type="button"
            disabled={pendingEmoji === group.emoji}
            onClick={(event) => handleBadgeClick(group.emoji, event)}
            className={`inline-flex items-center gap-1.5 h-[45px] px-2.5 rounded-xl text-[15px] font-bold transition-all select-none outline-none border-none origin-center disabled:opacity-60 ${
              reactedByMe
                ? 'bg-sky-500/15 text-sky-500 dark:text-sky-400'
                : 'bg-black/[0.05] text-muted-foreground hover:bg-black/[0.08] hover:text-foreground dark:bg-muted/50 dark:hover:bg-muted/80'
            }`}
          >
            {renderEmojiElement(group.emoji)}
            <span className="tabular-nums text-sm font-black">{formatDisplayCount(group.count)}</span>
          </button>
        );
        })}
      </div>
    </>
  );
});

const ProfileShareButton = memo(function ProfileShareButton({
  postId,
  title,
  text,
  postAuthor,
  buttonClassName = '',
  className = '',
  shareUrlOverride = null,
}: {
  postId: string;
  title: string;
  text: string;
  postAuthor: any;
  buttonClassName?: string;
  className?: string;
  shareUrlOverride?: string | null;
}) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [shareMenuPosition, setShareMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [showLimeDropPanel, setShowLimeDropPanel] = useState(false);
  const [limeDropTargets, setLimeDropTargets] = useState<LimeDropTarget[]>([]);
  const [limeDropLoading, setLimeDropLoading] = useState(false);
  const [limeDropSendingUserId, setLimeDropSendingUserId] = useState<string | null>(null);
  const [limeDropFeedback, setLimeDropFeedback] = useState<string | null>(null);

  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const shareMenuRef = useRef<HTMLDivElement>(null);
  const limeDropPanelRef = useRef<HTMLDivElement>(null);

  // Bluesky由来の投稿の場合はLimeNote内のURLではなく、実際のBluesky投稿URLを共有先として使う。
  const resolveShareUrl = () => shareUrlOverride || getProfilePostShareUrl(postId);

  useEffect(() => {
    getCachedCurrentUserId().then(setCurrentUserId);
  }, []);

  useEffect(() => {
    if (!showShareMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (shareButtonRef.current?.contains(target)) return;
      if (shareMenuRef.current?.contains(target)) return;

      setShowShareMenu(false);
      setShareMenuPosition(null);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [showShareMenu]);

  useEffect(() => {
    if (!showShareMenu) return;

    const closeOnViewportChange = () => {
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
        setShowLimeDropPanel(false);
        setLimeDropSendingUserId(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showLimeDropPanel]);

  const closeShareMenu = () => {
    setShowShareMenu(false);
    setShareMenuPosition(null);
  };

  const handleShareButtonClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (showShareMenu) {
      closeShareMenu();
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    setShareMenuPosition({
      top: rect.bottom + 4,
      right: Math.max(8, window.innerWidth - rect.right),
    });
    setShowShareMenu(true);
  };

  const handleCopyPostLink = async (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    try {
      await copyTextToClipboard(resolveShareUrl());
      setShareFeedback('リンクをコピーしました');
      window.setTimeout(() => setShareFeedback(null), 1400);
      closeShareMenu();
    } catch (error) {
      console.error('Copy profile thread post link failed:', error);
      setShareFeedback('コピーに失敗しました');
      window.setTimeout(() => setShareFeedback(null), 1400);
    }
  };

  const handleNativePostShare = async (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const url = resolveShareUrl();

    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title, text, url });
        closeShareMenu();
        return;
      }

      await copyTextToClipboard(url);
      setShareFeedback('共有非対応のためリンクをコピーしました');
      window.setTimeout(() => setShareFeedback(null), 1800);
      closeShareMenu();
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') {
        closeShareMenu();
        return;
      }

      console.error('Native profile thread share failed:', error);
      setShareFeedback('共有に失敗しました');
      window.setTimeout(() => setShareFeedback(null), 1400);
    }
  };

  const fetchLimeDropTargets = async () => {
    const userId = currentUserId ?? await getCachedCurrentUserId();
    if (!userId) {
      setCurrentUserId(null);
      setLimeDropTargets([]);
      setLimeDropFeedback('ログイン状態を確認できません');
      return;
    }

    setCurrentUserId(userId);
    setLimeDropLoading(true);
    setLimeDropFeedback(null);

    try {
      const { data: currentProfile, error: currentProfileError } = await supabase
        .from('profiles')
        .select('is_official')
        .eq('id', userId)
        .maybeSingle();

      if (currentProfileError) throw currentProfileError;

      if (currentProfile?.is_official === true) {
        const { data: allProfileRows, error: allProfileError } = await supabase
          .from('profiles')
          .select('id, username, display_name, avatar_url')
          .neq('id', userId)
          .order('display_name', { ascending: true });

        if (allProfileError) throw allProfileError;

        setLimeDropTargets((allProfileRows || []).map((profile: any) => ({
          id: profile.id,
          username: profile.username || 'unknown',
          displayName: profile.display_name || profile.username || 'ユーザー',
          avatarUrl: profile.avatar_url || '',
        })));
        return;
      }

      const { data: followingRows, error: followingError } = await supabase
        .from('follows')
        .select('followee_id')
        .eq('follower_id', userId);

      if (followingError) throw followingError;

      const followingIds = uniqueStrings((followingRows || []).map((row: any) => row.followee_id));

      const { data: followerRows, error: followerError } = followingIds.length > 0
        ? await supabase
            .from('follows')
            .select('follower_id')
            .eq('followee_id', userId)
            .in('follower_id', followingIds)
        : { data: [], error: null };

      if (followerError) throw followerError;

      const mutualIds = uniqueStrings((followerRows || []).map((row: any) => row.follower_id));

      const { data: mutualProfileRows, error: mutualProfileError } = mutualIds.length > 0
        ? await supabase
            .from('profiles')
            .select('id, username, display_name, avatar_url')
            .in('id', mutualIds)
        : { data: [], error: null };

      if (mutualProfileError) throw mutualProfileError;

      setLimeDropTargets((mutualProfileRows || [])
        .map((profile: any) => ({
          id: profile.id,
          username: profile.username || 'unknown',
          displayName: profile.display_name || profile.username || 'ユーザー',
          avatarUrl: profile.avatar_url || '',
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'))
      );
    } catch (error) {
      console.error('Fetch profile thread LimeDrop targets failed:', error);
      setLimeDropTargets([]);
      setLimeDropFeedback('送信先の取得に失敗しました');
    } finally {
      setLimeDropLoading(false);
    }
  };

  const handleOpenLimeDropPanel = async (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    closeShareMenu();
    setLimeDropFeedback(null);
    setShowLimeDropPanel(true);
    await fetchLimeDropTargets();
  };

  const handleCloseLimeDropPanel = () => {
    setShowLimeDropPanel(false);
    setLimeDropSendingUserId(null);
  };

  const handleSendLimeDrop = async (target: LimeDropTarget) => {
    const userId = currentUserId ?? await getCachedCurrentUserId();
    if (!userId) {
      setLimeDropFeedback('ログイン状態を確認できません');
      return;
    }

    setCurrentUserId(userId);
    setLimeDropSendingUserId(target.id);
    setLimeDropFeedback(null);

    const postAuthorId = postAuthor?.id ?? postAuthor?.user_id ?? postAuthor?.userId ?? null;
    const postAuthorUsername = postAuthor?.username ?? 'unknown';
    const postAuthorDisplayName = postAuthor?.displayName ?? postAuthor?.display_name ?? postAuthorUsername ?? 'ユーザー';

    try {
      const { error } = await supabase
        .from('lime_drops')
        .insert({
          sender_id: userId,
          recipient_id: target.id,
          post_id: postId,
          post_url: resolveShareUrl(),
          post_author_id: postAuthorId,
          post_author_username: postAuthorUsername,
          post_author_display_name: postAuthorDisplayName,
          post_text: text,
          status: 'pending',
        });

      if (error) throw error;

      setLimeDropFeedback(`${target.displayName}さんに送信しました`);
      window.setTimeout(() => {
        handleCloseLimeDropPanel();
        setLimeDropFeedback(null);
      }, 900);
    } catch (error) {
      console.error('Send profile thread LimeDrop failed:', error);
      setLimeDropFeedback('LimeDropの送信に失敗しました');
    } finally {
      setLimeDropSendingUserId(null);
    }
  };

  return (
    <div className={`relative inline-flex h-full items-center ${className}`} onClick={(event) => event.stopPropagation()}>
      <button
        ref={shareButtonRef}
        type="button"
        onClick={handleShareButtonClick}
        className={`${buttonClassName} ${showShareMenu ? 'bg-accent/10 text-accent' : 'text-muted-foreground'}`}
        aria-label="共有"
      >
        <Upload className="h-5 w-5" />
      </button>

      {showShareMenu && typeof document !== 'undefined' && createPortal(
        <>
          <div
            className="fixed inset-0 bg-transparent"
            style={{ zIndex: 2147483646 }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              closeShareMenu();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          />
          <div
            ref={shareMenuRef}
            className="fixed w-[min(calc(100vw-16px),16rem)] overflow-hidden rounded-xl border border-border bg-card p-1 shadow-lg animate-in fade-in zoom-in duration-100"
            style={{
              top: shareMenuPosition?.top ?? 0,
              right: shareMenuPosition?.right ?? 8,
              zIndex: 2147483647,
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={handleOpenLimeDropPanel}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground transition-colors hover:bg-muted"
            >
              <Send className="h-4 w-4 shrink-0" />
              <span>LimeDropで送信</span>
            </button>

            <button
              type="button"
              onClick={handleCopyPostLink}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground transition-colors hover:bg-muted"
            >
              <LinkIcon className="h-4 w-4 shrink-0" />
              <span>{shareFeedback ?? 'リンクをコピー'}</span>
            </button>

            <button
              type="button"
              onClick={handleNativePostShare}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground transition-colors hover:bg-muted"
            >
              <Upload className="h-4 w-4 shrink-0" />
              <span>その他の方法でポストを送信</span>
            </button>
          </div>
        </>,
        document.body
      )}

      {showLimeDropPanel && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          style={{ zIndex: 2147483647 }}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              handleCloseLimeDropPanel();
            }
          }}
        >
          <div
            ref={limeDropPanelRef}
            className="w-full max-w-[520px] overflow-hidden rounded-t-[28px] border border-border bg-card shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 sm:rounded-[28px]"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
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
                  {text}
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {resolveShareUrl()}
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
                  <p className="text-sm font-bold text-foreground">送信できるユーザーがいません</p>
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
    </div>
  );
});


const ProfileThreadActionRow = memo(function ProfileThreadActionRow({
  targetType,
  targetId,
  liked,
  likesCount,
  replyCount,
  sharePostId,
  shareTitle,
  shareText,
  sharePostAuthor,
  onReplyClick,
  isBluesky = false,
  blueskyUrl = null,
  repostTarget,
}: {
  targetType: 'post' | 'comment';
  targetId: string;
  liked: boolean;
  likesCount: number;
  replyCount?: number;
  sharePostId: string;
  shareTitle: string;
  shareText: string;
  sharePostAuthor: any;
  onReplyClick: () => void;
  isBluesky?: boolean;
  blueskyUrl?: string | null;
  repostTarget?: any;
}) {
  const { user } = useAuth();
  const inlineActionClass = 'inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] transition-colors hover:text-accent h-full sm:px-2.5 sm:text-sm';
  const iconActionClass = 'inline-flex items-center justify-center gap-1.5 rounded-full px-2 py-1 text-[13px] transition-colors hover:text-accent h-full origin-center sm:h-8 sm:w-8 sm:p-1.5 sm:px-0';

  return (
    <div data-lime-post-actions className="profile-thread-actions mt-2 flex items-center gap-1 text-muted-foreground relative h-8 sm:mt-3 sm:h-9" onClick={(event) => event.stopPropagation()}>
      {targetType === 'post' ? (
        <div className="flex items-center h-full">
          {isBluesky ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onReplyClick();
              }}
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] transition-colors hover:text-accent h-full sm:px-2.5 sm:text-sm"
            >
              <Heart className="h-5 w-5" />
              <span className="font-bold tabular-nums text-[15px] sm:text-sm">{(likesCount) > 0 ? formatDisplayCount(likesCount) : ''}</span>
            </button>
          ) : (
            <LikeButton postId={targetId} liked={liked} count={likesCount} />
          )}
        </div>
      ) : (
        <div className="flex items-center h-full profile-thread-comment-like-slot">
          <Commentlikebutton commentId={targetId} liked={liked} count={likesCount} />
        </div>
      )}

      {repostTarget && <RepostButton post={targetType === 'post' ? normalizePost(repostTarget) : replyToPost(repostTarget)} mobilePresentation refreshState />}
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onReplyClick();
        }}
        className={inlineActionClass}
        aria-label="返信を表示"
      >
        <MessageCircle className="h-5 w-5" />
        {typeof replyCount === 'number' && (
          <span className="font-bold tabular-nums text-[15px] sm:text-sm">{(replyCount) > 0 ? formatDisplayCount(replyCount) : ''}</span>
        )}
      </button>

      {isBluesky ? (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onReplyClick();
          }}
          className={iconActionClass}
          aria-label="リアクションを追加"
        >
          <Plus className="h-5 w-5" />
        </button>
      ) : (
        <ProfileReactionButton
          targetType={targetType}
          targetId={targetId}
          buttonClassName={iconActionClass}
        />
      )}

      {targetType === 'post' && <div className="ml-auto flex shrink-0 items-center"><BookmarkButton post={repostTarget ? normalizePost(repostTarget) : {id: targetId}} className={iconActionClass} /><ProfileShareButton
        postId={sharePostId}
        title={shareTitle}
        text={shareText}
        postAuthor={sharePostAuthor}
        buttonClassName={iconActionClass}
        className="shrink-0"
        shareUrlOverride={isBluesky ? blueskyUrl : null}
      /></div>}
      {targetType === 'comment' && <ReplyShare currentUserId={user?.id ?? null} comment={{ id: targetId, postId: sharePostId, content: shareText, author: { id: sharePostAuthor?.id ?? '', username: sharePostAuthor?.username ?? '', displayName: sharePostAuthor?.displayName ?? sharePostAuthor?.display_name ?? sharePostAuthor?.username ?? 'ユーザー' } }} className={iconActionClass} />}
    </div>
  );
});

const ProfileReplyThreadCard = memo(function ProfileReplyThreadCard({
  thread,
  onImageClick,
  onImageError,
}: {
  thread: ProfileReplyThread;
  onImageClick: (selection: ProfileThreadImageSelection) => void;
  onImageError: (url: string) => void;
}) {
  const navigate = useNavigate();
  const parent = thread.parentPost;
  const parentAuthor = parent?.author ?? parent?.profiles ?? parent?.user ?? null;
  const comments = thread.comments?.length ? thread.comments : [thread.comment];
  const primaryComment = comments[0] ?? thread.comment;
  const parentRawContent = parent?.content ?? '';
  const parentContent = stripPreviewUrls(spaceLinkIn(parentRawContent)?.text ?? parentRawContent);
  const parentDisplayName = parentAuthor?.displayName ?? parentAuthor?.display_name ?? parentAuthor?.username ?? 'ユーザー';
  const clippedParentContent = parentContent.length > 120 ? `${parentContent.slice(0, 120)}...` : parentContent;
  const threadAvatarClassName = "h-11 w-11 translate-y-1";
  const replyAvatarClassName = threadAvatarClassName;

  // 親ポストがBluesky由来の場合、PostCard/Feedと同じ判定ロジックを使い、
  // 本文・画像・埋め込みはこのままインラインで表示しつつ（＝外部リンクへ飛ばさず閲覧できる）、
  // プロフィール遷移・返信・リアクションといった実際の操作だけBluesky側で行ってもらう。
  const isParentBluesky = parent ? isBlueskyPostLike(parent) : false;
  const parentBlueskyUrl = parent && isParentBluesky ? getBlueskyPostUrl(parent) : null;
  const parentBlueskyProfileUrl = isParentBluesky && parentAuthor?.username
    ? parent?.id.startsWith('misskey:') ? `https://misskey.io/@${parentAuthor.username.replace(/@misskey\.io$/, '')}` : `https://bsky.app/profile/${parentAuthor.username}`
    : null;

  const handleParentAuthorClick = (event: ReactMouseEvent) => {
    // Bluesky由来の投稿でもアプリ内のプロフィール画面（/u/:username）へ遷移する。
    // Link のデフォルト動作を阻害しない（PostCardと同様）。
  };

  const openThread = () => {
    if (isParentBluesky) {
      if (parent?.id) navigate(getAppPostPath(parent.id));
      return;
    }
    navigate(`/post/${primaryComment.postId}`);
  };

  return (
    <article
      className="profile-reply-thread relative mx-auto w-full max-w-[600px] px-0 py-3 cursor-pointer sm:mx-0 sm:max-w-none sm:rounded-3xl sm:border sm:border-border/60 sm:bg-card sm:p-5 sm:shadow-soft sm:transition sm:hover:shadow-card-soft"
      onClick={openThread}
    >
      <div className="pointer-events-none absolute bottom-0 left-1/2 w-screen -translate-x-1/2 border-b border-border/60 sm:hidden" />

      {parent ? (
        <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-3 sm:grid-cols-[44px_minmax(0,1fr)]">
          <div className="relative flex justify-center">
            <Link
              to={`/u/${parentAuthor?.username ?? 'unknown'}`}
              className="shrink-0"
              onClick={(event) => {
                event.stopPropagation();
                handleParentAuthorClick(event);
              }}
            >
              <Avatar className={threadAvatarClassName}>
                <AvatarImage src={parentAuthor?.avatarUrl ?? parentAuthor?.avatar_url ?? ''} alt={parentAuthor?.displayName ?? parentAuthor?.display_name ?? parentAuthor?.username ?? ''} />
                <AvatarFallback>{(parentAuthor?.displayName ?? parentAuthor?.display_name ?? parentAuthor?.username ?? 'U').slice(0, 1)}</AvatarFallback>
              </Avatar>
            </Link>
            <span className="absolute bottom-1 left-1/2 top-[52px] w-0.5 -translate-x-1/2 rounded-full bg-border" />
          </div>

          <div className="min-w-0 pb-3">
            <ProfileThreadAuthorLine
              author={parentAuthor}
              createdAt={parent.createdAt ?? parent.created_at ?? ''}
              onAuthorClick={isParentBluesky ? handleParentAuthorClick : undefined}
            />

            {parentContent ? (
              <p className="whitespace-pre-wrap break-words text-[16px] leading-normal text-foreground mt-1 sm:text-base sm:leading-relaxed">
                {renderProfileThreadTextWithMentions(parentContent, navigate,parentAuthor)}
              </p>
            ) : null}

            {isParentBluesky && (
              <div className="flex items-center gap-1 mt-1.5 text-muted-foreground/70">
                <Globe className="h-3.5 w-3.5" />
                <span className="text-[15px] font-medium">{parent?.id.startsWith('misskey:') ? 'Misskey' : 'Bluesky'}</span>
              </div>
            )}

            <ProfileThreadEmbeds
              item={parent}
              imageTarget={{
                targetType: 'post',
                targetId: parent.id,
                postId: primaryComment.postId,
                liked: !!(parent.likedByMe ?? parent.liked_by_me),
                likesCount: Number(parent.likesCount ?? parent.likes_count ?? 0),
                replyCount: Number(parent.commentsCount ?? parent.comments_count ?? 0),
              }}
              onImageClick={onImageClick}
              onImageError={onImageError}
            />

            <ProfileThreadReactionBadges
              targetType="post"
              targetId={parent.id}
              groups={thread.parentReactions ?? []}
            />

            <ProfileThreadActionRow
              targetType="post"
              repostTarget={parent}
              targetId={parent.id}
              liked={!!(parent.likedByMe ?? parent.liked_by_me)}
              likesCount={Number(parent.likesCount ?? parent.likes_count ?? 0)}
              replyCount={Number(parent.commentsCount ?? parent.comments_count ?? 0)}
              sharePostId={primaryComment.postId}
              shareTitle={`${parentDisplayName}さんのポスト`}
              shareText={clippedParentContent ? `${parentDisplayName}さんのポスト: ${clippedParentContent}` : `${parentDisplayName}さんのポスト`}
              sharePostAuthor={parentAuthor}
              onReplyClick={openThread}
              isBluesky={isParentBluesky}
              blueskyUrl={parentBlueskyUrl}
            />
          </div>
        </div>
      ) : (
        <div className="mb-3 rounded-2xl border border-dashed border-border/70 px-4 py-3 text-sm text-muted-foreground sm:bg-muted/20">
          返信のつながりを表示できませんでした。
        </div>
      )}

      {comments.map((comment, commentIndex) => {
        const commentAuthor = comment.author;
        const replyRawContent = comment.content ?? '';
        const replyContent = stripPreviewUrls(spaceLinkIn(replyRawContent)?.text ?? replyRawContent);
        const commentDisplayName = commentAuthor?.displayName ?? commentAuthor?.display_name ?? commentAuthor?.username ?? 'ユーザー';

        return (
          <div
            key={comment.id}
            onClick={(event) => { event.stopPropagation(); navigate(`/post/${comment.postId}?reply=${encodeURIComponent(comment.id)}`); }}
            className={`${commentIndex > 0 ? 'mt-3' : ''} grid grid-cols-[44px_minmax(0,1fr)] gap-3 sm:grid-cols-[44px_minmax(0,1fr)]`}
          >
            <div className="relative flex justify-center">
              <Link
                to={`/u/${commentAuthor?.username ?? 'unknown'}`}
                className="shrink-0"
                onClick={(event) => event.stopPropagation()}
              >
                <Avatar className={replyAvatarClassName}>
                  <AvatarImage src={commentAuthor?.avatarUrl ?? commentAuthor?.avatar_url ?? ''} alt={commentAuthor?.displayName ?? commentAuthor?.display_name ?? commentAuthor?.username ?? ''} />
                  <AvatarFallback>{(commentAuthor?.displayName ?? commentAuthor?.display_name ?? commentAuthor?.username ?? 'U').slice(0, 1)}</AvatarFallback>
                </Avatar>
              </Link>
              {commentIndex < comments.length - 1 && (
                <span className="absolute -bottom-2 left-1/2 top-[52px] w-0.5 -translate-x-1/2 rounded-full bg-border" />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center justify-between">
                <ProfileThreadAuthorLine author={commentAuthor} createdAt={comment.createdAt} />
                <DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="コメントのメニュー" onClick={event => event.stopPropagation()} className="p-1 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"><MoreHorizontal className="h-5 w-5" /></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-44 rounded-xl border border-border bg-card p-1 shadow-lg"><DropdownMenuItem asChild className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted focus:bg-muted focus:text-foreground transition-colors"><button type="button" onClick={() => navigate(`/post/${comment.postId}/activity?reply=${encodeURIComponent(comment.id)}`)}><ChartBarBig className="h-4 w-4" />ポストアクティビティ</button></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
              </div>

              {replyContent ? (
                <p className="whitespace-pre-wrap break-words text-[16px] leading-normal text-foreground mt-1 sm:text-base sm:leading-relaxed">
                  {renderProfileThreadTextWithMentions(replyContent, navigate,commentAuthor)}
                </p>
              ) : null}

              <ProfileThreadEmbeds
                item={comment}
                imageTarget={{
                  targetType: 'comment',
                  targetId: comment.id,
                  postId: comment.postId,
                  liked: comment.likedByMe,
                  likesCount: comment.likesCount,
                }}
                onImageClick={onImageClick}
                onImageError={onImageError}
              />

              <ProfileThreadReactionBadges
                targetType="comment"
                targetId={comment.id}
                groups={comment.reactions ?? []}
              />

              <ProfileThreadActionRow
                targetType="comment"
                repostTarget={{...comment,replyToUsername:comment.replyToUsername ?? parentAuthor?.username}}
                targetId={comment.id}
                liked={comment.likedByMe}
                likesCount={comment.likesCount}
                sharePostId={comment.postId}
                shareTitle={`${commentDisplayName}さんの返信`}
                shareText={replyContent}
                sharePostAuthor={commentAuthor}
                onReplyClick={() => navigate(`/post/${comment.postId}?reply=${encodeURIComponent(comment.id)}`)}
              />
            </div>
          </div>
        );
      })}
    </article>
  );
});

// このページ用のグローバルCSS。以前は Profile() のJSX内でテンプレート
// リテラルとして毎レンダー生成していたが、内容は不変なのでモジュール
// スコープの定数に固定し、スクロールやタブ切替のたびに文字列を
// 再生成するコストをなくす（見た目・内容は完全に同一）。
// ==== 無限スクロールのメモリ対策（仮想化） ====
// 今までは items.map() で描画したカードが一度マウントされると
// スクロールでどれだけ離れても DOM・画像・埋め込みが残り続け、
// 下にスクロールするほどメモリを消費し続ける原因になっていた。
// ここでは既存依存の react-intersection-observer だけを使い、
// 画面から十分離れたカードの重い中身（画像・埋め込み・リアクション
// UIなど）だけをアンマウントし、直前に測定した高さのプレースホルダー
// に差し替える。見た目・レイアウト・スクロール位置は一切変わらず、
// 再度画面に近づけば自動的に元の内容がそのまま復元される。
const PROFILE_VIRTUALIZATION_ROOT_MARGIN = '1600px 0px 1600px 0px';

// メディアタブは3列のCSS Gridなので、アイテム側に余計なラッパーを
// 挟むとグリッドの列構成が崩れてしまう（＝見た目が変わってしまう）。
// そのためグリッドセルの div 自体は常にマウントしたまま維持し、
// 中の <img> だけを画面から遠いときに外して bg-muted の背景だけを
// 見せる（読み込み待ち時と同じ見た目のまま）ことでレイアウトに
// 一切影響を与えずに画像のデコード済みメモリだけを解放する。
const ProfileVirtualizedMediaImage = memo(function ProfileVirtualizedMediaImage({
  src,
}: {
  src: string;
}) {
  const { ref, inView } = useInView({
    initialInView: true,
    rootMargin: PROFILE_VIRTUALIZATION_ROOT_MARGIN,
  });

  return (
    <div ref={ref} className="h-full w-full">
      {inView ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : null}
    </div>
  );
});

const PROFILE_PAGE_STYLES = `
          .profile-tabs-trigger[data-state='active'] {
            color: hsl(var(--foreground));
            font-weight: 1000;
          }

          .profile-tabs-trigger[data-state='inactive'] {
            color: hsl(var(--muted-foreground));
            font-weight: 500;
          }

          /* ヘッダーのタブと同じく、アクティブ下線は1本だけ使って
             left のCSS transitionでタブ間を滑らかに移動させる。 */
          .profile-tabs-underline {
            transition: left 300ms cubic-bezier(0.22, 1, 0.36, 1);
          }

          @keyframes misskeyRingExpand {
            0% { transform: translate(-50%, -50%) scale(0.6); opacity: 1; border-width: 5px; }
            40% { opacity: 1; border-width: 4px; }
            100% { transform: translate(-50%, -50%) scale(1.15); opacity: 0; border-width: 1px; }
          }

          @keyframes misskeyDotBurst {
            0% { transform: translate(-50%, -50%) rotate(var(--mk-angle)) translateY(0px) scale(0.2); opacity: 0; }
            15% { opacity: 1; transform: translate(-50%, -50%) rotate(var(--mk-angle)) translateY(calc(var(--mk-dist) * 0.4)) scale(1.1); }
            60% { opacity: 1; }
            100% { transform: translate(-50%, -50%) rotate(var(--mk-angle)) translateY(var(--mk-dist)) scale(0); opacity: 0; }
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

          @keyframes slideUpMobile {
            0% { transform: translate(-50%, 24px); opacity: 0; }
            100% { transform: translate(-50%, 0); opacity: 1; }
          }

          .animate-slide-up-mobile {
            animation: slideUpMobile 240ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }

          @keyframes zoomInPc {
            0% { transform: scale(0.9) translateY(8px); opacity: 0; }
            100% { transform: scale(1) translateY(0); opacity: 1; }
          }

          .animate-zoom-in-pc {
            animation: zoomInPc 160ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
          }

          .profile-thread-actions > * {
            height: 100%;
          }

          .profile-thread-actions button > svg,
          .profile-thread-actions button > span > svg:not(.twitter-like-effects) {
            width: 1.25rem;
            height: 1.25rem;
          }

          .profile-thread-actions .profile-thread-comment-like-slot button {
            height: 100%;
            gap: 0.375rem;
            padding: 0.25rem 0.5rem;
            font-size: 13px;
          }

          .profile-thread-actions .profile-thread-comment-like-slot button > span:last-child {
            font-size: 15px;
            line-height: 1;
          }

          @media (min-width: 640px) {
            .profile-thread-actions .profile-thread-comment-like-slot button {
              padding: 0.25rem 0.625rem;
              font-size: 0.875rem;
            }

            .profile-thread-actions .profile-thread-comment-like-slot button > span:last-child {
              font-size: 0.875rem;
            }
          }
        `;

export default function Profile() {
  const queryClient = useQueryClient();
  const { user: viewer } = useAuth();
  const { username = '' } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<ProfileTabValue>('posts');

  // メディア拡大用のステート
  const [failedThreadImageUrls, setFailedThreadImageUrls] = useState<string[]>([]);
  const [isScrolled, setIsScrolled] = useState(false);
  const tabsSentinelRef = useRef<HTMLDivElement>(null);
  const mobileTabsRef = useRef<HTMLDivElement>(null);
  const [highlightTabCenter, setHighlightTabCenter] = useState(0);
  // 仮想化用：カードごとに直近測定した高さを記憶しておくキャッシュ。
  // 画面外に出て中身をアンマウントする際、このキャッシュの高さで
  // プレースホルダーを描画するため、スクロール位置がズレない。
  const rowHeightCacheRef = useRef<Map<string, number>>(new Map());

  // 初回ペイント前にPC版のDOMが一瞬表示されるのを防ぐ。
  // useLayoutEffect はブラウザでのペイント前に実行されるため、
  // スマホではモバイル用CSSが適用された状態だけを最初に見せる。
  const [isViewportReady, setIsViewportReady] = useState(false);

  useLayoutEffect(() => {
    setIsViewportReady(true);
  }, []);

  const [profileReplies, setProfileReplies] = useState<ProfileReplyThread[]>([]);
  const [profileRepliesReady, setProfileRepliesReady] = useState(false);
  const [profileRepliesError, setProfileRepliesError] = useState(false);
  const [profileRepliesRefreshKey, setProfileRepliesRefreshKey] = useState(0);

  const { data: limeUser, isLoading: isLimeUserLoading, isError: isLimeUserError } = useProfile(username);
  // Lime に存在しないユーザーだけ Bluesky の公開 API で補完するため、
  // 既存プロフィールの取得・見た目には影響しない。
  const { data: blueskyProfile, isLoading: isBlueskyProfileLoading, isError: isBlueskyProfileError } = useQuery({
    queryKey: ['bluesky-profile', username],
    queryFn: ({ signal }) => fetchBlueskyProfile(username, signal),
    enabled: Boolean(username) && !isLimeUserLoading && !limeUser,
    staleTime: 1000 * 60,
  });
  const isBlueskyProfile = !limeUser && Boolean(blueskyProfile);
  const user = limeUser ?? blueskyProfile;
  const userLoading = isLimeUserLoading || (!limeUser && isBlueskyProfileLoading);
  const userError = !userLoading && !user && (isLimeUserError || isBlueskyProfileError);
  const {
    data: blueskyFeed,
    isLoading: isBlueskyFeedLoading,
    isError: isBlueskyFeedError,
    refetch: refetchBlueskyFeed,
    fetchNextPage:fetchExternalNextPage,
    hasNextPage:hasExternalNextPage,
    isFetchingNextPage:isFetchingExternalNextPage,
  } = useInfiniteQuery({
    queryKey: ['bluesky-profile-feed', username],
    initialPageParam:null as string|null,
    queryFn: ({ signal,pageParam }) => fetchBlueskyAuthorFeed({ actor: username, cursor:pageParam,limit:20,signal }),
    getNextPageParam:page=>page.cursor ?? undefined,
    select:data=>({posts:data.pages.flatMap(page=>page.posts),cursor:data.pages.at(-1)?.cursor ?? null}),
    enabled: isBlueskyProfile,
    staleTime: 1000 * 60,
  });

  const highlightsQuery = useProfileHighlights(!isBlueskyProfile ? user?.id : undefined, viewer?.id);
  const hasHighlights = !!highlightsQuery.data?.pages.some(page => page.length > 0);
  const hasReviews = !isBlueskyProfile && !!user && 'review' in user && user.review === true;
  const hasExtraTabs = hasHighlights || hasReviews;
  const visibleProfileTabs = profileTabs.filter(tab => (tab.value !== 'highlights' || hasHighlights) && (tab.value !== 'reviews' || hasReviews));
  useEffect(() => {
    if (activeTab === 'reviews' && !hasReviews) setActiveTab('posts');
  }, [activeTab, hasReviews]);
  useEffect(() => {
    if (activeTab === 'highlights' && !hasHighlights) setActiveTab('posts');
  }, [activeTab, hasHighlights, hasReviews]);
  useLayoutEffect(() => {
    const tabs = mobileTabsRef.current;
    const target = tabs?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    if (!hasExtraTabs || !tabs || !target || tabs.scrollWidth <= tabs.clientWidth) return;
    const box = target.getBoundingClientRect(), list = tabs.getBoundingClientRect();
    if (box.left < list.left) tabs.scrollLeft += box.left - list.left;
    else if (box.right > list.right) tabs.scrollLeft += box.right - list.right;
  }, [activeTab, hasHighlights, hasReviews]);
  useLayoutEffect(() => {
    const tabs = mobileTabsRef.current;
    if (!hasExtraTabs || !tabs) return;
    const measure = () => {
      const selected = tabs.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
      if (!selected) return;
      const tabBox = selected.getBoundingClientRect();
      const listBox = tabs.getBoundingClientRect();
      setHighlightTabCenter(tabBox.left - listBox.left + tabs.scrollLeft + tabBox.width / 2);
      if (activeTab === 'reviews' && tabs.scrollWidth > tabs.clientWidth) {
        if (tabBox.left < listBox.left) tabs.scrollLeft += tabBox.left - listBox.left;
        else if (tabBox.right > listBox.right) tabs.scrollLeft += tabBox.right - listBox.right;
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tabs);
    tabs.querySelectorAll('[role="tab"]').forEach(tab => observer.observe(tab));
    let cancelled = false;
    document.fonts?.ready.then(() => { if (!cancelled) measure(); });
    return () => { cancelled = true; observer.disconnect(); };
  }, [activeTab, hasHighlights, hasReviews]);
  // 非表示タブの無限スクロール取得を開始しない。
  // フック自体は常に同じ順序で呼び出し、アクティブなタブだけ userId を渡す。
  // これにより初回表示で4タブ分のデータを同時に保持する必要をなくす。
  const postsQuery = useUserPostsInfinite(!isBlueskyProfile && activeTab === 'posts' ? user?.id : undefined);
  const pinQuery=useQuery({queryKey:profilePinKey(user?.id??''),queryFn:()=>getProfilePin(user!.id),enabled:!!user?.id&&!isBlueskyProfile&&activeTab==='posts'});
  const pinnedPostQuery=useQuery({queryKey:['profile-pinned-post',user?.id,pinQuery.data,viewer?.id],queryFn:()=>getPostById(pinQuery.data!),enabled:!!pinQuery.data&&!isBlueskyProfile&&activeTab==='posts'});
  const pinnedPost=activeTab==='posts'&&pinnedPostQuery.data?.userId===user?.id?pinnedPostQuery.data:null;
  const likesQuery = useUserLikesInfinite(!isBlueskyProfile && activeTab === 'likes' ? user?.id : undefined);
  const mediaQuery = useUserMediaInfinite(!isBlueskyProfile && activeTab === 'media' ? user?.id : undefined);
  const reactionsQuery = useUserReactionsInfinite(!isBlueskyProfile && activeTab === 'reactions' ? user?.id : undefined);

  // タブに応じて使用するクエリを切り替え（Supabaseレベルでフィルタリングされた結果を取得）
  const currentQuery =
    activeTab === 'highlights'
      ? highlightsQuery
      : activeTab === 'likes'
      ? likesQuery
      : activeTab === 'media'
        ? mediaQuery
        : activeTab === 'reactions'
          ? reactionsQuery
          : postsQuery;

  const {
    data: profileData,
    isLoading: isProfileContentLoading,
    fetchNextPage:fetchNativeNextPage,
    hasNextPage:hasNativeNextPage,
    isFetchingNextPage:isFetchingNativeNextPage,
    isError: isProfileContentError,
    refetch: refetchCurrentQuery,
  } = currentQuery;
  const fetchNextPage=isBlueskyProfile ? fetchExternalNextPage:fetchNativeNextPage;
  const hasNextPage=isBlueskyProfile ? hasExternalNextPage:hasNativeNextPage;
  const isFetchingNextPage=isBlueskyProfile ? isFetchingExternalNextPage:isFetchingNativeNextPage;
  const contentLoading = isBlueskyProfile ? isBlueskyFeedLoading : isProfileContentLoading;
  const contentError = isBlueskyProfile ? isBlueskyFeedError : isProfileContentError;

  const { ref, inView } = useInView();

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    let lastScrolled = false;
    let frameId = 0;

    const getNextScrolled = () => {
      if (!tabsSentinelRef.current) return lastScrolled;

      const sentinelTop = tabsSentinelRef.current.getBoundingClientRect().top;

      // iOS Safari/PWA では sticky 到達直後に getBoundingClientRect().top が
      // 0px 付近で数pxだけ戻ることがあり、背景だけ一瞬 transparent 側へ戻る。
      // sticky 構造は変えず、既に追従中の時だけ 8px の戻り幅を許容してちらつきを止める。
      return lastScrolled ? sentinelTop <= 8 : sentinelTop <= 0;
    };

    const updateScrolledState = () => {
      frameId = 0;
      const nextScrolled = getNextScrolled();
      if (nextScrolled === lastScrolled) return;

      lastScrolled = nextScrolled;
      setIsScrolled(nextScrolled);
    };

    const handleScroll = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(updateScrolledState);
    };

    lastScrolled = tabsSentinelRef.current?.getBoundingClientRect().top <= 0;
    setIsScrolled(lastScrolled);
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);
    window.visualViewport?.addEventListener('scroll', handleScroll, { passive: true });
    window.visualViewport?.addEventListener('resize', handleScroll);

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
      window.visualViewport?.removeEventListener('scroll', handleScroll);
      window.visualViewport?.removeEventListener('resize', handleScroll);
    };
  }, []);

  useEffect(() => {
    if (activeTab !== 'posts') return;

    const handleReactionChanged = () => {
      setProfileRepliesRefreshKey((value) => value + 1);
    };

    window.addEventListener('profile-thread-reaction-changed', handleReactionChanged);

    return () => {
      window.removeEventListener('profile-thread-reaction-changed', handleReactionChanged);
    };
  }, [activeTab]);

  // Twitterと同様、タイムライン最上部でのプルダウンで最新の投稿を再取得する。
  // Blueskyプロフィールの場合はBluesky側のフィードを、それ以外はアクティブな
  // タブ（ポスト/メディア/いいね/リアクション）のクエリと、posts タブでの
  // 返信スレッド（コメント）を合わせて再取得する。
  const handleProfilePullRefresh = useCallback(async () => {
    const tasks: Array<Promise<any>> = [];

    if (isBlueskyProfile) {
      if (typeof refetchBlueskyFeed === 'function') {
        tasks.push(refetchBlueskyFeed());
      }
    } else if (activeTab === 'reviews' && user?.id) {
      tasks.push(queryClient.invalidateQueries({ queryKey: accountReviewsKey(user.id) }));
    } else {
      if (typeof refetchCurrentQuery === 'function') {
        tasks.push(refetchCurrentQuery());
      }

      if (activeTab !== 'highlights') tasks.push(highlightsQuery.refetch());

      if (activeTab === 'posts') {
        setProfileRepliesRefreshKey((value) => value + 1);
      }
    }

    await Promise.all(tasks);
  }, [isBlueskyProfile, refetchBlueskyFeed, refetchCurrentQuery, highlightsQuery.refetch, activeTab, queryClient, user?.id]);

  // モーダル表示中や初期ロード中はプルダウン更新を無効化する
  const isPullToRefreshEnabled = !userLoading;
  const { pullDistance, isRefreshing: isPullRefreshing, isPulling } = usePullToRefresh(
    handleProfilePullRefresh,
    isPullToRefreshEnabled
  );

  useEffect(() => {
    setProfileReplies([]);
    setProfileRepliesError(false);
    setProfileRepliesReady(false);
    rowHeightCacheRef.current = new Map();
  }, [user?.id]);

  useEffect(() => {
    if (isBlueskyProfile) {
      setProfileReplies([]);
      setProfileRepliesError(false);
      setProfileRepliesReady(true);
      return;
    }
    if (!user?.id || activeTab !== 'posts') return;

    let cancelled = false;

    const fetchProfileReplies = async () => {
      setProfileRepliesError(false);

      try {
        const currentUserId = await getCachedCurrentUserId();

        const { data: comments, error: commentsError } = await supabase
          .from('comments')
          .select('id, post_id, user_id, content, created_at, likes_count, image_urls, parent_comment_id, client_name')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(PROFILE_REPLY_LIMIT);

        if (commentsError) throw commentsError;

        const rows = comments || [];
        const postIds = uniqueStrings(rows.map((row: any) => row.post_id).filter(Boolean));

        let parentMetadataRows: any[] = [];
        if (postIds.length > 0) {
          const { data: postMetadata, error: metadataError } = await supabase
            .from('posts')
            .select('id, user_id, visibility')
            .in('id', postIds);

          if (metadataError) throw metadataError;
          parentMetadataRows = postMetadata || [];
        }

        const parentMetadataMap = new Map<string, any>(
          parentMetadataRows
            .filter((post: any) => post?.id)
            .map((post: any) => [post.id, post])
        );

        let visibleLimitedParentAuthorIds = new Set<string>();
        const limitedParentAuthorIds = uniqueStrings(
          parentMetadataRows
            .filter((post: any) => normalizePostVisibility(post?.visibility) !== 'public')
            .map((post: any) => getPostOwnerId(post))
            .filter((authorId: string) => Boolean(authorId))
        );

        if (currentUserId && limitedParentAuthorIds.length > 0) {
          const { data: followRows, error: followError } = await supabase
            .from('follows')
            .select('follower_id')
            .eq('followee_id', currentUserId)
            .in('follower_id', limitedParentAuthorIds);

          if (followError) throw followError;
          visibleLimitedParentAuthorIds = new Set(
            (followRows || [])
              .map((row: any) => row.follower_id)
              .filter(Boolean)
          );
        }

        const visibleParentIds = parentMetadataRows
          .filter((post: any) => canShowParentPostInsideProfileReplies({
            post,
            currentUserId,
            visibleLimitedParentAuthorIds,
          }))
          .map((post: any) => post.id)
          .filter(Boolean);
        const visibleParentIdSet = new Set(visibleParentIds);
        const visibleRows = rows.filter((row: any) => visibleParentIdSet.has(row.post_id));
        const visibleCommentIds = uniqueStrings(visibleRows.map((row: any) => row.id).filter(Boolean));

        let parentPosts: any[] = [];
        if (visibleParentIds.length > 0) {
          const { data: posts, error: postsError } = await supabase
            .from('posts')
            .select(`
              *,
              profiles:profiles!posts_user_id_fkey (
                id,
                username,
                display_name,
                avatar_url,
                bio,
                created_at,
                is_official,
                emoji_effect,
                bot_enabled,
                bot_prompt,
                bot_interval_hours,
                prefecture,
                city
              )
            `)
            .in('id', visibleParentIds);

          if (postsError) throw postsError;
          parentPosts = (posts || []).filter((post: any) => {
            const metadata = parentMetadataMap.get(post?.id);
            return Boolean(metadata && canShowParentPostInsideProfileReplies({
              post: metadata,
              currentUserId,
              visibleLimitedParentAuthorIds,
            }));
          });
        }

        // Resolve ancestors in batches, keeping root-post visibility checks in place.
        const parentCommentRows: any[] = [];
        const knownCommentIds = new Set(visibleRows.map((row: any) => row.id));
        let pendingParentIds = uniqueStrings(visibleRows.map((row: any) => row.parent_comment_id).filter(Boolean));
        while (pendingParentIds.length) {
          const missingIds = pendingParentIds.filter(id => !knownCommentIds.has(id));
          if (!missingIds.length) break;
          missingIds.forEach(id => knownCommentIds.add(id));
          const { data: ancestors, error } = await supabase.from('comments').select('*, profiles:profiles!comments_user_id_fkey(*)').in('id', missingIds).in('post_id', visibleParentIds);
          if (error) throw error;
          parentCommentRows.push(...(ancestors ?? []));
          pendingParentIds = uniqueStrings((ancestors ?? []).map((row: any) => row.parent_comment_id).filter(Boolean));
        }
        const allVisibleCommentIds = uniqueStrings([...visibleCommentIds, ...(parentCommentRows ?? []).map((row: any) => row.id)]);

        // These reads depend only on the already checked visible IDs.
        // Fetch together without caching or delaying real-time updates.
        const [commentLikesRes, parentLikesRes, parentReactionsRes, commentReactionsRes] = await Promise.all([
          currentUserId && allVisibleCommentIds.length > 0
            ? supabase.from('comment_likes').select('comment_id')
                .eq('user_id', currentUserId).in('comment_id', allVisibleCommentIds)
            : Promise.resolve({ data: [], error: null }),
          currentUserId && visibleParentIds.length > 0
            ? supabase.from('likes').select('post_id')
                .eq('user_id', currentUserId).in('post_id', visibleParentIds)
            : Promise.resolve({ data: [], error: null }),
          visibleParentIds.length > 0
            ? supabase.from('post_reactions').select('post_id, user_id, emoji')
                .in('post_id', visibleParentIds)
            : Promise.resolve({ data: [], error: null }),
          allVisibleCommentIds.length > 0
            ? supabase.from('comment_reactions').select('comment_id, user_id, emoji')
                .in('comment_id', allVisibleCommentIds)
            : Promise.resolve({ data: [], error: null }),
        ]);
        for (const result of [commentLikesRes, parentLikesRes, parentReactionsRes, commentReactionsRes]) {
          if (result.error) throw result.error;
        }
        const commentLikeRows = commentLikesRes.data || [];
        const parentLikedRows = parentLikesRes.data || [];
        const parentReactionRows = parentReactionsRes.data || [];
        const commentReactionRows = commentReactionsRes.data || [];

        const parentReactionMap = groupProfileReactionRows(parentReactionRows, 'post_id', currentUserId);
        const commentReactionMap = groupProfileReactionRows(commentReactionRows, 'comment_id', currentUserId);
        const parentLikedSet = new Set(parentLikedRows.map((row: any) => row.post_id));
        const likedCommentSet = new Set<string>();

        commentLikeRows.forEach((row: any) => {
          if (row?.comment_id) {
            likedCommentSet.add(row.comment_id);
          }
        });

        const parentEntries: Array<[string, any]> = [];
        parentPosts.forEach((post: any) => {
          const metadata = parentMetadataMap.get(post.id);
          if (!metadata) return;

          const normalizedParent = normalizePost({
            ...post,
            user_id: metadata.user_id ?? post.user_id,
            visibility: metadata.visibility,
            liked_by_me: parentLikedSet.has(post.id),
            likedByMe: parentLikedSet.has(post.id),
          });

          if (normalizedParent) {
            parentEntries.push([post.id, normalizedParent]);
          }
        });

        const parentMap = new Map(parentEntries);

        const replyAuthor = normalizeAuthor(user, user.id);

        const toReply = (comment: any, author: any): ProfileReplyThreadComment => ({
          id: comment.id,
          postId: comment.post_id,
          userId: comment.user_id,
          content: comment.content ?? '',
          imageUrls: comment.image_urls ?? [],
          parentCommentId: comment.parent_comment_id ?? null,
          replyToUsername: comment.parent_comment_id ? normalizeAuthor(parentCommentRows.find((row: any) => row.id === comment.parent_comment_id)?.profiles)?.username : parentMap.get(comment.post_id)?.author?.username,
          clientName: comment.client_name ?? undefined,
          createdAt: comment.created_at,
          likesCount: Number(comment.likes_count ?? 0),
          likedByMe: likedCommentSet.has(comment.id),
          author,
          reactions: commentReactionMap.get(comment.id) ?? [],
        });
        const parentCommentMap = new Map<string, ProfileReplyThreadComment>((parentCommentRows ?? []).map((comment: any) => [comment.id, toReply(comment, normalizeAuthor(comment.profiles, comment.user_id))]));
        const nextReplies = buildProfileReplyThreads(
          visibleRows.map((comment: any) => toReply(comment, replyAuthor)), parentMap, parentCommentMap, parentReactionMap, commentReactionMap,
        );

        if (!cancelled) {
          setProfileReplies(nextReplies);
        }
      } catch (error) {
        console.error('Fetch profile replies failed:', error);
        if (!cancelled) {
          setProfileReplies([]);
          setProfileRepliesError(true);
        }
      } finally {
        if (!cancelled) {
          setProfileRepliesReady(true);
        }
      }
    };

    fetchProfileReplies();

    return () => {
      cancelled = true;
    };
  }, [user?.id, activeTab, isBlueskyProfile, profileRepliesRefreshKey]);

  // モーダル表示時にスクロールを固定


  // 画像拡大表示中は Escape キーで閉じられるようにする


  // normalizeAuthor / normalizePost / uniquePostsById / groupReactionPosts は
  // props や state に依存しない純粋関数のため、ファイル先頭のモジュール
  // スコープへ移動済み（レンダーの度に関数を再生成しないための軽量化）。

  const pages = isBlueskyProfile ? [blueskyFeed?.posts ?? EMPTY_ARRAY] : profileData?.pages ?? EMPTY_ARRAY;
  const flatPageItems = useMemo(
    () => pages.flatMap((page: any) => (Array.isArray(page) ? page : [])),
    [pages]
  );

  // データのフラット化
  const items: ProfileFeedItem[] = useMemo(() => {
    // Reviews have their own data source. During profile navigation the tab can
    // remain selected for one render before the disabled-tab effect resets it.
    if (activeTab === 'reviews') return [];

    if (activeTab === 'likes') {
      return uniquePostsById(
        flatPageItems
          .map((like: any) => like.posts)
          .filter(Boolean)
      );
    }

    if (activeTab === 'reactions') {
      return groupReactionPosts(flatPageItems);
    }

    if (activeTab === 'media') {
      return flatPageItems.flatMap((rawPost: any) => {
        const p: any | null = normalizePost(rawPost);
        if (!p) return [];

        const dbImages = Array.isArray(p.imageUrls)
          ? p.imageUrls
          : Array.isArray(p.image_urls)
            ? p.image_urls
            : [];

        const extractedImages = typeof p.content === 'string' ? p.content.match(imageRegex) || [] : [];
        const allUrls = Array.from(new Set([...dbImages, ...extractedImages]));

        if (allUrls.length === 0) return [];

        // 画像1枚ごとに投稿本体を複製すると、画像の多い投稿ほどメモリを消費する。
        // 投稿本体は1つだけ保持し、表示用の小さな情報だけを画像アイテム側に持たせる。
        return allUrls.map((url, idx) => ({
          post: p,
          displayImageUrl: url,
          displayImageKey: `${p.id}-${idx}-${url}`,
          isMulti: allUrls.length > 1,
        }));
      });
    }

    if (activeTab === 'highlights') return uniquePostsById(flatPageItems);

    const ownPosts: ProfilePostItem[] = uniquePostsById(flatPageItems).map((post: any) => ({
      __profileItemType: PROFILE_POST_ITEM,
      sortAt: post.profileRepostedAt ?? post.createdAt ?? post.created_at ?? new Date().toISOString(),
      post,
    }));

    const replies: ProfileReplyItem[] = profileReplies.map((reply) => ({
      __profileItemType: PROFILE_REPLY_ITEM,
      sortAt: reply.createdAt,
      reply,
    }));

    return [...ownPosts, ...replies].sort((a, b) => {
      const aTime = new Date(a.sortAt || 0).getTime();
      const bTime = new Date(b.sortAt || 0).getTime();
      return bTime - aTime;
    });
  }, [activeTab, flatPageItems, profileReplies]);

  const handleThreadImageError = useCallback((url: string) => {
    setFailedThreadImageUrls((prev) => (prev.includes(url) ? prev : [...prev, url]));
  }, []);

  const profilePostsLoading = activeTab === 'posts'
    ? contentLoading || !profileRepliesReady || (!isBlueskyProfile && (pinQuery.isPending || (!!pinQuery.data && pinnedPostQuery.isPending)))
    : contentLoading;
  const profilePostsEmpty = !profilePostsLoading && !contentError && !isFetchingNextPage && items.length === 0 && !pinnedPost;

  if (userLoading) {
    return (
      <div
        className="-mt-[0px] space-y-0 sm:mt-0 sm:space-y-5"
        style={{ visibility: isViewportReady ? 'visible' : 'hidden' }}
      >
        <Skeleton className="h-72 w-full rounded-none sm:rounded-3xl" />

        <div className="h-16 w-full sm:hidden">
          <div className="grid h-full w-full grid-cols-4 rounded-none bg-transparent p-0">
            <Skeleton className="h-full rounded-none bg-muted/40" />
            <Skeleton className="h-full rounded-none bg-muted/40" />
            <Skeleton className="h-full rounded-none bg-muted/40" />
            <Skeleton className="h-full rounded-none bg-muted/40" />
          </div>
        </div>

        <div className="hidden gap-2 sm:flex">
          <Skeleton className="h-10 w-1/4 rounded-xl" />
          <Skeleton className="h-10 w-1/4 rounded-xl" />
          <Skeleton className="h-10 w-1/4 rounded-xl" />
          <Skeleton className="h-10 w-1/4 rounded-xl" />
        </div>

        <div data-lime-profile-posts className="space-y-0 sm:space-y-4">
          <PostCardSkeleton />
          <PostCardSkeleton />
        </div>
      </div>
    );
  }

  if (userError || user === null) {
    return (
      <div
        className="rounded-3xl border border-border/60 bg-card p-10 text-center text-muted-foreground"
        style={{ visibility: isViewportReady ? 'visible' : 'hidden' }}
      >
        ユーザーが見つかりませんでした。
      </div>
    );
  }

  return (
    <div
      className="-mt-[0px] space-y-0 sm:mt-0 sm:space-y-5"
      style={{ visibility: isViewportReady ? 'visible' : 'hidden' }}
    >
      <style>{PROFILE_PAGE_STYLES}</style>

      {/* プルダウン更新インジケーター（Twitter風）。モバイルのタッチ操作、
          PCのマウスドラッグどちらでも、タイムライン最上部から下へ引っ張ると表示される。 */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed left-1/2 top-0 z-[70] flex justify-center"
        style={{
          transform: `translate(-50%, ${(isPullRefreshing ? PULL_REFRESH_THRESHOLD : pullDistance) - 36}px)`,
          opacity: isPullRefreshing || pullDistance > 4 ? 1 : 0,
          transition: isPulling
            ? 'none'
            : 'transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 200ms ease',
        }}
      >
        <div className="mt-2 flex h-10 w-10 items-center justify-center rounded-full border border-border/70 bg-card/95 shadow-lg backdrop-blur-sm">
          <Loader2
            className={`h-5 w-5 text-pink-500 ${isPullRefreshing ? 'animate-spin' : ''}`}
            style={
              isPullRefreshing
                ? undefined
                : { transform: `rotate(${Math.min(360, (pullDistance / PULL_REFRESH_THRESHOLD) * 360)}deg)` }
            }
          />
        </div>
      </div>

      {user && <ProfileHeader
        user={user}
        isBlueskyProfile={isBlueskyProfile}
        onOpenReviews={() => {
          setActiveTab('reviews');
          window.requestAnimationFrame(() => tabsSentinelRef.current?.scrollIntoView({ block: 'start' }));
        }}
        blueskyStats={isBlueskyProfile ? {
          following: blueskyProfile?.followingCount ?? 0,
          followers: blueskyProfile?.followersCount ?? 0,
          posts: blueskyProfile?.postsCount ?? 0,
        } : undefined}
      />}

      <Tabs
        value={activeTab}
        defaultValue="posts"
        className="w-full"
        onValueChange={(value) => setActiveTab(value as ProfileTabValue)}
      >
        <div ref={tabsSentinelRef} className="h-0" />

        <div
          data-lime-profile-tabs-header
          className={[
            'relative sticky top-0 z-50 flex h-16 w-full isolate items-center overflow-visible bg-transparent sm:transition-all sm:duration-300',
            isScrolled
              ? 'sm:border-b sm:border-black/[0.03] sm:bg-[#fbf9f2]/70 sm:dark:border-white/[0.05] sm:dark:bg-[#000000]/70'
              : 'sm:bg-transparent',
          ].join(' ')}
        >
          <div
            data-lime-profile-tabs-backdrop
            className={[
              'pointer-events-none absolute inset-y-0 left-1/2 z-0 w-screen -translate-x-1/2 transform-gpu sm:hidden',
              isScrolled
                ? 'bg-[#fbf9f2]/65 backdrop-blur-md dark:bg-[#000000]/65'
                : 'bg-transparent',
            ].join(' ')}
          />

          <div
            data-lime-profile-tabs-divider
            className={[
              'pointer-events-none absolute h-px sm:hidden',
              'left-1/2 z-10 w-screen -translate-x-1/2',
              isScrolled
                ? 'bottom-0 bg-black/[0.03] dark:bg-white/[0.05]'
                : 'bottom-2 bg-border/50',
            ].join(' ')}
          />

          <TabsList ref={mobileTabsRef} data-lime-profile-mobile-tabs data-lime-profile-tabs-scrollable={hasExtraTabs ? '' : undefined} className={`relative z-20 h-full w-full rounded-none bg-transparent p-0 shadow-none sm:hidden ${hasExtraTabs ? 'flex justify-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden' : 'grid grid-cols-4'}`}>
            <span
              aria-hidden="true"
              className="profile-tabs-underline pointer-events-none absolute bottom-2 left-0 z-[2] h-[4px] w-16 -translate-x-1/2 rounded-full bg-pink-500 sm:w-10"
              style={{
                left: hasExtraTabs ? highlightTabCenter : `${((Math.max(0, visibleProfileTabs.findIndex((tab) => tab.value === activeTab)) + 0.5) / visibleProfileTabs.length) * 100}%`,
              }}
            />

            {visibleProfileTabs.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className={`profile-tabs-trigger relative h-full min-h-15 min-w-0 rounded-none border-0 bg-transparent px-0 text-[14px] leading-none shadow-none outline-none transition-none duration-0 hover:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=inactive]:bg-transparent min-[390px]:text-[12px] sm:text-[14px] ${hasExtraTabs ? 'flex-1 shrink-0 min-w-max px-3' : ''}`}
              >
                <span data-lime-tab-label className="whitespace-nowrap">
                  {tab.label}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsList data-lime-profile-desktop-tabs style={{ gridTemplateColumns: `repeat(${visibleProfileTabs.length}, minmax(0, 1fr))` }} className="hidden w-full grid-cols-4 rounded-2xl bg-muted/50 p-1 sm:grid">
            {visibleProfileTabs.map((tab) => (
              <TabsTrigger
                key={`desktop-${tab.value}`}
                value={tab.value}
                className="rounded-xl font-bold transition-all"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {activeTab === 'reviews' ? (hasReviews && user ? <AccountReviewsTab profileId={user.id} /> : null) : <div data-lime-profile-posts className="space-y-0 sm:space-y-4">
          {profilePostsLoading && (
            <>
              <PostCardSkeleton />
              <PostCardSkeleton />
            </>
          )}

          {!profilePostsLoading && contentError && (
            <div className="m-4 rounded-3xl border border-dashed border-border bg-card/60 p-10 text-center text-sm text-muted-foreground animate-in fade-in zoom-in duration-300 sm:m-0 sm:p-12">
              {activeTab === 'posts' && '投稿の取得に失敗しました。'}
              {activeTab === 'highlights' && 'ハイライトの取得に失敗しました。'}
              {activeTab === 'likes' && 'いいねした投稿の取得に失敗しました。'}
              {activeTab === 'media' && 'メディア投稿の取得に失敗しました。'}
              {activeTab === 'reactions' && 'リアクションの取得に失敗しました。'}
            </div>
          )}

          {!profilePostsLoading && !contentError && activeTab === 'posts' && profileRepliesError && items.length > 0 && (
            <div className="m-4 rounded-2xl border border-dashed border-border/70 bg-card/50 p-4 text-center text-xs text-muted-foreground sm:m-0">
              返信の一部を取得できませんでした。
            </div>
          )}

          {profilePostsEmpty && (
            <div className="m-4 rounded-3xl border border-dashed border-border bg-card/60 p-10 text-center text-sm text-muted-foreground animate-in fade-in zoom-in duration-300 sm:m-0 sm:p-12">
              {activeTab === 'posts' && 'まだ投稿がありません。'}
              {activeTab === 'highlights' && 'ハイライトした投稿がありません。'}
              {activeTab === 'likes' && 'いいねした投稿がありません。'}
              {activeTab === 'media' && 'メディア投稿がありません。'}
              {activeTab === 'reactions' && 'リアクションした投稿がありません。'}
            </div>
          )}

          {pinnedPost && <div className="animate-float-up"><PostCard post={pinnedPost} pinned/></div>}
          {!profilePostsLoading && (activeTab === 'media' ? (
            <div className="grid grid-cols-3 gap-1 px-0 md:gap-2">
              {items.map((p: any, idx: number) => (
                <div
                  key={`media-${p.displayImageKey ?? `${p.post?.id ?? p.id}-${idx}`}`}
                  className="relative aspect-square cursor-pointer overflow-hidden rounded-md bg-muted animate-float-up md:rounded-xl"
                  onClick={() => openMediaViewer({ url: p.displayImageUrl, post: p.post })}
                >
                  <ProfileVirtualizedMediaImage src={p.displayImageUrl} />

                  {p.isMulti && (
                    <div className="absolute right-1.5 top-1.5 rounded-md bg-black/40 p-1 backdrop-blur-sm">
                      <ImageIcon className="h-3.5 w-3.5 text-white" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            items.map((item: any, idx: number) => {
              if (activeTab === 'posts' && isProfileReplyItem(item)) {
                const rowKey = `profile-reply-${item.reply.id}`;

                return (
                  <div key={rowKey} className="animate-float-up">
                    <ProfileVirtualizedListItem rowKey={rowKey} heightCache={rowHeightCacheRef}>
                      <ProfileReplyThreadCard
                        thread={item.reply}
                        onImageClick={selection => openMediaViewer({ url: selection.url, postId: selection.targetType === 'comment' ? `reply:${selection.targetId}` : selection.postId })}
                        onImageError={handleThreadImageError}
                      />
                    </ProfileVirtualizedListItem>
                  </div>
                );
              }

              const p = activeTab === 'posts' && item?.__profileItemType === PROFILE_POST_ITEM ? item.post : item;
              if(activeTab==='posts'&&pinnedPost?.id===p.id&&!p.profileRepostedBy)return null;
              const rowKey = activeTab === 'posts' ? `profile-post-${profilePostIdentity(p)}` : activeTab === 'reactions' ? `reactions-${p.id}-${idx}` : `${activeTab}-${p.id}-${idx}`;

              return (
                <div
                  key={rowKey}
                  className="animate-float-up"
                >
                  <ProfileVirtualizedListItem rowKey={rowKey} heightCache={rowHeightCacheRef}>
                    {activeTab === 'reactions' && (
                      <div className="px-1 pb-1 text-sm text-muted-foreground">
                        <span className="mr-1 text-base">
                          {Array.isArray(p.reactionEmojis) && p.reactionEmojis.length > 0
                            ? p.reactionEmojis.join(' ')
                            : p.reactionEmoji}
                        </span>
                        でリアクションしました
                      </div>
                    )}

                    {p.replyId ? <RepostedReplyCard post={p} repostedByLabel={p.profileRepostedBy === viewer?.id ? 'あなた' : `${user?.displayName ?? user?.username ?? ''}さん`} /> : <PostCard post={p} repostedByLabel={p.profileRepostedBy ? (p.profileRepostedBy === viewer?.id ? 'あなた' : `${user?.displayName ?? user?.username ?? ''}さん`) : undefined} />}
                  </ProfileVirtualizedListItem>
                </div>
              );
            })
          ))}

          <div ref={ref} className="flex justify-center py-8 sm:py-10">
            {!profilePostsLoading && (isFetchingNextPage ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">さらに読み込み中...</span>
              </div>
            ) : hasNextPage ? (
              <div className="h-8 sm:h-10" />
            ) : items.length > 0 ? (
              <p className="text-center text-xs text-muted-foreground">
                すべての表示が完了しました
              </p>
            ) : null)}
          </div>
        </div>}
      </Tabs>

      {failedThreadImageUrls.length > 0 && (
        <div className="hidden" aria-hidden="true">
          {failedThreadImageUrls.join('\n')}
        </div>
      )}
    </div>
  );
}
