import { registerPwa } from '@/lib/registerPwa';
import { startFriendCloudSync } from "@/lib/aiFriends";
import { useSnowEffect } from "@/components/ui/button";
import { AccountSuspensionFeedback, PostOverlay, AppLayout } from "@/components/layout/AppLayout";
import { PostOverlayContext } from "@/components/layout/DesktopLayoutContext";
import { ComposerIcon, PostCardSkeleton } from "@/components/feed/PostPoll";
import { installPwaMemoryManagement, pwaQueryGcTime, cn, shouldRetryRead } from "@/lib/utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, Component } from "react";
import { createPortal } from "react-dom";
import { SonnerToaster as Sonner, Toaster, TooltipProvider } from "@/components/ui/button";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ThemeProvider } from "next-themes";
import { useOSNotification } from "@/hooks/useOSNotification";
import Feed from "@/pages/Feed";
import { SpaceProvider } from "@/components/spaces/SpaceProvider";
import { X, PenSquare } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { type PostWithAuthor } from "@/types/index";
import { supabase, type AccountReadContext } from "@/lib/supabase";
import { useScrollDirection } from "@/hooks/useViewportWidth";
import { OfflineBookmarkContext } from "@/components/feed/QuotedPost";
import { MEDIA_VIEWER_EVENT, type MediaViewerSelection } from "@/lib/mediaThumbnail";
import { toast } from "sonner";

// App
export {PostOverlay,PostComposer} from "@/components/layout/AppLayout";


const AuthPage = lazy(() => import("./pages/Auth"));

const Bookmarks = lazy(() => import("./pages/Bookmarks"));
const Lists = lazy(() => import("@/pages/Bookmarks").then(module => ({default: module.Lists})));
const Topics = lazy(() => import("./pages/Topics"));
const PostDetail = lazy(() => import("./pages/PostDetail"));
const Profile = lazy(() => import("./pages/Profile"));
const Settings = lazy(() => import("./pages/Settings"));
const SearchPage = lazy(() => import("./pages/SearchPage"));
const DirectMessages = lazy(() => import("./pages/DirectMessages"));
const PostActivity = lazy(() => import("@/pages/PostDetail").then(module => ({default: module.PostActivity})));
const Share = lazy(() => import("@/pages/PostDetail").then(module => ({default: module.Share})));
const NotFound = lazy(() => import("@/pages/Topics").then(module => ({default: module.NotFound})));
const Notifications = lazy(() => import("@/pages/Topics").then(module => ({default: module.Notifications})));
const WatchHistory = lazy(() => import("./pages/WatchHistory"));
const AccountAboutPage = lazy(() => import("@/pages/Profile").then(module => ({default: module.AccountAboutPage})));
const FollowersFollowingPage = lazy(() => import("@/pages/Bookmarks").then(module => ({default: module.FollowersFollowingPage})));
const SpacePage = lazy(() => import("@/components/spaces/SpaceProvider").then(module => ({default: module.SpacePage})));

const Communities = lazy(() => import("./pages/Communities"));
const LimeMaps = lazy(() => import("./pages/LimeMaps"));
const NewsPage = lazy(() => import("@/pages/Topics").then(module => ({default: module.NewsPage})));
const TermsPage = lazy(() => import("./pages/terms"));
const LimeProLanding = lazy(() => import("./pages/LimePro"));
const MediaViewer = lazy(() => import("./pages/MediaViewer"));


function RouteLoading() {
  return <div role="status" aria-label="読み込み中"><PostCardSkeleton /><PostCardSkeleton /><PostCardSkeleton /></div>;
}

// PostComposer 用のインポート群


// --- モバイル幅判定フック ---
// Tailwind の `md:` ブレークポイント(768px)と合わせている。
// iPhoneのPWA(ホーム画面追加)やChromeのモバイルサイズ表示でも確実に検知できるよう、
// CSSのメディアクエリ判定(matchMedia)をJS側でも持たせる。
const ScrollToTop = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    if (window.matchMedia('(min-width: 768px)').matches) window.scrollTo(0, 0);
    else window.scrollTo(350, 350);
  }, [pathname]);
  return null;
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 60,
      refetchOnWindowFocus: false,
      gcTime:pwaQueryGcTime(),
      retry: shouldRetryRead,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
  },
});


type BackgroundMediaKind = 'youtube' | 'spotify';

interface BackgroundMediaItem {
  key: string;
  kind: BackgroundMediaKind;
  title: string;
  element?: HTMLIFrameElement | null;
}

declare global {
  interface Window {
    __limeBackgroundMediaActiveKey?: string | null;
  }
}

const LIME_BACKGROUND_MEDIA_PLAY_EVENT = 'lime-background-media-play';
const LIME_BACKGROUND_MEDIA_STOP_EVENT = 'lime-background-media-stop';
const LIME_BACKGROUND_MEDIA_ACTIVE_CHANGED_EVENT = 'lime-background-media-active-changed';

type NavigatorWithAudioSession = Navigator & {
  audioSession?: {
    type?: string;
  };
};

const configurePlaybackAudioSession = () => {
  if (typeof navigator === 'undefined') return;

  try {
    const audioSession = (navigator as NavigatorWithAudioSession).audioSession;

    if (audioSession && 'type' in audioSession && audioSession.type !== 'playback' && audioSession.type !== 'play-and-record') {
      audioSession.type = 'playback';
    }
  } catch (error) {
    console.warn('Audio Session API setup failed:', error);
  }
};

export function BackgroundMediaRoot({ children }: { children: ReactNode }) {
  const [activeMedia, setActiveMedia] = useState<BackgroundMediaItem | null>(null);
  const activeMediaRef = useRef<BackgroundMediaItem | null>(null);

  useEffect(() => {
    activeMediaRef.current = activeMedia;

    const activeKey = activeMedia?.key ?? null;
    window.__limeBackgroundMediaActiveKey = activeKey;
    window.dispatchEvent(new CustomEvent(LIME_BACKGROUND_MEDIA_ACTIVE_CHANGED_EVENT, {
      detail: { key: activeKey },
    }));
  }, [activeMedia]);

  useEffect(() => {
    const handlePlay = (event: Event) => {
      const detail = (event as CustomEvent<BackgroundMediaItem>).detail;
      if (!detail?.key || !detail?.kind || !detail?.title) return;

      // The cross-origin YouTube player owns its audio and Media Session.
      // Claiming another session in this document can interrupt that output.
      if (detail.kind !== 'youtube') configurePlaybackAudioSession();
      activeMediaRef.current = detail;
      setActiveMedia(detail);

    };

    const handleStop = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      const current = activeMediaRef.current;

      if (!current) return;
      if (detail?.key && detail.key !== current.key) return;

      activeMediaRef.current = null;
      setActiveMedia(null);
    };

    window.addEventListener(LIME_BACKGROUND_MEDIA_PLAY_EVENT, handlePlay as EventListener);
    window.addEventListener(LIME_BACKGROUND_MEDIA_STOP_EVENT, handleStop as EventListener);

    return () => {
      window.removeEventListener(LIME_BACKGROUND_MEDIA_PLAY_EVENT, handlePlay as EventListener);
      window.removeEventListener(LIME_BACKGROUND_MEDIA_STOP_EVENT, handleStop as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!activeMedia || activeMedia.kind === 'youtube') return;

    const mediaSession = typeof navigator !== 'undefined'
      ? (navigator as any).mediaSession
      : undefined;
    const MediaMetadataConstructor = typeof window !== 'undefined'
      ? (window as any).MediaMetadata
      : undefined;

    if (!mediaSession || !MediaMetadataConstructor) return;

    try {
      mediaSession.metadata = new MediaMetadataConstructor({
        title: activeMedia.title,
        artist: 'Spotify',
        album: 'LimeNote SNS',
      });
      mediaSession.playbackState = 'playing';

      mediaSession.setActionHandler?.('play', () => {
        configurePlaybackAudioSession();
        mediaSession.playbackState = 'playing';
      });

      mediaSession.setActionHandler?.('pause', () => {
        mediaSession.playbackState = 'paused';
      });

      mediaSession.setActionHandler?.('stop', () => {
        setActiveMedia(null);
      });
    } catch (error) {
      console.error('Media Session metadata failed:', error);
    }

    return () => {
      try {
        mediaSession.metadata = null;
        mediaSession.playbackState = 'none';
        mediaSession.setActionHandler?.('play', null);
        mediaSession.setActionHandler?.('pause', null);
        mediaSession.setActionHandler?.('stop', null);
      } catch {
        // noop
      }
    };
  }, [activeMedia]);

  useEffect(() => {
    if (!activeMedia || activeMedia.kind === 'youtube') return;

    const keepPlaybackSessionAlive = () => {
      const current = activeMediaRef.current;
      if (!current || current.kind === 'youtube') return;

      configurePlaybackAudioSession();

    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        keepPlaybackSessionAlive();
      }
    };

    window.addEventListener('pageshow', keepPlaybackSessionAlive);
    window.addEventListener('focus', keepPlaybackSessionAlive);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pageshow', keepPlaybackSessionAlive);
      window.removeEventListener('focus', keepPlaybackSessionAlive);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeMedia?.key]);

  return <>{children}</>;
}

const AccountOverlayReset = ({ onReset }: { onReset: () => void }) => {
  const { user } = useAuth();
  useLayoutEffect(() => { onReset(); }, [user?.id, onReset]);
  return null;
};

const NotificationWatcher = () => {
  const { user } = useAuth();
  useOSNotification(user?.id ?? null);
  return null;
};

interface IncomingLimeDrop {
  id: string;
  sender_id: string;
  recipient_id: string;
  post_id: string | null;
  post_url: string;
  post_author_display_name: string | null;
  post_author_username: string | null;
  post_text: string | null;
  created_at: string;
  sender?: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
  };
}

export const LimeDropReceiver = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [drops, setDrops] = useState<IncomingLimeDrop[]>([]);
  const [busyDropId, setBusyDropId] = useState<string | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const swipeStartYRef = useRef<number | null>(null);
  const reloadDropsRef = useRef<() => void>(() => {});

  const attachSenderProfiles = async (rows: any[]): Promise<IncomingLimeDrop[]> => {
    if (rows.length === 0) return [];

    const senderIds = Array.from(
      new Set(
        rows
          .map((row) => row.sender_id)
          .filter(Boolean)
      )
    );

    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .in('id', senderIds);

    if (error) {
      console.error('Fetch LimeDrop sender profiles failed:', error);
    }

    const profileMap = new Map(
      (profiles || []).map((profile: any) => [
        profile.id,
        {
          id: profile.id,
          username: profile.username || 'unknown',
          displayName: profile.display_name || profile.username || 'ユーザー',
          avatarUrl: profile.avatar_url || '',
        },
      ])
    );

    return rows.map((row) => ({
      id: row.id,
      sender_id: row.sender_id,
      recipient_id: row.recipient_id,
      post_id: row.post_id,
      post_url: row.post_url,
      post_author_display_name: row.post_author_display_name,
      post_author_username: row.post_author_username,
      post_text: row.post_text,
      created_at: row.created_at,
      sender: profileMap.get(row.sender_id),
    }));
  };

  useEffect(() => {
    if (!user?.id) {
      setDrops([]);
      return;
    }

    let cancelled = false;
    let loading = false;
    let requested = false;
    setDrops([]);
    setBusyDropId(null);
    setSwipeOffset(0);

    // One snapshot at a time. Events received during a query invalidate its result
    // and request a fresh snapshot, so an old response cannot resurrect handled drops.
    const loadPendingDrops = async () => {
      requested = true;
      if (loading) return;
      loading = true;
      try {
        while (requested && !cancelled) {
          requested = false;
          const { data, error } = await supabase
            .from('lime_drops')
            .select('id, sender_id, recipient_id, post_id, post_url, post_author_display_name, post_author_username, post_text, created_at, status')
            .eq('recipient_id', user.id)
            .eq('status', 'pending')
            .order('created_at', { ascending: true })
            .limit(5);
          if (cancelled) return;
          if (error) {
            console.error('Fetch pending LimeDrops failed:', error);
            break;
          }
          const hydrated = await attachSenderProfiles(data || []);
          if (!cancelled && !requested) setDrops(hydrated);
        }
      } catch (error) {
        console.error('Fetch pending LimeDrops failed:', error);
      } finally {
        loading = false;
      }
    };
    reloadDropsRef.current = loadPendingDrops;
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'hidden') void loadPendingDrops();
    };
    void loadPendingDrops();
    const channel = supabase
      .channel(`lime-drop-receiver-${user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'lime_drops',
        filter: `recipient_id=eq.${user.id}`,
      }, () => { void loadPendingDrops(); })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void loadPendingDrops();
      });
    // Recover deliveries missed while offline/backgrounded without periodic polling.
    window.addEventListener('online', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      cancelled = true;
      reloadDropsRef.current = () => {};
      window.removeEventListener('online', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const activeDrop = drops[0];

  const removeDrop = (dropId: string) => {
    setDrops((prev) => prev.filter((drop) => drop.id !== dropId));
    reloadDropsRef.current();
  };

  const declineDrop = async () => {
    if (!activeDrop || busyDropId) return;

    setSwipeOffset(0);
    setBusyDropId(activeDrop.id);
    try {
      const { error } = await supabase
        .from('lime_drops')
        .update({ status: 'declined' })
        .eq('id', activeDrop.id)
        .eq('recipient_id', user?.id);

      if (error) throw error;
      removeDrop(activeDrop.id);
    } catch (error) {
      console.error('Decline LimeDrop failed:', error);
    } finally {
      setBusyDropId(null);
    }
  };

  const acceptDrop = async () => {
    if (!activeDrop || busyDropId) return;

    setSwipeOffset(0);
    setBusyDropId(activeDrop.id);
    try {
      const { error } = await supabase
        .from('lime_drops')
        .update({ status: 'accepted' })
        .eq('id', activeDrop.id)
        .eq('recipient_id', user?.id);

      if (error) throw error;
      removeDrop(activeDrop.id);

      if (activeDrop.post_url) {
        const url = new URL(activeDrop.post_url, window.location.href);
        if (url.origin === window.location.origin) {
          const base = import.meta.env.BASE_URL.replace(/\/$/, '');
          const path = base && url.pathname.startsWith(`${base}/`) ? url.pathname.slice(base.length) : url.pathname;
          navigate(`${path}${url.search}${url.hash}`);
        } else if (url.protocol === 'https:' || url.protocol === 'http:') {
          window.location.assign(url.href);
        }
      } else if (activeDrop.post_id) {
        navigate(`/post/${activeDrop.post_id}`);
      }
    } catch (error) {
      console.error('Accept LimeDrop failed:', error);
    } finally {
      setBusyDropId(null);
    }
  };

  const handleLimeDropTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    swipeStartYRef.current = event.touches[0]?.clientY ?? null;
  };

  const handleLimeDropTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (swipeStartYRef.current === null || busyDropId) return;

    const currentY = event.touches[0]?.clientY ?? swipeStartYRef.current;
    const deltaY = currentY - swipeStartYRef.current;

    if (deltaY < 0) {
      setSwipeOffset(Math.max(deltaY, -96));
    }
  };

  const handleLimeDropTouchEnd = () => {
    if (swipeOffset <= -48) {
      declineDrop();
    } else {
      setSwipeOffset(0);
    }

    swipeStartYRef.current = null;
  };

  if (!activeDrop || typeof document === 'undefined') return null;

  const senderName = activeDrop.sender?.displayName || 'ユーザー';
  const senderUsername = activeDrop.sender?.username || 'unknown';
  const postAuthorName = activeDrop.post_author_display_name || activeDrop.post_author_username || 'ポスト';
  const postText = activeDrop.post_text || `${postAuthorName}さんのポスト`;
  const isBusy = busyDropId === activeDrop.id;

  return createPortal(
    <>
      <style>{`
        @keyframes limedrop-pop-in {
          0% {
            opacity: 0;
            transform: translate3d(0, -18px, 0) scale(0.94);
            filter: blur(6px);
          }
          62% {
            opacity: 1;
            transform: translate3d(0, 3px, 0) scale(1.01);
            filter: blur(0);
          }
          100% {
            opacity: 1;
            transform: translate3d(0, 0, 0) scale(1);
            filter: blur(0);
          }
        }

        @keyframes limedrop-signal-pulse {
          0% {
            transform: scale(0.72);
            opacity: 0.85;
          }
          70% {
            transform: scale(1.65);
            opacity: 0;
          }
          100% {
            transform: scale(1.65);
            opacity: 0;
          }
        }
      `}</style>

      <div className="pointer-events-none fixed inset-x-0 top-0 z-[2147483647] px-4 pt-[max(10px,env(safe-area-inset-top))] md:inset-x-auto md:right-5 md:w-[372px] md:px-0 md:pt-5">
        <div className="mx-auto w-full max-w-[430px] md:mx-0 md:max-w-none">
          <div
            className="pointer-events-auto overflow-hidden rounded-[24px] border border-white/45 bg-white/76 text-zinc-950 shadow-[0_18px_56px_rgba(0,0,0,0.24)] backdrop-blur-2xl transition-transform duration-200 dark:border-white/10 dark:bg-zinc-950/76 dark:text-white md:rounded-[22px]"
            style={{
              animation: 'limedrop-pop-in 420ms cubic-bezier(0.16, 1, 0.3, 1)',
              transform: swipeOffset < 0 ? `translate3d(0, ${swipeOffset}px, 0) scale(${Math.max(0.96, 1 + swipeOffset / 900)})` : undefined,
            }}
            onTouchStart={handleLimeDropTouchStart}
            onTouchMove={handleLimeDropTouchMove}
            onTouchEnd={handleLimeDropTouchEnd}
            onTouchCancel={handleLimeDropTouchEnd}
          >
            <div className="md:hidden">
              <div className="flex items-start gap-3 px-3.5 pb-2.5 pt-3.5">
                <div className="relative shrink-0">
                  <Avatar className="h-10 w-10 border border-white/60 shadow-sm">
                    <AvatarImage src={activeDrop.sender?.avatarUrl} alt={senderName} />
                    <AvatarFallback>{senderName.slice(0, 1)}</AvatarFallback>
                  </Avatar>
                  <div className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                    <ComposerIcon kind="send" className="h-2.5 w-2.5" />
                  </div>
                  <span className="absolute inset-0 rounded-full border-2 border-primary/40" style={{ animation: 'limedrop-signal-pulse 1.6s ease-out infinite' }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-black text-zinc-700 dark:text-zinc-300">LimeDrop</div>
                  <div className="mt-0.5 text-[15px] font-black leading-tight text-zinc-950 dark:text-white">
                    {senderName}さんがポストを共有しようとしています
                  </div>
                  <div className="mt-1 line-clamp-1 text-[12px] font-medium leading-snug text-zinc-700 dark:text-zinc-300">
                    {postText}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={declineDrop}
                  disabled={isBusy}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/60 text-zinc-900 transition hover:bg-white/80 disabled:opacity-60 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
                  aria-label="LimeDropを閉じる"
                >
                  <X className="h-[18px] w-[18px]" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 border-t border-black/5 p-2.5 dark:border-white/10">
                <button
                  type="button"
                  onClick={declineDrop}
                  disabled={isBusy}
                  className="h-10 rounded-xl bg-zinc-200/70 text-[14px] font-black text-zinc-950 transition hover:bg-zinc-200 disabled:opacity-60 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
                >
                  辞退
                </button>
                <button
                  type="button"
                  onClick={acceptDrop}
                  disabled={isBusy}
                  className="h-10 rounded-xl bg-zinc-200/70 text-[14px] font-black text-zinc-950 transition hover:bg-zinc-200 disabled:opacity-60 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
                >
                  受け入れる
                </button>
              </div>
            </div>

            <div className="hidden md:block">
              <div className="flex items-start gap-3 px-4 pb-3 pt-4">
                <div className="relative shrink-0">
                  <Avatar className="h-11 w-11 border border-white/50 shadow-sm">
                    <AvatarImage src={activeDrop.sender?.avatarUrl} alt={senderName} />
                    <AvatarFallback>{senderName.slice(0, 1)}</AvatarFallback>
                  </Avatar>
                  <div className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                    <ComposerIcon kind="send" className="h-2.5 w-2.5" />
                  </div>
                  <span className="absolute inset-0 rounded-full border-2 border-primary/35" style={{ animation: 'limedrop-signal-pulse 1.6s ease-out infinite' }} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-[16px] font-black leading-none">LimeDrop</div>
                  <div className="mt-1 line-clamp-2 text-[14px] font-bold leading-snug">
                    {senderName}さんがポストを共有しようとしています
                  </div>
                  <div className="mt-1 truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    @{senderUsername} から {postAuthorName} さんのポスト
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 border-t border-black/5 p-2.5 dark:border-white/10">
                <button
                  type="button"
                  onClick={declineDrop}
                  disabled={isBusy}
                  className="h-8 rounded-xl bg-zinc-200/70 text-sm font-bold text-zinc-950 transition hover:bg-zinc-200 disabled:opacity-60 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
                >
                  辞退
                </button>
                <button
                  type="button"
                  onClick={acceptDrop}
                  disabled={isBusy}
                  className="h-8 rounded-xl bg-zinc-200/70 text-sm font-bold text-zinc-950 transition hover:bg-zinc-200 disabled:opacity-60 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
                >
                  受け入れる
                </button>
              </div>
            </div>
          </div>

          {drops.length > 1 && (
            <div className="pointer-events-none mx-auto mt-2 w-fit rounded-full bg-black/50 px-3 py-1 text-xs font-bold text-white backdrop-blur md:mr-0">
              あと{drops.length - 1}件
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
};

// Snowflakes are irregular aggregates, with wind/drag integrated over time.
// Keep drawing off React's render path and stop work when the page is hidden.
export function SnowEffect() {
  const enabled = useSnowEffect();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!enabled || !canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 1, height = 1, frame = 0, lastTime = 0, elapsed = 0;
    let disposed = false;
    // Original aggregate textures, generated once. Different torn silhouettes and
    // soft edges avoid both a crystal icon and a smooth circular billboard.
    const textures = Array.from({ length: 20 }, (_, variant) => {
      const texture = document.createElement('canvas');
      texture.width = texture.height = 64;
      const brush = texture.getContext('2d')!;
      brush.shadowColor = 'rgba(240,245,255,.55)';
      brush.shadowBlur = variant % 4 === 0 ? 2.4 : .6;
      for (let fragment = 0; fragment < 4 + variant % 4; fragment++) {
        const cx = 20 + Math.random() * 24, cy = 20 + Math.random() * 24;
        const radius = 6 + Math.random() * 10;
        const vertices = 7 + Math.floor(Math.random() * 5);
        brush.fillStyle = `rgba(255,255,255,${.7 + Math.random() * .3})`;
        brush.strokeStyle = 'rgba(75,90,110,.14)';
        brush.lineWidth = .6;
        brush.beginPath();
        for (let vertex = 0; vertex < vertices; vertex++) {
          const angle = (vertex + Math.random() * .45) / vertices * Math.PI * 2;
          const distance = radius * (.35 + Math.random() * .65);
          const x = cx + Math.cos(angle) * distance, y = cy + Math.sin(angle) * distance;
          if (!vertex) brush.moveTo(x, y); else brush.lineTo(x, y);
        }
        brush.closePath(); brush.fill(); brush.stroke();
      }
      return texture;
    });
    // Continuous spatial noise: neighbouring flakes share a moving air field,
    // rather than following identical sine-wave animation paths.
    const noise = (x: number, y: number, time: number, seed: number) => {
      const ix = Math.floor(x), iy = Math.floor(y), it = Math.floor(time);
      const smooth = (v: number) => v * v * (3 - 2 * v);
      const sx = smooth(x - ix), sy = smooth(y - iy), st = smooth(time - it);
      const hash = (a: number, b: number, c: number) => {
        let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 1274126177) ^ seed;
        n = Math.imul(n ^ (n >>> 13), 1274126177);
        return ((n ^ (n >>> 16)) >>> 0) / 2147483648 - 1;
      };
      const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
      const plane = (z: number) => lerp(lerp(hash(ix, iy, z), hash(ix + 1, iy, z), sx), lerp(hash(ix, iy + 1, z), hash(ix + 1, iy + 1, z), sx), sy);
      return lerp(plane(it), plane(it + 1), st);
    };
    const makeFlake = (initial: boolean) => {
      const z = .85 + Math.pow(Math.random(), .6) * 3.8;
      // A skewed distribution keeps large clumps occasional, not evenly mixed.
      const diameter = 3.5 + Math.min(9, -Math.log(Math.max(.001, Math.random())) * 2.7);
      const terminal = 24 + Math.sqrt(diameter) * 13;
      return {
        x: (Math.random() - .5) * (width + 80) * z,
        y: initial ? (Math.random() - .5) * height * z : (-height / 2 - 35) * z,
        z, diameter, terminal,
        alpha: .7 + Math.random() * .3,
        vx: Math.random() * 8 - 4, vy: terminal,
        angle: Math.random() * Math.PI * 2, tilt: Math.random() * Math.PI * 2,
        spin: (Math.random() - .5) * .55, tumble: .3 + Math.random() * .8,
        drag: .4 + Math.random() * .7, aggregate: Math.random() > .35,
        texture: textures[Math.floor(Math.random() * textures.length)],
      };
    };
    let flakes: ReturnType<typeof makeFlake>[] = [];
    const resize = () => {
      const oldWidth = width, oldHeight = height;
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.ceil(width * ratio);
      canvas.height = Math.ceil(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      flakes.forEach(flake => { flake.x *= width / oldWidth; flake.y *= height / oldHeight; });
      const count = Math.max(48, Math.min(width < 768 ? 70 : 140, Math.round(width * height / 8500)));
      flakes = flakes.slice(0, count);
      while (flakes.length < count) flakes.push(makeFlake(true));
    };
    const draw = (time: number) => {
      if (disposed) return;
      frame = requestAnimationFrame(draw);
      if (!lastTime) { lastTime = time; return; }
      if (time - lastTime < (motion.matches ? 80 : 33)) return;
      const dt = Math.min((time - lastTime) / 1000, .06) * (motion.matches ? .3 : 1);
      lastTime = time;
      elapsed += dt;
      context.clearRect(0, 0, width, height);
      const wind = 9 + noise(0, 0, elapsed * .09, 17) * 22;
      // Alpha-composite distant flakes first.
      flakes.sort((a, b) => b.z - a.z);
      for (const flake of flakes) {
        const fieldX = flake.x / 240, fieldY = flake.y / 210;
        const flow = noise(fieldX, fieldY, elapsed * .2 + flake.z, 37)
          + .4 * noise(fieldX * 2.7, fieldY * 2.7, elapsed * .36, 91);
        const lift = noise(fieldX, fieldY, elapsed * .16 + flake.z, 131);
        const response = 1 - Math.exp(-dt * flake.drag);
        flake.vx += (wind + flow * 38 - flake.vx) * response;
        flake.vy += (flake.terminal * (1 + lift * .28) - flake.vy) * response;
        flake.x += flake.vx * dt;
        flake.y += flake.vy * dt;
        flake.angle += (flake.spin + flow * .35) * dt;
        flake.tilt += flake.tumble * dt;
        const halfWorldWidth = (width / 2 + 40) * flake.z;
        if (flake.x > halfWorldWidth) flake.x = -halfWorldWidth;
        if (flake.x < -halfWorldWidth) flake.x = halfWorldWidth;
        if (flake.y / flake.z > height / 2 + 40) Object.assign(flake, makeFlake(false));
        // Perspective couples visible size and speed to the same physical depth.
        const size = Math.max(6, Math.min(48, flake.diameter * 4.8 / flake.z));
        const face = Math.abs(Math.cos(flake.tilt));
        const squash = flake.aggregate ? .62 + face * .38 : .12 + face * .88;
        const alpha = flake.alpha * Math.exp(-flake.z * .05) * (.6 + face * .4);
        context.save();
        context.translate(width / 2 + flake.x / flake.z, height / 2 + flake.y / flake.z);
        // Two exposure samples soften movement without leaving long screen trails.
        const trailX = -flake.vx / flake.z / 90, trailY = -flake.vy / flake.z / 90;
        context.rotate(flake.angle);
        const localTrailX = trailX * Math.cos(flake.angle) + trailY * Math.sin(flake.angle);
        const localTrailY = -trailX * Math.sin(flake.angle) + trailY * Math.cos(flake.angle);
        context.globalAlpha = alpha * .16;
        context.drawImage(flake.texture, -size / 2 + localTrailX, -size * squash / 2 + localTrailY, size, size * squash);
        context.globalAlpha = alpha * .84;
        context.drawImage(flake.texture, -size / 2, -size * squash / 2, size, size * squash);
        context.restore();
      }
    };
    const updateVisibility = () => {
      const paused = document.visibilityState === 'hidden';
      setHidden(paused);
      cancelAnimationFrame(frame);
      lastTime = 0;
      if (!paused) frame = requestAnimationFrame(draw);
    };
    resize();
    updateVisibility();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', updateVisibility);
      context.clearRect(0, 0, width, height);
      flakes = [];
      textures.forEach(texture => { texture.width = texture.height = 0; });
    };
  }, [enabled]);
  if (!enabled) return null;
  return createPortal(<div className="lime-snow" aria-hidden="true" data-paused={hidden}><canvas ref={canvasRef}/></div>, document.body);
}

const EmojiRainEffect = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<{ id: number; char: string; left: number; duration: number; delay: number; size: number }[]>([]);

  const char = user?.emojiEffect || localStorage.getItem('lime_emoji_pref') || '';

  useEffect(() => {
    if (!char) {
      setItems([]);
      return;
    }
    const newItems = Array.from({ length: 20 }).map((_, i) => ({
      id: i,
      char: char,
      left: Math.random() * 100,
      duration: 5 + Math.random() * 7,
      delay: Math.random() * 10,
      size: 16 + Math.random() * 20,
    }));
    setItems(newItems);
  }, [char]);

  if (!char) return null;

  return (
    <div style={{ pointerEvents: 'none', position: 'fixed', inset: 0, zIndex: 9999, overflow: 'hidden' }}>
      <style>{`
        @keyframes fall-animation {
          0% { transform: translateY(-10vh) rotate(0deg); opacity: 0; }
          10% { opacity: 0.8; }
          90% { opacity: 0.8; }
          100% { transform: translateY(110vh) rotate(360deg); opacity: 0; }
        }
      `}</style>
      {items.map((item) => (
        <div
          key={item.id}
          style={{
            position: 'absolute',
            top: '-50px',
            left: `${item.left}%`,
            animation: `fall-animation ${item.duration}s linear infinite`,
            animationDelay: `${item.delay}s`,
            fontSize: `${item.size}px`,
            userSelect: 'none',
          }}
        >
          {item.char}
        </div>
      ))}
    </div>
  );
};

// 新規投稿用のフローティングボタン(FAB)。
// document.body へポータル描画し、Providerツリー内のCSS(transform/overflowなど)の
// 影響を受けないようにすることで、iPhoneのPWAやモバイル幅Chromeで表示されない不具合を解消する。
// 非表示状態は scale/opacity に加えて pointer-events も切ることで、
// 見えない状態のボタンがタップを奪ってしまう副作用も防ぐ。
const FloatingComposeButton = ({ hidden: routeHidden, onOpen }: { hidden: boolean; onOpen: () => void }) => {
  const visible=useScrollDirection();
  const hidden=routeHidden||!visible;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "fixed z-[2147483000] flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-all duration-500 hover:scale-110 active:scale-95 md:hidden",
        hidden ? "pointer-events-none scale-0 opacity-0" : "pointer-events-auto scale-100 opacity-100"
      )}
      style={{
        right: 'max(1.5rem, env(safe-area-inset-right, 0px))',
        bottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))',
        translate: 'var(--lime-mobile-drawer-shift, 0px) 0',
        transition: 'translate var(--lime-mobile-drawer-duration, 0ms) cubic-bezier(0.22, 1, 0.36, 1), transform 500ms, opacity 500ms',
      }}
      aria-hidden={hidden}
      tabIndex={hidden ? -1 : 0}
      aria-label="新規投稿"
    >
      <PenSquare className="h-5 w-5" />
    </button>,
    document.body
  );
};

// コンポーネントツリー内で useLocation を利用できるようにするためのラッパーコンポーネント
const AppContent = () => {
  useEffect(()=>installPwaMemoryManagement(queryClient),[]);
  const [isPostModalOpen, setPostModalOpen] = useState(false);
  const [overlayQuotedPost, setOverlayQuotedPost] = useState<PostWithAuthor | undefined>();
  const openPostOverlay = (quotedPost?: PostWithAuthor) => {
    setOverlayQuotedPost(quotedPost);
    setPostModalOpen(true);
  };
  const resetAccountOverlays = useCallback(() => {
    setPostModalOpen(false);
    setOverlayQuotedPost(undefined);
  }, []);
  const { pathname } = useLocation();

  // 大文字小文字の違い（/CHAT または /chat）を許容するため、小文字に変換して判定
  const isChatPage = pathname.toLowerCase() === "/chat" || pathname.toLowerCase() === "/ramunotesns.github.io/chat";
const lowerPath = pathname.toLowerCase();
const isAuthPage = lowerPath.includes("/auth");
const isTermsPage = lowerPath.includes("/terms");
const isPostDetailPage = lowerPath.includes("/post/");
const isMediaPage = lowerPath === "/media" || lowerPath.startsWith("/media/");

// いずれかの非表示対象ページであるか、またはスクロールによって非表示にするか
const shouldHideFAB = isChatPage || isAuthPage || isTermsPage || isMediaPage || isPostDetailPage || lowerPath === '/topics' || lowerPath === '/maps' || lowerPath.startsWith('/communities') || /\/messages(?:\/|$)/.test(lowerPath);

  return (
    <PostOverlayContext.Provider value={openPostOverlay}>
      <ScrollToTop />

      <AuthProvider>
        <SpaceProvider>
        <FriendCloudSync />
        <AccountSuspensionFeedback />
        <AccountOverlayReset onReset={resetAccountOverlays} />
        <NotificationWatcher />
        <MediaLightboxRoot />
        <LimeDropReceiver />
        <EmojiRainEffect />
        <SnowEffect />

        <Routes>
          <Route path="/auth" element={<Suspense fallback={<RouteLoading />}><AuthPage /></Suspense>} />
          <Route path="/terms" element={<Suspense fallback={<RouteLoading />}><TermsPage /></Suspense>} />
          <Route element={<AppLayout />}>
            <Route path="/" element={<Feed />} />
            <Route path="/notifications" element={<Suspense fallback={<RouteLoading />}><Notifications /></Suspense>} />
            <Route path="/search" element={<Suspense fallback={<RouteLoading />}><SearchPage /></Suspense>} />
            <Route path="/news/history" element={<Suspense fallback={<RouteLoading />}><NewsPage /></Suspense>} />
            <Route path="/communities" element={<Suspense fallback={<RouteLoading />}><Communities /></Suspense>} />
            <Route path="/communities/:communityId" element={<Suspense fallback={<RouteLoading />}><Communities /></Suspense>} />
            <Route path="/communities/:communityId/members" element={<Suspense fallback={<RouteLoading />}><Communities /></Suspense>} />
            <Route path="/maps" element={<Suspense fallback={<RouteLoading />}><LimeMaps /></Suspense>} />
            <Route path="/news" element={<Suspense fallback={<RouteLoading />}><NewsPage /></Suspense>} />
            <Route path="/messages/:conversationId?" element={<Suspense fallback={<RouteLoading />}><DirectMessages /></Suspense>} />
            <Route path="/chat" element={<Suspense fallback={<RouteLoading />}><Navigate to="/messages/limeai" replace /></Suspense>} /> {/* AIチャットページのルーティングを追加 */}
            <Route path="/communities/:communityId/post/:postId/activity" element={<Suspense fallback={<RouteLoading />}><PostActivity /></Suspense>} />
            <Route path="/communities/:communityId/post/:id" element={<Suspense fallback={<RouteLoading />}><PostDetail /></Suspense>} />
            <Route path="/post/:id" element={<Suspense fallback={<RouteLoading />}><PostDetail /></Suspense>} />
            <Route path="/post/:postId/activity" element={<Suspense fallback={<RouteLoading />}><PostActivity /></Suspense>} />
            <Route path="/u/:username" element={<Suspense fallback={<RouteLoading />}><Profile /></Suspense>} />
            <Route path="/watch-history" element={<Suspense fallback={<RouteLoading />}><WatchHistory /></Suspense>} />
            <Route path="/u/:username/watch-history" element={<Suspense fallback={<RouteLoading />}><WatchHistory /></Suspense>} />
            <Route path="/u/:username/about" element={<Suspense fallback={<RouteLoading />}><AccountAboutPage /></Suspense>} />
            <Route path="/u/:username/followers_following" element={<Suspense fallback={<RouteLoading />}><FollowersFollowingPage /></Suspense>} />
            <Route path="/settings" element={<Suspense fallback={<RouteLoading />}><Settings /></Suspense>} />
            <Route path="/bookmarks" element={<Suspense fallback={<RouteLoading />}><Bookmarks /></Suspense>} />
            <Route path="/lists" element={<Suspense fallback={<RouteLoading />}><Lists /></Suspense>} />
            <Route path="/lists/:id" element={<Suspense fallback={<RouteLoading />}><Lists /></Suspense>} />
            <Route path="/topics" element={<Suspense fallback={<RouteLoading />}><Topics /></Suspense>} />
            <Route path="/share" element={<Suspense fallback={<RouteLoading />}><Share /></Suspense>} />
            <Route path="/spaces/:id" element={<Suspense fallback={<RouteLoading />}><SpacePage /></Suspense>} />
            <Route path="/limepro" element={<Suspense fallback={<RouteLoading />}><LimeProLanding /></Suspense>} />
            <Route path="/media" element={<Suspense fallback={<RouteLoading />}><MediaViewer /></Suspense>} />
<Route path="/media/:username" element={<Suspense fallback={<RouteLoading />}><MediaViewer /></Suspense>} />
          </Route>
          <Route path="/index" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Suspense fallback={<RouteLoading />}><NotFound /></Suspense>} />
        </Routes>

        <FloatingComposeButton hidden={shouldHideFAB} onOpen={() => openPostOverlay()} />

        <PostOverlay
          isOpen={isPostModalOpen}
          initialQuotedPost={overlayQuotedPost}
          onClose={() => setPostModalOpen(false)}
        />

        </SpaceProvider>
      </AuthProvider>
    </PostOverlayContext.Provider>
  );
};

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <TooltipProvider>
          <Toaster />
          <Sonner />

          <BrowserRouter
            basename={import.meta.env.BASE_URL}
          >
            <BackgroundMediaRoot>
              <AppContent />
            </BackgroundMediaRoot>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;


// MediaLightboxRoot
const Viewer=lazy(()=>import("@/components/media/MediaLightbox").then(module=>({default:module.MediaLightbox})));
function Loading({onClose,failed=false}:{onClose:()=>void;failed?:boolean}){
 return createPortal(<div role="status" className="fixed inset-0 z-[2147483500] flex items-center justify-center bg-black text-white"><span>{failed?'画像・動画の画面を読み込めませんでした':'読み込み中…'}</span><button type="button" onClick={onClose} aria-label="メディアを閉じる" className="absolute right-4 top-[max(16px,env(safe-area-inset-top))] rounded-full bg-white/15 px-4 py-2">閉じる</button></div>,document.body);
}
class ViewerBoundary extends Component<{children:ReactNode;onClose:()=>void},{failed:boolean}>{
 state={failed:false};static getDerivedStateFromError(){return{failed:true};}
 render(){return this.state.failed?<Loading failed onClose={this.props.onClose}/>:this.props.children;}
}
/** Keep the event listener ready, but load viewer UI only on an actual open. */
export function MediaLightboxRoot(){
 const [selection,setSelection]=useState<MediaViewerSelection|null>(null);
 const location=useLocation(),{user}=useAuth();
 useEffect(()=>{const open=(event:Event)=>setSelection((event as CustomEvent<MediaViewerSelection>).detail);window.addEventListener(MEDIA_VIEWER_EVENT,open);return()=>window.removeEventListener(MEDIA_VIEWER_EVENT,open);},[]);
 useEffect(()=>setSelection(null),[location.key,user?.id]);
 if(!selection)return null;
 const close=()=>setSelection(null);
 return <ViewerBoundary key={`${selection.post?.id??selection.postId}:${selection.url}`} onClose={close}><Suspense fallback={<Loading onClose={close}/>}><OfflineBookmarkContext.Provider value={selection.offline??null}><Viewer selection={selection} onClose={close}/></OfflineBookmarkContext.Provider></Suspense></ViewerBoundary>;
}


// notificationBadge
const latestBadgeRequests=new Map<string,number>();
let latestDeviceBadgeRequest=0;
type BadgeNavigator=Navigator&{setAppBadge?:(count:number)=>Promise<void>;clearAppBadge?:()=>Promise<void>};
async function refreshNotificationBadge(userId:string,readIds:string[]=[],context?:AccountReadContext){
 const request=(latestBadgeRequests.get(userId)??0)+1;
 latestBadgeRequests.set(userId,request);
 const deviceRequest=context?0:++latestDeviceBadgeRequest;
 const {count,error}=await (context?.client??supabase).from('notifications').select('id',{count:'exact',head:true}).eq('user_id',userId).eq('is_read',false);
 if(error||request!==latestBadgeRequests.get(userId))return;
 const unread=Math.max(0,count??0);const nav=navigator as BadgeNavigator;
 // In-app unread counts must not wait for the optional OS badge API.
 window.dispatchEvent(new CustomEvent('lime-notification-count-changed',{detail:{userId,count:unread}}));
 // A saved account must update its own in-app count without replacing the active account's OS badge.
 if(context||deviceRequest!==latestDeviceBadgeRequest)return;
 try{
  const update=unread?nav.setAppBadge?.(unread):nav.clearAppBadge?.();
  void update?.catch(()=>{});
 }catch{/* Badge APIs are optional. */}
 try{
  // ready never resolves on an unregistered page; badge refresh must not wait for it.
  const registration=await navigator.serviceWorker?.getRegistration(import.meta.env.BASE_URL);
  if(request!==latestBadgeRequests.get(userId)||deviceRequest!==latestDeviceBadgeRequest)return;
  const worker=registration?.active??navigator.serviceWorker?.controller;
  worker?.postMessage({type:unread?'LIME_SET_BADGE':'LIME_CLEAR_BADGE',count:unread});
  if(readIds.length){
   worker?.postMessage({type:'LIME_NOTIFICATIONS_READ',ids:readIds,count:unread});
   const notices=await registration?.getNotifications?.();
   notices?.filter(n=>readIds.includes(n.data?.notificationId)||readIds.includes(n.tag)).forEach(n=>n.close());
  }
 }catch{/* Keep successful read updates even when the worker is unavailable. */}
}

// notificationToast
const timers=new Map<string,ReturnType<typeof setTimeout>>();
function showNotificationToast(id:string,title:string,message:string){
 const key=`notification-${id}`;const previous=timers.get(key);if(previous)clearTimeout(previous);
 toast(title,{id:key,description:message,duration:5000});
 // Sonner pauses its own timer while hovered; notification popups still expire.
 timers.set(key,setTimeout(()=>{toast.dismiss(key);timers.delete(key);},5000));
}
function dismissNotificationToasts(ids?:string[]){
 for(const [key,timer]of timers)if(!ids||ids.some(id=>key===`notification-${id}`)){clearTimeout(timer);toast.dismiss(key);timers.delete(key);}
}

export { registerPwa };
export { refreshNotificationBadge };
export { showNotificationToast };
export { dismissNotificationToasts };

function FriendCloudSync(){
 const {user}=useAuth();
 useEffect(()=>user?.id?startFriendCloudSync(user.id):undefined,[user?.id]);
 useEffect(()=>{const error=()=>toast.error('フレンド情報を同期できませんでした。接続が戻ったら再同期します。',{id:'friend-cloud-sync'});window.addEventListener('lime-friend-sync-error',error);return()=>window.removeEventListener('lime-friend-sync-error',error)},[]);
 return null;
}
