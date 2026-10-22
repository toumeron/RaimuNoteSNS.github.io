import { initialImageFrame, initialMediaSize } from "@/lib/mediaThumbnail";
import { ContentLink } from "@/components/ui/button";
import { useMinuteTick, useTimelinePortalTheme, useViewportWidth, usePageVisible, observeElementVisibility } from "@/hooks/useViewportWidth";
import { displayUsername, canShowPostLinkPreview, hasAttachedPostVideo, randomUUID, splitMentionText, mentionProfileHandle, isInstalledPwa, hasStickers, spaceLinkIn, formatRelative } from "@/lib/utils";
import { PostSourceLabel, ExternalPostDetails, LinkPreviewCard, useLinkPreview, QuotedPost, PostImages } from "@/components/feed/QuotedPost";
import { isDeferredPrivateMedia } from "@/lib/privateMediaFetch";
import { PrivateMediaImage, ProviderVerificationBadge, PrivateAccountBadge, Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PostVideoPlayer } from "@/components/video/PostVideoPlayer";
import { PostPoll, RepostIcon } from "@/components/feed/PostPoll";
import { ExternalReplyCard } from "@/components/post/CommentList";
import { mobilePostMenuOS, ExternalLikeButton, HighlightPostMenuButton, PinPostMenuButton, BookmarkButton, RepostButton } from "@/components/feed/RepostButton";
import { toast } from "sonner";
import { openMediaViewer } from "@/lib/mediaThumbnail";
import { OfflineBookmarkContext, renderStickerText } from "@/components/feed/QuotedPost";
import { SpacePostCard } from "@/components/spaces/SpaceProvider";
import { useDesktopLayout } from "@/components/layout/DesktopLayoutContext";
import { lazy, Suspense, memo, useCallback, useId, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { Download, EyeOff, MessageCircle, MoreHorizontal, Trash2, CalendarDays, ChartBarBig, X, Globe, Lock, Sparkles, Plus, Link as LinkIcon, Upload, Send, Heart, Users, Pin, Pencil } from "lucide-react";
import { LikeButton } from "@/components/post/LikeButton";
import { type PostWithAuthor } from "@/types/index";
import { deletePost } from "@/api/posts";
import { getCurrentUserId } from "@/lib/currentUser";
import { supabase, sendLimeDrop } from "@/lib/supabase";
import dayjs from "dayjs";
import { useAuth, useMembershipStatus, useBlueskySession } from "@/hooks/useAuth";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/button";
import { FollowButton } from "@/components/profile/ProfileHeader";
import { useFollowStats } from "@/hooks/useFeed";
import { getBlueskyUriFromPostId } from "@/lib/bluesky";

// YouTubeEmbed
interface YouTubeEmbedProps {
  videoId: string;
}

declare global {
  interface Window {
    __limeBackgroundMediaActiveKey?: string | null;
    __limeYouTubePlaybackDiagnostics?: Array<{ videoId: string; time: number; state: number; muted: boolean | null; volume: number | null; mini: boolean; currentTime?: number | null; action?: string }>;
  }
}

const LIME_BACKGROUND_MEDIA_PLAY_EVENT = 'lime-background-media-play';
const LIME_BACKGROUND_MEDIA_STOP_EVENT = 'lime-background-media-stop';

const getYouTubeEmbedUrl = (videoId: string) => {
  const params = new URLSearchParams({
    playsinline: '1',
    rel: '0',
    enablejsapi: '1',
    autoplay: '0',
    controls: '1',
  });

  if (typeof window !== 'undefined') {
    params.set('origin', window.location.origin);
  }

  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
};

const parseYouTubeMessage = (data: unknown): any | null => {
  if (!data) return null;

  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  if (typeof data === 'object') {
    return data;
  }

  return null;
};

const sendYouTubeListeningMessage = (iframe: HTMLIFrameElement | null, id: string) => {
  if (!iframe?.contentWindow) return;

  try {
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: 'listening', id }),
      'https://www.youtube.com'
    );
  } catch {
    // noop
  }
};

/** Keep the native iframe in its post: scrolling must not relocate or resize it. */
const YouTubeEmbed = ({ videoId }: YouTubeEmbedProps) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const id = useId();
  const mediaKey = `youtube:${id}:${videoId}`;
  const playingRef = useRef(false);
  const soundState = useRef({ state: -1, muted: null as boolean | null, volume: null as number | null });
  const playbackPosition = useRef<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const notify = useCallback((active: boolean) => {
    if (playingRef.current === active) return;
    playingRef.current = active;
    const event = new CustomEvent(active ? LIME_BACKGROUND_MEDIA_PLAY_EVENT : LIME_BACKGROUND_MEDIA_STOP_EVENT, {
      bubbles: true, detail: { key: mediaKey, kind: 'youtube', title: 'YouTube video player', element: iframeRef.current },
    });
    if (iframeRef.current?.isConnected) iframeRef.current.dispatchEvent(event);
    else window.dispatchEvent(event);
  }, [mediaKey]);

  useEffect(() => {
    soundState.current = { state: -1, muted: null, volume: null };
    playbackPosition.current = null;
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
    let restarted = false, restartPosition = 0, playingSince: number | null = null, blocked = false;
    const record = (action?: string) => {
      const history = window.__limeYouTubePlaybackDiagnostics ??= [];
      history.push({ videoId, time: Date.now(), ...soundState.current, mini: false, currentTime: playbackPosition.current, ...(action ? { action } : {}) });
      if (history.length > 40) history.splice(0, history.length - 40);
    };
    const cancelRecovery = () => { clearTimeout(recoveryTimer); recoveryTimer = undefined; };
    const canRecover = () => !blocked && playingRef.current && soundState.current.state === 3 && document.visibilityState !== 'hidden';
    const recover = () => {
      if (!canRecover()) { cancelRecovery(); return; }
      if (recoveryTimer !== undefined || restarted || playbackPosition.current === null) return;
      recoveryTimer = setTimeout(() => {
        recoveryTimer = undefined;
        if (!canRecover()) return;
        const target = iframeRef.current?.contentWindow;
        if (!target) return;
        // Repeated play/seek commands cannot repair a stuck stream. Request
        // a fresh stream once at the last position, keeping this iframe alive.
        restarted = true;
        restartPosition = playbackPosition.current!;
        target.postMessage(JSON.stringify({ event: 'command', func: 'loadVideoById', args: [{ videoId, startSeconds: restartPosition }] }), 'https://www.youtube.com');
        record('recover-reload');
      }, 4000);
    };

    const message = (event: MessageEvent) => {
      if (event.origin !== 'https://www.youtube.com' || !iframeRef.current?.contentWindow || event.source !== iframeRef.current.contentWindow) return;
      const data = parseYouTubeMessage(event.data);
      if (!data || typeof data.event !== 'string') return;
      // Stop handshake retries once this exact iframe has responded. Never
      // reinitialise a player that is already delivering playback updates.
      timers.current.forEach(clearTimeout);
      timers.current = [];
      const state = data.event === 'onStateChange' ? data.info : data.info?.playerState;
      if (typeof data.info?.currentTime === 'number' && Number.isFinite(data.info.currentTime) && data.info.currentTime >= 0) playbackPosition.current = data.info.currentTime;
      const previous = soundState.current;
      const next = {
        state: typeof state === 'number' ? state : previous.state,
        muted: typeof data.info?.muted === 'boolean' ? data.info.muted : previous.muted,
        volume: typeof data.info?.volume === 'number' ? data.info.volume : previous.volume,
      };
      if (next.state !== previous.state || next.muted !== previous.muted || next.volume !== previous.volume) {
        soundState.current = next;
        record();
      }
      if (state === 1) {
        blocked = false;
        if (previous.state !== 1) playingSince = Date.now();
        notify(true);
      } else if (state === 0 || state === 2 || data.event === 'onError') {
        notify(false);
        playingSince = null;
      } else if (state === 3 && previous.state !== 3) {
        // Permit a later recovery only after the stream has actually advanced;
        // brief playing/buffering bounces must not cause a reload loop.
        if (playingSince !== null && Date.now() - playingSince >= 5000 && playbackPosition.current !== null && playbackPosition.current >= restartPosition + 5) restarted = false;
        playingSince = null;
      }
      if (data.event === 'onAutoplayBlocked' || data.event === 'onError') {
        blocked = true;
        record(data.event);
      }
      recover();
    };
    const otherPlayback = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; kind?: string }>).detail;
      if (detail?.kind === 'youtube' && detail.key !== mediaKey && playingRef.current) iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), 'https://www.youtube.com');
    };
    window.addEventListener(LIME_BACKGROUND_MEDIA_PLAY_EVENT, otherPlayback);
    window.addEventListener('message', message);
    document.addEventListener('visibilitychange', recover);
    window.addEventListener('online', recover);
    return () => {
      cancelRecovery();
      document.removeEventListener('visibilitychange', recover);
      window.removeEventListener('online', recover);
      window.removeEventListener('message', message);
      window.removeEventListener(LIME_BACKGROUND_MEDIA_PLAY_EVENT, otherPlayback);
      timers.current.forEach(clearTimeout);
      if (playingRef.current) window.dispatchEvent(new CustomEvent(LIME_BACKGROUND_MEDIA_STOP_EVENT, { detail: { key: mediaKey } }));
      playingRef.current = false;
    };
  }, [mediaKey, notify, videoId]);

  return <div className="my-3 aspect-video w-full overflow-hidden rounded-xl border border-border bg-black shadow-sm">
    <iframe key={videoId} ref={iframeRef} src={getYouTubeEmbedUrl(videoId)} width="100%" height="100%" loading="lazy" title="YouTube video player" frameBorder="0"
      allow="autoplay; accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" className="block h-full w-full"
      onLoad={() => {
        timers.current.forEach(clearTimeout);
        sendYouTubeListeningMessage(iframeRef.current, mediaKey);
        timers.current = [500, 1500].map(delay => setTimeout(() => sendYouTubeListeningMessage(iframeRef.current, mediaKey), delay));
      }} />
  </div>;
};

// SpotifyEmbed
interface SpotifyEmbedProps {
  url: string;
}

declare global {
  interface Window {
    __limeBackgroundMediaActiveKey?: string | null;
  }
}

const SpotifyEmbedLIME_BACKGROUND_MEDIA_PLAY_EVENT = 'lime-background-media-play';

const getSpotifyEmbedUrl = (url: string) => {
  return url.replace(
    /open\.spotify\.com\/(?:(?!track|album|playlist)[\w-]+\/)?/,
    'open.spotify.com/embed/'
  );
};

function SpotifyEmbed({ url }: SpotifyEmbedProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const embedUrl = useMemo(() => getSpotifyEmbedUrl(url), [url]);
  const mediaKey = useMemo(() => `spotify:${embedUrl}`, [embedUrl]);

  const notifyPlaying = () => {
    if (typeof window === 'undefined') return;

    window.dispatchEvent(new CustomEvent(SpotifyEmbedLIME_BACKGROUND_MEDIA_PLAY_EVENT, {
      detail: {
        key: mediaKey,
        kind: 'spotify',
        title: 'Spotify Player',
        element: iframeRef.current,
      },
    }));
  };

  useEffect(() => {
    const handleWindowBlur = () => {
      window.setTimeout(() => {
        if (document.activeElement === iframeRef.current) {
          notifyPlaying();
        }
      }, 0);
    };

    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [mediaKey]);

  return (
    <div className="mt-3 w-full overflow-hidden rounded-xl leading-[0] shadow-sm bg-[#282828]">
      <iframe
        ref={iframeRef}
        src={embedUrl}
        className="rounded-xl border-0 h-[80px] md:h-[152px]"
        style={{
          border: 0,
          width: '100%',
          minWidth: '100%',
          maxWidth: '100%',
          display: 'block',
          margin: 0,
          padding: 0,
        }}
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
        title="Spotify Player"
        onFocus={notifyPlaying}
      />
    </div>
  );
}

// PostCard
const PostLocationEditor = lazy(() => import("@/components/maps/LimeMap").then(module => ({default: module.PostLocationEditor})));

// --- 公開範囲 ---
// public    = 全体公開
// following = 限定公開（フォロー中のユーザー向け）
// members   = メンバー限定公開
// following と members は完全に別の公開範囲として扱う。
type PostVisibility = 'public' | 'following' | 'members';

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

type ProfileHoverTarget = 'avatar' | 'name' | null;

const formatDisplayCount = (count: number) => {
  if (count >= 10000) {
    return (count / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  }
  return count.toLocaleString();
};

type BlueskyPostFields = {
  source?: 'lime' | 'bluesky' | 'misskey' | 'x';
  blueskyUrl?: string;
  blueskyUri?: string;
};

const isBlueskyPostLike = (post: { id?: string; source?: string }) => (
  post.source === 'bluesky' || (String(post.id || '').startsWith('bsky:') || String(post.id || '').startsWith('misskey:') || /^x:\d+$/.test(String(post.id || '')))
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

const openExternalUrl = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

const POST_REACTION_CACHE_LIMIT = 36;
const IMAGE_NATURAL_SIZE_CACHE_LIMIT = 64;
const IMAGE_SIZE_PRELOAD_CONCURRENCY = 6;
const IMAGE_SIZE_PRELOAD_QUEUE_LIMIT = 24;
const IMAGE_SIZE_PRELOAD_POLL_MS = 16;
const IMAGE_SIZE_PRELOAD_TIMEOUT_MS = 5000;

const postReactionCache = new Map<string, ReactionGroup[]>();
const postReactionFetches = new Map<string, Promise<ReactionGroup[]>>();
const imageNaturalSizeCache = new Map<string, { width: number; height: number }>();

interface ImageSizePreloadTask {
  url: string;
  priority: 'high' | 'low';
  resolve: (size: { width: number; height: number } | null) => void;
}

const imageSizePreloadQueue: ImageSizePreloadTask[] = [];
const imageSizePreloadPending = new Map<string, Promise<{ width: number; height: number } | null>>();
const imageSizePreloadQueued = new Map<string, ImageSizePreloadTask>();
let activeImageSizePreloads = 0;

let customEmojiCache: CustomEmoji[] | null = null;
let customEmojiFetch: Promise<CustomEmoji[]> | null = null;
let currentUserIdCache: string | null | undefined;
let currentUserIdFetch: Promise<string | null> | null = null;

const spotifyUrlRegex = /https:\/\/open\.spotify\.com\/(?:[\w-]+\/)?(track|album|playlist)\/[a-zA-Z0-9._?=&/%-]+/gi;
const imageUrlRegex = /https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s]*)?|https?:\/\/pbs\.twimg\.com\/media\/[^\s?]+(?:\?[^\s]*)?/gi;
const youtubeUrlRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[^\s]*)?/gi;
const youtubeIdRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[^\s]*)?/i;

const extractYouTubeId = (content: string) => content.match(youtubeIdRegex)?.[1] || null;

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

const getPostImageUrlsForPreload = (post: PostWithAuthor) => {
  const contentImageUrls = post.content?.match(imageUrlRegex) || [];
  return [...(post.imageUrls || []), ...contentImageUrls].filter(url=>!!url&&!isDeferredPrivateMedia(url)).slice(0, 1);
};

const resolveImageNaturalSizeFromProbe = (image: HTMLImageElement) => {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
};

const pumpImageSizePreloadQueue = () => {
  while (activeImageSizePreloads < IMAGE_SIZE_PRELOAD_CONCURRENCY && imageSizePreloadQueue.length > 0) {
    imageSizePreloadQueue.sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'high' ? -1 : 1));
    const task = imageSizePreloadQueue.shift();
    if (!task) break;

    imageSizePreloadQueued.delete(task.url);
    activeImageSizePreloads += 1;

    const image = new Image();
    if(/^https:\/\/pbs[.]twimg[.]com\//.test(task.url))image.referrerPolicy='no-referrer';
    let settled = false;
    let pollTimer: number | null = null;
    let timeoutTimer: number | null = null;

    const cleanup = () => {
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
        pollTimer = null;
      }
      if (timeoutTimer !== null) {
        window.clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      image.onload = null;
      image.onerror = null;
      image.src = '';
    };

    const finish = (size: { width: number; height: number } | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      activeImageSizePreloads = Math.max(0, activeImageSizePreloads - 1);

      if (size) {
        setCachedNaturalSize(task.url, size);
      }

      task.resolve(size);

      window.setTimeout(() => {
        pumpImageSizePreloadQueue();
      }, 0);
    };

    const pollForDimensions = () => {
      if (settled) return;

      const size = resolveImageNaturalSizeFromProbe(image);
      if (size) {
        finish(size);
        return;
      }

      pollTimer = window.setTimeout(pollForDimensions, IMAGE_SIZE_PRELOAD_POLL_MS);
    };

    image.onload = () => {
      finish(resolveImageNaturalSizeFromProbe(image));
    };

    image.onerror = () => {
      finish(null);
    };

    timeoutTimer = window.setTimeout(() => {
      finish(resolveImageNaturalSizeFromProbe(image));
    }, IMAGE_SIZE_PRELOAD_TIMEOUT_MS);

    image.decoding = 'async';
    if ('fetchPriority' in image) {
      image.fetchPriority = task.priority;
    }

    image.src = task.url;
    pollForDimensions();
  }
};

const preloadImageNaturalSize = (url: string, priority: 'high' | 'low' = 'low') => {
  const cached = getCachedNaturalSize(url);
  if (cached) return Promise.resolve(cached);
  // Installed PWAs must not decode a second full-size image merely to measure it.
  // The visible image's onLoad supplies its dimensions.
  if(isInstalledPwa())return Promise.resolve(null);

  const pending = imageSizePreloadPending.get(url);
  if (pending) {
    const queued = imageSizePreloadQueued.get(url);
    if (queued && priority === 'high') queued.priority = 'high';
    return pending;
  }

  if (imageSizePreloadQueue.length >= IMAGE_SIZE_PRELOAD_QUEUE_LIMIT && priority === 'low') {
    return Promise.resolve(null);
  }

  const promise = new Promise<{ width: number; height: number } | null>((resolve) => {
    const task: ImageSizePreloadTask = { url, priority, resolve };
    imageSizePreloadQueued.set(url, task);
    imageSizePreloadQueue.push(task);
  }).finally(() => {
    imageSizePreloadPending.delete(url);
  });

  imageSizePreloadPending.set(url, promise);
  pumpImageSizePreloadQueue();
  return promise;
};

const preloadPostCardAssets = (
  post: PostWithAuthor,
  options?: { priority?: 'high' | 'low' }
) => {
  const imageUrls = getPostImageUrlsForPreload(post);
  if (imageUrls.length !== 1) return;

  const url = imageUrls[0];
  if (getCachedNaturalSize(url)) return;

  void preloadImageNaturalSize(url, options?.priority || 'low');
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

const preloadPostCardData = async (posts: PostWithAuthor[]) => {
  const warmupPosts = posts.slice(0, 12);
  if (!warmupPosts.length) return;

  warmupPosts.forEach((post, index) => {
    preloadPostCardAssets(post, { priority: index < 2 ? 'high' : 'low' });
  });

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

// ============================================================================
// --- パフォーマンス最適化用の共有リソース ---
// ============================================================================

const DEFAULT_EMOJIS = ['👍', '❤️', '😆', '🤔', '😮', '🎉', '💢', '😢', '😇', '🍮'];

const SINGLE_IMAGE_DISPLAY_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  position: 'absolute',
  inset: 0,
  objectFit: 'contain',
};

const POST_CARD_GLOBAL_STYLES_ID = 'postcard-global-styles';

const POST_CARD_GLOBAL_STYLES = `
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

        .timeline-glass-card .text-primary,
        .timeline-mobile-readable .text-primary {
          color: hsl(var(--timeline-link, var(--primary))) !important;
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

        .timeline-theme-dark .timeline-glass-card .text-primary,
        .timeline-theme-dark .timeline-mobile-readable .text-primary {
          color: hsl(var(--primary)) !important;
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

        .timeline-theme-light .timeline-glass-card .text-primary,
        .timeline-theme-light .timeline-mobile-readable .text-primary {
          color: hsl(var(--primary)) !important;
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
`;

function ensurePostCardStylesInjected() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(POST_CARD_GLOBAL_STYLES_ID)) return;

  const styleElement = document.createElement('style');
  styleElement.id = POST_CARD_GLOBAL_STYLES_ID;
  styleElement.textContent = POST_CARD_GLOBAL_STYLES;
  document.head.appendChild(styleElement);
}

function observeCardIntersection(element:Element,callback:(visible:boolean)=>void){
  return observeElementVisibility(element,callback,'420px 0px 520px 0px');
}

function PostCardComponent({ post, timelineGlass = false, thread = false, embedded = false, repostedByLabel = post.externalRepostedBy?.displayName, pinned = false, mediaPresentation, onMediaReply, onMediaLikeChange, mediaDownload,onNotInterested }: { post: PostWithAuthor; timelineGlass?: boolean; thread?: boolean; embedded?: boolean; repostedByLabel?: string; pinned?:boolean; mediaPresentation?: 'actions' | 'menu'; onMediaReply?: () => void; onMediaLikeChange?: (state:{liked:boolean;count:number})=>void; mediaDownload?:()=>void;onNotInterested?:(post:PostWithAuthor)=>Promise<void> }) {
  const [editLocationOpen,setEditLocationOpen] = useState(false);
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
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const navigate = useNavigate();
  const isBlueskyPost = isBlueskyPostLike(post);
  const blueskyPostUrl = getBlueskyPostUrl(post as { blueskyUrl?: string; author?: { username?: string }; id?: string });
  const blueskyProfileUrl = isBlueskyPost
    ? post.id.startsWith('x:') ? `https://x.com/${post.author.username.replace(/@(?:x|twitter)\.com$/, '')}` : post.id.startsWith('misskey:') ? `https://misskey.io/@${post.author.username.replace(/@misskey\.io$/, '')}` : `https://bsky.app/profile/${post.author.username}`
    : null;
  const blueskySession = useBlueskySession(post.id);
  const blueskyPostUri = isBlueskyPost ? getBlueskyUriFromPostId(post.id) : null;

  const [showPicker, setShowPicker] = useState(false);
  const offlineBookmark=useContext(OfflineBookmarkContext);
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([]);
  const [reactions, setReactions] = useState<ReactionGroup[]>([]);
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isEmojisOpen, setIsEmojisOpen] = useState(true);
  const [activePopupEmoji, setActivePopupEmoji] = useState<string | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  const [activeRings, setActiveRings] = useState<ReplicatedRing[]>([]);
  const [activeDots, setActiveDots] = useState<ReplicatedDot[]>([]);

  // 修正: useState(false) → lazy initializer に変更。
  // マウント直後の最初の描画から実際の画面幅を反映したレイアウトになるため、
  // 「新規マウント時に一瞬だけPC版が見えてしまう」二段階レンダーを防げる。
  const desktopLayout = useDesktopLayout();
  const isMobile = useViewportWidth(640);
  const pageVisible = usePageVisible();
  const useMobilePresentation = isMobile || desktopLayout;
  const timelinePortalTheme=useTimelinePortalTheme(timelineGlass);
  const singleImageGeometry = useRef<{url:string|null;size:{width:number;height:number}}>();
  const [isCardActive, setIsCardActive] = useState(false);

  const cardRootRef = useRef<HTMLElement>(null);
  // isMobileRef も isMobile と同じ初期値(実測値)に揃えておく。
  // ここが false 固定のままだと、初回の resize イベントで
  // 「実際は変化していないのに isMobileRef と実際の値がズレて見える」
  // 不整合の芽になるため、isMobile 側と同じ関数で初期化する。
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;
  const [profileHoverTarget, setProfileHoverTarget] = useState<ProfileHoverTarget>(null);
  const profileHoverOpenTimerRef = useRef<number | null>(null);
  const profileHoverCloseTimerRef = useRef<number | null>(null);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const pickerPanelRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuAnchorY=useRef<number|null>(null);
  useLayoutEffect(()=>{
    if(!showMenu||!moreMenuRef.current||!moreMenuPosition)return;
    const top=Math.max(8,Math.min(moreMenuPosition.top,window.innerHeight-moreMenuRef.current.offsetHeight-8));
    if(top!==moreMenuPosition.top)setMoreMenuPosition({...moreMenuPosition,top});
  },[showMenu,moreMenuPosition]);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const shareMenuRef = useRef<HTMLDivElement>(null);
  const limeDropPanelRef = useRef<HTMLDivElement>(null);
  const ignoreNextCardClickRef = useRef(false);
  const ignoreCardClickUntilRef = useRef(0);

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

  const clearProfileHoverOpenTimer = () => {
    if (profileHoverOpenTimerRef.current === null) return;
    window.clearTimeout(profileHoverOpenTimerRef.current);
    profileHoverOpenTimerRef.current = null;
  };

  const clearProfileHoverCloseTimer = () => {
    if (profileHoverCloseTimerRef.current === null) return;
    window.clearTimeout(profileHoverCloseTimerRef.current);
    profileHoverCloseTimerRef.current = null;
  };

  const openProfileHover = (target: Exclude<ProfileHoverTarget, null>) => {
    if (isMobileRef.current) return;

    clearProfileHoverCloseTimer();
    clearProfileHoverOpenTimer();

    profileHoverOpenTimerRef.current = window.setTimeout(() => {
      setProfileHoverTarget(target);
      profileHoverOpenTimerRef.current = null;
    }, 300);
  };

  const keepProfileHoverOpen = () => {
    clearProfileHoverCloseTimer();
  };

  const closeProfileHover = () => {
    clearProfileHoverOpenTimer();
    clearProfileHoverCloseTimer();

    profileHoverCloseTimerRef.current = window.setTimeout(() => {
      setProfileHoverTarget(null);
      profileHoverCloseTimerRef.current = null;
    }, 120);
  };

  const handleCardClickCapture = (e: React.MouseEvent<HTMLElement>) => {
    if (!shouldSuppressCardNavigation()) return;

    e.preventDefault();
    e.stopPropagation();
  };

  useLayoutEffect(() => {
    ensurePostCardStylesInjected();
  }, []);

  useEffect(() => (
    () => {
      clearProfileHoverOpenTimer();
      clearProfileHoverCloseTimer();
    }
  ), []);

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
    if (isBlueskyPost) {
      setReactions([]);
      setIsCardActive(false);
      return;
    }

    const cachedReactions = getCachedReactionGroups(post.id);
    setReactions(cachedReactions || []);
    setIsCardActive(false);
  }, [isBlueskyPost, post.id]);

  useEffect(() => {
    const node = cardRootRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setIsCardActive(true);
      return;
    }

    const unobserve = observeCardIntersection(node, (isIntersecting) => {
      setIsCardActive(isIntersecting);
    });

    return unobserve;
  }, [post.id]);

  useEffect(() => {
    const shouldKeepLiveWork = pageVisible && (!!mediaPresentation || isCardActive || showMenu || showPicker || showShareMenu || showLimeDropPanel);
    if (!shouldKeepLiveWork) return;
    if (isBlueskyPost) return;

    let cancelled = false;

    fetchReactions().then(() => undefined);
    fetchCustomEmojis().then(() => undefined);

    const channels = supabase
      .channel(`post-reactions-${post.id}-${randomUUID()}`)
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

    return () => {
      cancelled = true;
      supabase.removeChannel(channels);
    };
  }, [mediaPresentation, isBlueskyPost, isCardActive, showMenu, showPicker, showShareMenu, showLimeDropPanel, post.id, pageVisible]);

  useMinuteTick(!!mediaPresentation || isCardActive || showMenu || showPicker || showShareMenu || showLimeDropPanel);

  useEffect(() => {
    const shouldKeepStateWarm = !!mediaPresentation || isCardActive || showMenu || showPicker || showShareMenu || showLimeDropPanel;
    if (shouldKeepStateWarm) return;

    const timer = window.setTimeout(() => {
      setReactions([]);
      setCustomEmojis([]);
    }, 3000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [mediaPresentation, isCardActive, showMenu, showPicker, showShareMenu, showLimeDropPanel, post.id]);





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

    const closeOnViewportChange = (event:Event) => {
      if(event.type==='scroll'){
        if(event.target instanceof Node&&moreMenuRef.current?.contains(event.target))return;
        if(moreMenuAnchorY.current!==null&&Math.abs((moreButtonRef.current?.getBoundingClientRect().bottom??0)-moreMenuAnchorY.current)<1)return;
      }
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
    const nextCustomEmojis = offlineBookmark ? offlineBookmark.emojis.map(emoji=>({...emoji,uploaded_by:''})) : await ensureCustomEmojisCached();
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
    if (isBlueskyPost) return;
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
      return <PrivateMediaImage src={offlineBookmark?.media.get(imageUrl)??imageUrl} alt={customEmoji.name} className={className} />;
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
  const currentVisibility = (post.visibility || 'public') as PostVisibility;

  // メンバー機能を利用できるのは @cat / @LimeNote のみ。
  // 大文字小文字や先頭の @ の有無に左右されないよう正規化する。
  const normalizedAuthorUsername = post.author.username.trim().replace(/^@+/, '').toLowerCase();
  const canUseMembershipPosts = normalizedAuthorUsername === 'cat' || normalizedAuthorUsername === 'limenote';

  // メンバー限定投稿だけ、投稿者を対象に membership を確認する。
  // following（限定公開）とは完全に独立した判定。
  const { data: isMember } = useMembershipStatus(
    currentVisibility === 'members' && !isMyPost
      ? post.author.id
      : undefined
  );

  const isMembersOnlyPost = currentVisibility === 'members';
  const canViewMembersOnlyPost = !isMembersOnlyPost || isMyPost || isMember === true;
  const linkPreview=useLinkPreview(post.content,canViewMembersOnlyPost&&canShowPostLinkPreview(post,embedded),post.linkPreview,!isBlueskyPost,!isInstalledPwa()||pageVisible&&(!!mediaPresentation||isCardActive));
  const isCheckingMembersOnlyAccess = isMembersOnlyPost && !isMyPost && isMember === undefined;

  const { youtubeId, spotifyUrls, allImageUrls, displayContent, singleImageUrl } = useMemo(() => {
    const nextYoutubeId = hasAttachedPostVideo(post)?null:extractYouTubeId(post.content);
    const nextSpotifyUrls = post.content.match(spotifyUrlRegex) || [];
    const extractedImageUrls = post.content.match(imageUrlRegex) || [];

    // Blueskyの投稿にYouTubeリンクが含まれる場合、Bluesky側が生成する
    // 外部リンクカードのサムネイル画像が post.imageUrls に入ってくるため、
    // 何もしないと YouTube 埋め込み本体とサムネイル画像が二重に表示されてしまう。
    // YouTube の videoId が検出できた Bluesky 投稿では画像側を出さず、
    // 埋め込み本体（YouTubeEmbed）だけを表示する。
    const nextAllImageUrls = (isBlueskyPost && nextYoutubeId)
      ? []
      : [...(post.imageUrls || []).filter(url=>url!==post.linkPreview?.image&&url!==linkPreview.preview?.image), ...extractedImageUrls].slice(0, 4);

    const nextDisplayContent = post.content
      .replace(youtubeUrlRegex, nextYoutubeId?'':'$&')
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
  }, [post.content, post.imageUrls, isBlueskyPost,linkPreview.preview?.image,post.video,post.externalVideo]);

  // Snapshot geometry once per attachment. A late image load cannot move the timeline.
  if(singleImageGeometry.current?.url!==singleImageUrl){
    const index=post.imageUrls.indexOf(singleImageUrl??'');
    singleImageGeometry.current={url:singleImageUrl,size:initialMediaSize(post.imageDimensions?.[index]??(singleImageUrl?getCachedNaturalSize(singleImageUrl):null),singleImageUrl??undefined)};
  }
  const singleImageNaturalSize=singleImageGeometry.current!.size;

  const singleImageFrameStyle = initialImageFrame(singleImageNaturalSize,useMobilePresentation);

  const renderContentWithLinks = (text: string) => {
    if (!text) return null;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    return parts.map((part, index) => {
      if (part.match(urlRegex)) {
        return (
          <ContentLink
            key={`link-${index}`}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className={embedded ? "inline-block max-w-full truncate align-bottom text-primary hover:underline transition-colors" : "text-primary hover:underline transition-colors"}
            onClick={(e) => e.stopPropagation()}
          >
            {embedded ? (() => { const label = part.replace(/^https?:\/\//, ''); return label.length > 32 ? `${label.slice(0, 29)}…` : label; })() : part}
          </ContentLink>
        );
      }
      return part;
    });
  };

  const renderContentWithMentions = (text: string): React.ReactNode => {
    if (hasStickers(text)) return renderStickerText(text, renderContentWithMentions);
    if (!text) return null;
    const parts = splitMentionText(text);

    return parts.map((part, index) => {
      if (/^https?:\/\//.test(part)) return renderContentWithLinks(part);
      if (part.startsWith('@')) {
        const username = mentionProfileHandle(part,post.author);
        return (
          <Link
            key={`mention-${index}`}
            to={`/u/${username}`}
            className={embedded ? "inline-block max-w-full truncate align-bottom text-primary hover:underline transition-colors" : "text-primary hover:underline transition-colors"}
            onClick={(e) => e.stopPropagation()}
          >
            {embedded ? (() => { const label = part.replace(/^https?:\/\//, ''); return label.length > 32 ? `${label.slice(0, 29)}…` : label; })() : part}
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
            className="text-primary hover:underline transition-colors inline-block align-baseline"
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
    if (isBlueskyPost && post.id.startsWith('misskey:')) {
      if (blueskyPostUrl) openExternalUrl(blueskyPostUrl);
      setShowMenu(false);
      return;
    }
    navigate(`/post/${encodeURIComponent(post.id)}/activity`);
    setShowMenu(false);
  };

  const handleAuthorNavigate = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isBlueskyPost) return;
    e.preventDefault();
    navigate(`/u/${encodeURIComponent(post.author.username)}`);
  };

  const handleToggleVisibility = async (
    e: React.MouseEvent,
    targetVisibility: PostVisibility
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const visibilityMessages: Record<PostVisibility, string> = {
      public: 'この投稿を全体公開に切り替えますか？',
      following: 'この投稿を限定公開に切り替えますか？フォロー中のユーザーのみ表示されます。',
      members: 'この投稿をメンバー限定公開に切り替えますか？投稿者のメンバーのみ表示されます。',
    };

    if (!confirm(visibilityMessages[targetVisibility])) return;

    try {
      const { error } = await supabase
        .from('posts')
        .update({ visibility: targetVisibility })
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
    openMediaViewer({ url, post, offline: offlineBookmark, media: allImageUrls.map(src => ({ src })) });
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

    if (isMembersOnlyPost && !canViewMembersOnlyPost) {
      return;
    }

    if (isBlueskyPost) {
      navigate(`/post/${encodeURIComponent(post.id)}`);
      return;
    }

    navigate(`/post/${post.id}`);
  };

  const getPostShareUrl = () => {
    if (isBlueskyPost && blueskyPostUrl) {
      return blueskyPostUrl;
    }

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
      top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 160)),
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
        .eq('follower_id', currentUserId)
        .eq('approved', true);

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
            .eq('approved', true)
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

      await sendLimeDrop({
          sender_id: currentUserId,
          recipient_id: target.id,
          post_id: isBlueskyPost ? null : post.id,
          post_url: url,
          post_author_id: isBlueskyPost ? null : post.author.id,
          post_author_username: post.author.username,
          post_author_display_name: post.author.displayName,
          post_text: text,
          status: 'pending',
        }, supabase);

      setLimeDropFeedback(`${target.displayName}さんに送信しました`);
      window.setTimeout(() => {
        handleCloseLimeDropPanel();
        setLimeDropFeedback(null);
      }, 900);
    } catch (err) {
      const supabaseError = err as { message?: string; details?: string | null; hint?: string | null; code?: string } | null;
      console.error('Send LimeDrop failed:', {
        message: supabaseError?.message,
        details: supabaseError?.details,
        hint: supabaseError?.hint,
        code: supabaseError?.code,
        raw: err,
      });
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
      data-lime-profile-hover-card="true"
      side="bottom"
      align="start"
      className="w-[280px] rounded-[20px] border border-border/60 bg-card p-4 shadow-xl animate-in fade-in zoom-in duration-200 overflow-hidden"
      onClick={(event) => event.stopPropagation()}
      onMouseEnter={keepProfileHoverOpen}
      onMouseLeave={closeProfileHover}
    >
      <div className="flex justify-between items-start mb-3">
        <Avatar userId={post.author.id} className="h-14 w-14 border border-primary/5">
          <AvatarImage referrerPolicy={post.source==='x'?'no-referrer':undefined} src={post.author.avatarUrl} alt={post.author.displayName} />
          <AvatarFallback>{post.author.displayName.slice(0, 1)}</AvatarFallback>
        </Avatar>

        {currentUserId !== post.author.id && (!isBlueskyPost || blueskySession) && (
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
          {post.author.isPrivate && <PrivateAccountBadge />}
          <ProviderVerificationBadge verification={post.author.providerVerification} className="h-[1.1em] w-[1.1em] shrink-0 transform translate-y-[1px]"/>{post.author.isOfficial && (
            <PrivateMediaImage
              src={`${import.meta.env.BASE_URL}verified.png`}
              alt="Official"
              className="h-[1.1em] w-[1.1em] shrink-0 transform translate-y-[1px]"
            />
          )}
        </div>
        <p className="text-[15px] text-muted-foreground stroke-none">@{displayUsername(post.author.username)}</p>
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

      {!isBlueskyPost && <HoverStats userId={post.author.id} />}
    </HoverCardContent>
  );

  const timelinePortalThemeClass = timelineGlass
    ? `timeline-portal-picker timeline-portal-picker-${timelinePortalTheme}`
    : 'bg-white dark:bg-[#1e222b]';

  const postMenu = (<>                {!embedded && <div className="relative shrink-0">

                  <button
                    ref={moreButtonRef}
                    aria-label="ポストのメニュー"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();

                      if (showMenu) {
                        setShowMenu(false);
                        setMoreMenuPosition(null);
                        return;
                      }

                      const rect = e.currentTarget.getBoundingClientRect();
                      moreMenuAnchorY.current=rect.bottom;
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
                        data-lime-media-sheet-backdrop={mediaPresentation || undefined}
                        className="lime-post-options-backdrop fixed inset-0 bg-transparent"
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
                        data-lime-media-sheet={mediaPresentation ? 'menu' : undefined}
                        data-post-menu-os={mobilePostMenuOS()}
                        className="fixed lime-post-options rounded-xl bg-card shadow-lg overflow-hidden animate-in fade-in zoom-in duration-100"
                        style={{
                          top: moreMenuPosition?.top ?? 0,
                          right: moreMenuPosition?.right ?? 8,
                          maxHeight: 'calc(100dvh - 16px)', overflowY: 'auto',
                          zIndex: 2147483647,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {mediaPresentation && <button onClick={event => { event.stopPropagation(); setShowMenu(false); navigate(`/post/${encodeURIComponent(post.id)}`); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold hover:bg-muted"><LinkIcon className="h-4 w-4" />ポストに移動</button>}
                        {mediaDownload && <button onClick={(event)=>{event.stopPropagation();setShowMenu(false);mediaDownload();}} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold hover:bg-muted"><Download className="h-4 w-4" />画像を保存</button>}
                        <button
                          onClick={handleActivityClick}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted transition-colors"
                        >
                          <ChartBarBig className="h-4 w-4" />
                          {post.id.startsWith('misskey:') ? 'Misskeyで見る' : 'ポストアクティビティー'}
                        </button>

                        {onNotInterested&&<button onClick={async event=>{event.stopPropagation();try{await onNotInterested(post);setShowMenu(false);}catch{toast.error('興味なしを保存できませんでした');}}} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold hover:bg-muted"><EyeOff className="h-4 w-4" />興味なし</button>}
                        {isMyPost && !isBlueskyPost && !post.replyId && <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted" onClick={e=>{e.stopPropagation();setShowMenu(false);setEditLocationOpen(true);}}><Pencil className="h-4 w-4"/>編集</button>}
                        {isMyPost && !isBlueskyPost && !post.replyId && <PinPostMenuButton userId={post.userId} postId={post.id} onClose={()=>setShowMenu(false)}/>}
                        {isMyPost && !isBlueskyPost && !post.replyId && <HighlightPostMenuButton userId={post.userId} postId={post.id} onClose={()=>setShowMenu(false)}/>}
                        {isMyPost && currentVisibility !== 'public' && (
                          <button
                            onClick={(e) => handleToggleVisibility(e, 'public')}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted transition-colors"
                          >
                            <Globe className="h-4 w-4" />
                            全体公開にする
                          </button>
                        )}

                        {isMyPost && currentVisibility !== 'following' && (
                          <button
                            onClick={(e) => handleToggleVisibility(e, 'following')}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted transition-colors"
                          >
                            <Lock className="h-4 w-4" />
                            限定公開にする
                          </button>
                        )}

                        {isMyPost && canUseMembershipPosts && currentVisibility !== 'members' && (
                          <button
                            onClick={(e) => handleToggleVisibility(e, 'members')}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted transition-colors"
                          >
                            <Users className="h-4 w-4" />
                            メンバー限定公開にする
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
                </div>}</>);
  const postActions = (<>            {!embedded && canViewMembersOnlyPost && reactions.length > 0 && (
              <div data-lime-post-reactions className="mt-3 flex flex-wrap gap-1.5 relative" onClick={(e) => e.stopPropagation()}>
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
                                    @{displayUsername(u.username)}
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

            {!embedded&&!mediaPresentation&&<PostSourceLabel post={post} small={useMobilePresentation}/>}
            {!embedded && <div data-lime-post-actions className={useMobilePresentation ? "mt-2 flex items-center gap-1 text-muted-foreground relative h-8" : "mt-3 flex items-center gap-1 text-muted-foreground relative h-9"}>
              <div onClick={(e) => e.stopPropagation()} className="flex items-center h-full">
                {isBlueskyPost ? (
                  <ExternalLikeButton post={post} active={!!mediaPresentation || isCardActive} onChange={onMediaLikeChange}/>
                ) : (
                  <LikeButton live={!!mediaPresentation || isCardActive} initialLikedKnown={typeof post.likedByMe === 'boolean'} syncState={!!onMediaLikeChange} onChange={onMediaLikeChange}
                    postId={post.id}
                    preferencePost={post}
                    liked={post.likedByMe}
                    count={post.likesCount}
                  />
                )}
              </div>
              {(!isMembersOnlyPost || canViewMembersOnlyPost) && <RepostButton post={post} active={!!mediaPresentation || isCardActive} mobilePresentation={useMobilePresentation} />}
              {isBlueskyPost ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onMediaReply) onMediaReply(); else navigate(`/post/${encodeURIComponent(post.id)}`);
                  }}
                  className={useMobilePresentation ? "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] transition-colors hover:text-accent h-full" : "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors hover:text-accent h-full"}
                >
                  <MessageCircle className="h-5 w-5" />
                  <span className={useMobilePresentation ? "font-bold tabular-nums text-[15px]" : "font-bold tabular-nums text-sm"}>{(post.commentsCount) > 0 ? formatDisplayCount(post.commentsCount) : ''}</span>
                </button>
              ) : (
                <Link
                  to={`/post/${post.id}`}
                  aria-label="返信"
                  onClick={(e) => { e.stopPropagation(); if(onMediaReply){e.preventDefault();onMediaReply();} }}
                  className={useMobilePresentation ? "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] transition-colors hover:text-accent h-full" : "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors hover:text-accent h-full"}
                >
                  <MessageCircle className="h-5 w-5" />
                  <span className={useMobilePresentation ? "font-bold tabular-nums text-[15px]" : "font-bold tabular-nums text-sm"}>{(post.commentsCount) > 0 ? formatDisplayCount(post.commentsCount) : ''}</span>
                </Link>
              )}

              {!isBlueskyPost && <div className="relative inline-flex items-center h-full" onClick={(e) => e.stopPropagation()}>
                <button
                  ref={buttonRef}
                  aria-label="リアクションを追加"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowShareMenu(false);
                    setShareMenuPosition(null);
                    setShowMenu(false);
                    setMoreMenuPosition(null);
                    if (isBlueskyPost) {
                      if (blueskyPostUrl) openExternalUrl(blueskyPostUrl);
                      return;
                    }
                    if (isMembersOnlyPost && !canViewMembersOnlyPost) return;
                    setShowPicker(!showPicker);
                  }}
                  className={
                    useMobilePresentation
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
                    <div
                      ref={pickerPanelRef}
                      className={`fixed bottom-[76px] left-1/2 transform -translate-x-1/2 w-[92vw] max-w-[340px] h-[430px] rounded-[24px] border border-border/80 shadow-2xl p-4 animate-slide-up-mobile overflow-y-auto overflow-x-hidden touch-pan-y ${timelinePortalThemeClass}`}
                      style={{ zIndex: 2147483647 }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      onScroll={(e) => e.stopPropagation()}
                    >
                      <div className="grid grid-cols-5 gap-2.5 mb-3.5 shrink-0">
                        {DEFAULT_EMOJIS.map((emoji) => (
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
                    <div
                      ref={pickerPanelRef}
                      className={`absolute bottom-full left-0 mb-2 w-[260px] h-[280px] rounded-[20px] border border-border/80 shadow-2xl z-[100001] p-2.5 animate-zoom-in-pc overflow-y-auto overflow-x-hidden ${timelinePortalThemeClass}`}
                      onWheel={(e) => e.stopPropagation()}
                    >
                      <div className="grid grid-cols-7 gap-1 mb-2 shrink-0">
                        {DEFAULT_EMOJIS.map((emoji) => (
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

                      <div className="timeline-portal-divider mt-2 pt-1.5 border-t border-black/[0.08] dark:border-white/5 shrink-0">
                        <input
                          type="text"
                          placeholder="検索"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="timeline-portal-search w-full h-8 bg-black/[0.03] dark:bg-black/30 border border-black/[0.08] dark:border-white/10 rounded-lg px-2.5 text-xs font-medium text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>}

              <div className="relative ml-auto inline-flex items-center h-full shrink-0" onClick={(e) => e.stopPropagation()}>
                <BookmarkButton post={post} />
                <button
                  ref={shareButtonRef}
                  onClick={handleShareButtonClick}
                  aria-label="ポストを共有"
                  className={
                    useMobilePresentation
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
                      data-lime-media-sheet-backdrop={mediaPresentation || undefined}
                      className="lime-post-action-sheet-backdrop-mobile fixed inset-0 bg-transparent"
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
                      data-lime-media-sheet={mediaPresentation ? 'share' : undefined}
                      className="lime-post-share-menu fixed w-[min(calc(100vw-16px),16rem)] rounded-xl border border-border bg-card p-1 shadow-lg overflow-hidden animate-in fade-in zoom-in duration-100"
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
            </div>}</>);

  return (
    <>
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

      {mediaPresentation ? <article ref={cardRootRef} data-lime-media-post-actions={mediaPresentation} className="relative w-full">{mediaPresentation === 'menu' ? postMenu : postActions}</article> : <article
        data-lime-post-card
        data-lime-thread-item={thread && !embedded || undefined}
        data-lime-embedded={embedded || undefined}
        style={embedded ? { width: '100%', maxWidth: '100%', margin: 0 } : undefined}
        ref={cardRootRef}
        onClickCapture={handleCardClickCapture}
        onClick={handleCardClick}
        className={
          embedded ? "relative w-full cursor-pointer" : timelineGlass
            ? useMobilePresentation
              ? "timeline-mobile-readable px-5 py-4 cursor-pointer"
              : "timeline-glass-card rounded-3xl p-5 transition relative cursor-pointer"
            : useMobilePresentation
              ? "relative mx-auto w-full max-w-[600px] px-0 py-3 cursor-pointer"
              : "rounded-3xl border border-border/60 bg-card p-5 shadow-soft transition hover:shadow-card-soft relative cursor-pointer"
        }
      >
        {isMobile && !timelineGlass && !thread && (
          <div data-lime-post-divider className="pointer-events-none absolute bottom-0 left-1/2 w-screen -translate-x-1/2 border-b border-border/60" />
        )}

        {pinned && !embedded && <div data-lime-pinned-label className="mb-1 flex items-center gap-3 text-sm font-semibold text-muted-foreground"><span className="inline-flex w-11 shrink-0 justify-end"><Pin className="h-4 w-4" fill="currentColor"/></span><span>固定</span></div>}
        {repostedByLabel && !embedded && (
          <div data-lime-repost-label className="mb-1 flex items-center gap-3 text-sm font-semibold text-muted-foreground">
            <span className="inline-flex w-11 shrink-0 justify-end"><RepostIcon className="h-4 w-4" /></span>
            <span>{repostedByLabel}がリポストしました</span>
          </div>
        )}
        <div data-lime-post-layout className="flex items-start gap-3">
          <HoverCard open={profileHoverTarget === 'avatar'} openDelay={300}>
            <HoverCardTrigger asChild>
              <Link
                to={`/u/${post.author.username}`}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center"
                data-lime-thread-avatar={thread && !embedded || undefined}
                data-lime-post-avatar
                onMouseEnter={() => openProfileHover('avatar')}
                onMouseLeave={closeProfileHover}
                onFocus={() => openProfileHover('avatar')}
                onBlur={closeProfileHover}
                onClick={handleAuthorNavigate}
              >
                <Avatar userId={post.author.id} className="h-11 w-11 translate-y-1">
                  <AvatarImage referrerPolicy={post.source==='x'?'no-referrer':undefined} src={post.author.avatarUrl} alt={post.author.displayName} />
                  <AvatarFallback>{post.author.displayName.slice(0, 1)}</AvatarFallback>
                </Avatar>
              </Link>
            </HoverCardTrigger>
            <ProfileHoverContent />
          </HoverCard>

          <div data-lime-post-content className="min-w-0 flex-1">
            <div data-lime-post-header className="flex items-center justify-between mb-1">
              <div className="flex items-center w-full min-w-0">
                <HoverCard open={profileHoverTarget === 'name'} openDelay={300}>
                  <HoverCardTrigger asChild>
                    <Link
                      to={`/u/${post.author.username}`}
                      className="inline-flex w-fit max-w-full shrink-0 items-center font-display font-bold text-foreground hover:underline"
                      onMouseEnter={() => openProfileHover('name')}
                      onMouseLeave={closeProfileHover}
                      onFocus={() => openProfileHover('name')}
                      onBlur={closeProfileHover}
                      onClick={handleAuthorNavigate}
                    >
                      <div className="inline-flex w-fit max-w-full items-center gap-0.5">
                        <span className={useMobilePresentation ? "truncate text-[16px]" : "truncate text-base"}>
                          {post.author.displayName}
                        </span>
                        {post.author.isPrivate && <PrivateAccountBadge />}
          <ProviderVerificationBadge verification={post.author.providerVerification} className="h-4 w-4 shrink-0 transform translate-y-[0.5px]"/>{post.author.isOfficial && (
                          <PrivateMediaImage
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

                <span className={useMobilePresentation ? "truncate text-[16px] text-muted-foreground ml-1 opacity-80 shrink" : "truncate text-base text-muted-foreground ml-1 opacity-80 shrink"}>
                  @{displayUsername(post.author.username)}
                </span>

                <span className="text-muted-foreground mx-1 shrink-0">·</span>
                <span className={useMobilePresentation ? "text-[16px] text-muted-foreground whitespace-nowrap shrink-0" : "text-sm text-muted-foreground whitespace-nowrap shrink-0"}>
                  {formatRelative(post.createdAt)}
                </span>
              </div>

              <div className="flex items-center shrink-0 ml-2">
                {currentVisibility === 'following' && (
                  <span className={useMobilePresentation ? "text-[13px] font-bold text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-md whitespace-nowrap mr-1" : "text-[14px] font-bold text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-md whitespace-nowrap mr-1"}>
                    限定
                  </span>
                )}
                {currentVisibility === 'members' && (
                  <span className={useMobilePresentation ? "text-[13px] font-bold text-violet-600 dark:text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded-md whitespace-nowrap mr-1" : "text-[14px] font-bold text-violet-600 dark:text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded-md whitespace-nowrap mr-1"}>
                    メンバー限定
                  </span>
                )}

                {postMenu}
              </div>
            </div>

            <div data-lime-post-body data-lime-post-has-images={allImageUrls.length > 0 || !!post.video || !!post.externalVideo || undefined}>
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  if (shouldSuppressCardNavigation()) return;
                  if (isMembersOnlyPost && !canViewMembersOnlyPost) return;
                  if (isBlueskyPost) {
                    navigate(`/post/${encodeURIComponent(post.id)}`);
                  } else {
                    navigate(`/post/${post.id}`);
                  }
                }}
              >
                {isCheckingMembersOnlyAccess ? (
                  <div className="mt-3 rounded-2xl border border-violet-500/20 bg-violet-500/[0.06] px-4 py-5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-violet-500">
                        <Lock className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-black text-foreground">メンバー限定投稿</p>
                        <p className="mt-1 text-xs text-muted-foreground">閲覧権限を確認しています…</p>
                      </div>
                    </div>
                  </div>
                ) : isMembersOnlyPost && !canViewMembersOnlyPost ? (
                  <div className="mt-3 rounded-2xl border border-violet-500/20 bg-violet-500/[0.06] px-4 py-5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-violet-500">
                        <Lock className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-foreground">メンバー限定投稿</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          この投稿は @{displayUsername(post.author.username)} のメンバーだけが閲覧できます。
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <SpacePostCard content={post.content || ''} />
                    {(linkPreview.text(spaceLinkIn(displayContent || '')?.text ?? displayContent)) && (
                      <p className={useMobilePresentation ? "whitespace-pre-wrap break-words text-[16px] leading-normal text-foreground mt-1" : "whitespace-pre-wrap break-words text-base leading-relaxed text-foreground mt-1"}>
                        {renderContentWithMentions(linkPreview.text(spaceLinkIn(displayContent || '')?.text ?? displayContent))}
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
                  </>
                )}
              </div>

              {canViewMembersOnlyPost && ((post as any).is_bot || post.isBot) && (
                <div className="flex items-center gap-1 mt-1.5 text-muted-foreground/70">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span className={useMobilePresentation ? "text-[13px] font-medium" : "text-[15px] font-medium"}>AIで生成</span>
                </div>
              )}

              {canViewMembersOnlyPost && <LinkPreviewCard {...linkPreview} />}
              {canViewMembersOnlyPost && youtubeId && (
                <div onClick={(e) => e.stopPropagation()} className="mt-3">
                  <YouTubeEmbed videoId={youtubeId} />
                </div>
              )}

              {canViewMembersOnlyPost && spotifyUrls.length > 0 && (
                <div onClick={(e) => e.stopPropagation()} className="space-y-2 mt-3">
                  {spotifyUrls.map((url, idx) => (
                    <SpotifyEmbed key={`spotify-${idx}`} url={url} />
                  ))}
                </div>
              )}

              {canViewMembersOnlyPost && (singleImageUrl ? (
                <div data-lime-post-images={allImageUrls.length>0||undefined} className="mt-3 flex max-w-full justify-start" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="relative block max-w-full cursor-zoom-in overflow-hidden rounded-2xl border border-border/60 bg-background text-left shadow-none"
                    key={singleImageUrl}
                    data-lime-single-post-image
                    data-lime-media-fallback={singleImageNaturalSize.width===16&&singleImageNaturalSize.height===9||undefined}
                    style={{...singleImageFrameStyle,aspectRatio:`${singleImageNaturalSize.width}/${singleImageNaturalSize.height}`}}
                    onClick={(e) => handleImageClick(e, singleImageUrl)}
                    aria-label="画像を拡大表示"
                  >
                    <PrivateMediaImage
                      data-lime-media-loading-frame
                      referrerPolicy={post.source==='x'?'no-referrer':undefined} src={singleImageUrl}
                      alt={post.imageAltTexts?.[0]||"投稿画像"}
                      className="block select-none"
                      style={SINGLE_IMAGE_DISPLAY_STYLE}
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

                        }
                      }}
                      onError={event => { event.currentTarget.style.opacity='0'; }}
                    />
                  </button>
                </div>
              ) : (
                <div
                  data-lime-post-images={allImageUrls.length>0||undefined}
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
                    altTexts={post.imageAltTexts}
                    urls={allImageUrls}
                    embedded={embedded}
                    onImageError={(url) => {
                      if (!failedUrls.includes(url)) {
                        setFailedUrls(prev => [...prev, url]);
                      }
                    }}
                  />
                </div>
              ))}
            </div>

            {(post.video || post.externalVideo) && <PostVideoPlayer embedded={embedded} postId={post.id} video={(post.video || post.externalVideo)!} externalVideo={post.externalVideo} post={post}/>}
            {post.poll && <PostPoll post={post}/>}
            <ExternalPostDetails post={post}/>

            {post.isQuote && <QuotedPost post={post.parentPost} timelineGlass={timelineGlass} />}

            {postActions}
          </div>
        </div>
      </article>}

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
                          @{displayUsername(target.username)}
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
      {editLocationOpen && <Suspense fallback={null}><PostLocationEditor post={post} onClose={()=>setEditLocationOpen(false)}/></Suspense>}
    </>
  );
}

const PostCard = memo(function PostCard(props: Parameters<typeof PostCardComponent>[0]) {
  if (props.post.externalReplyToId && !props.mediaPresentation) return <ExternalReplyCard post={props.post} thread={props.thread} embedded={props.embedded} repostedByLabel={props.repostedByLabel??props.post.externalRepostedBy?.displayName} />;
  return <PostCardComponent {...props} />;
});
PostCard.displayName = 'PostCard';

export { preloadPostCardAssets };
export { preloadPostCardData };
export { PostCard };
export { YouTubeEmbed };
export { SpotifyEmbed };
