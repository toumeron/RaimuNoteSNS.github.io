import { AccountSuspensionFeedback } from "@/components/layout/AppLayout";
import { ComposerIcon } from "@/components/feed/PostPoll";
import { MediaLightboxRoot } from '@/components/media/MediaLightboxRoot';
import {PostOverlay} from '@/components/feed/DeferredPostComposer';
export {PostOverlay,PostComposer} from '@/components/feed/DeferredPostComposer';
import {installPwaMemoryManagement,pwaQueryGcTime} from '@/lib/pwaPerformance';
import { PostOverlayContext } from "@/components/layout/DesktopLayoutContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SonnerToaster as Sonner } from "@/components/ui/button";
import { Toaster } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/button";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { ThemeProvider } from "next-themes";
import { useOSNotification } from "@/hooks/useOSNotification";
const AuthPage = lazy(() => import("./pages/Auth"));
import Feed from "./pages/Feed";
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
import { SpaceProvider } from '@/components/spaces/SpaceProvider';
const LimeMaps = lazy(() => import("./pages/LimeMaps"));
const NewsPage = lazy(() => import("@/pages/Topics").then(module => ({default: module.NewsPage})));
const TermsPage = lazy(() => import("./pages/terms"));
const LimeProLanding = lazy(() => import("./pages/LimePro"));
const MediaViewer = lazy(() => import("./pages/MediaViewer"));

import { PostCardSkeleton } from "@/components/feed/PostPoll";

function RouteLoading() {
  return <div role="status" aria-label="読み込み中"><PostCardSkeleton /><PostCardSkeleton /><PostCardSkeleton /></div>;
}

// PostComposer 用のインポート群
import {X,PenSquare} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn, shouldRetryRead } from '@/lib/utils';
import type { PostWithAuthor } from '@/types';
import { supabase } from '@/lib/supabase';

import { useScrollDirection } from "@/hooks/useViewportWidth";

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

    if (audioSession && 'type' in audioSession) {
      audioSession.type = 'playback';
    }
  } catch (error) {
    console.warn('Audio Session API setup failed:', error);
  }
};

const sendYouTubeCommand = (iframe: HTMLIFrameElement | null | undefined, command: 'playVideo' | 'pauseVideo' | 'stopVideo') => {
  if (!iframe?.contentWindow) return;

  try {
    iframe.contentWindow.postMessage(
      JSON.stringify({
        event: 'command',
        func: command,
        args: [],
      }),
      'https://www.youtube.com'
    );
  } catch {
    // noop
  }
};

function BackgroundMediaRoot({ children }: { children: ReactNode }) {
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

      configurePlaybackAudioSession();
      setActiveMedia(detail);

      if (detail.kind === 'youtube') {
        window.setTimeout(() => sendYouTubeCommand(detail.element, 'playVideo'), 80);
      }
    };

    const handleStop = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      const current = activeMediaRef.current;

      if (!current) return;
      if (detail?.key && detail.key !== current.key) return;

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
    if (!activeMedia) return;

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
        artist: activeMedia.kind === 'spotify' ? 'Spotify' : 'YouTube',
        album: 'LimeNote SNS',
      });
      mediaSession.playbackState = 'playing';

      mediaSession.setActionHandler?.('play', () => {
        configurePlaybackAudioSession();
        if (activeMedia.kind === 'youtube') {
          sendYouTubeCommand(activeMedia.element, 'playVideo');
        }
        mediaSession.playbackState = 'playing';
      });

      mediaSession.setActionHandler?.('pause', () => {
        if (activeMedia.kind === 'youtube') {
          sendYouTubeCommand(activeMedia.element, 'pauseVideo');
        }
        mediaSession.playbackState = 'paused';
      });

      mediaSession.setActionHandler?.('stop', () => {
        if (activeMedia.kind === 'youtube') {
          sendYouTubeCommand(activeMedia.element, 'stopVideo');
        }
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
    if (!activeMedia) return;

    const keepPlaybackSessionAlive = () => {
      const current = activeMediaRef.current;
      if (!current) return;

      configurePlaybackAudioSession();

      if (current.kind === 'youtube') {
        sendYouTubeCommand(current.element, 'playVideo');
        window.setTimeout(() => sendYouTubeCommand(current.element, 'playVideo'), 160);
      }
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

const LimeDropReceiver = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [drops, setDrops] = useState<IncomingLimeDrop[]>([]);
  const [busyDropId, setBusyDropId] = useState<string | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const swipeStartYRef = useRef<number | null>(null);

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

    const loadPendingDrops = async () => {
      const { data, error } = await supabase
        .from('lime_drops')
        .select('id, sender_id, recipient_id, post_id, post_url, post_author_display_name, post_author_username, post_text, created_at, status')
        .eq('recipient_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) {
        console.error('Fetch pending LimeDrops failed:', error);
        return;
      }

      const hydrated = await attachSenderProfiles(data || []);
      if (!cancelled) {
        setDrops(hydrated);
      }
    };

    const hydrateRealtimeDrop = async (row: any) => {
      if (!row || row.status !== 'pending') return;

      const hydrated = await attachSenderProfiles([row]);
      if (cancelled || hydrated.length === 0) return;

      setDrops((prev) => {
        if (prev.some((drop) => drop.id === hydrated[0].id)) return prev;
        return [hydrated[0], ...prev].slice(0, 5);
      });
    };

    loadPendingDrops();

    const channel = supabase
      .channel(`lime-drop-receiver-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'lime_drops',
          filter: `recipient_id=eq.${user.id}`,
        },
        (payload) => {
          hydrateRealtimeDrop(payload.new);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'lime_drops',
          filter: `recipient_id=eq.${user.id}`,
        },
        (payload) => {
          const next = payload.new as any;
          if (next?.status === 'pending') {
            hydrateRealtimeDrop(next);
            return;
          }

          setDrops((prev) => prev.filter((drop) => drop.id !== next?.id));
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const activeDrop = drops[0];

  const removeDrop = (dropId: string) => {
    setDrops((prev) => prev.filter((drop) => drop.id !== dropId));
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

      // post_id が無い（＝Bluesky発の投稿）場合、内部の /post/:id ページには
      // 対応するレコードが存在しないため「投稿は見つかりませんでした」になっていた。
      // その場合は post_url（bsky.appのURL）を外部タブで開く。
      if (activeDrop.post_id) {
        navigate(`/post/${activeDrop.post_id}`);
      } else if (activeDrop.post_url) {
        window.location.href = activeDrop.post_url;
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
const shouldHideFAB = isChatPage || isAuthPage || isTermsPage || isMediaPage || isPostDetailPage || lowerPath === '/topics' || lowerPath === '/maps' || /\/messages(?:\/|$)/.test(lowerPath);

  return (
    <PostOverlayContext.Provider value={openPostOverlay}>
      <ScrollToTop />

      <AuthProvider>
        <SpaceProvider>
        <AccountSuspensionFeedback />
        <AccountOverlayReset onReset={resetAccountOverlays} />
        <NotificationWatcher />
        <MediaLightboxRoot />
        <LimeDropReceiver />
        <EmojiRainEffect />

        <Routes>
          <Route path="/auth" element={<Suspense fallback={<RouteLoading />}><AuthPage /></Suspense>} />
          <Route path="/terms" element={<Suspense fallback={<RouteLoading />}><TermsPage /></Suspense>} />
          <Route element={<AppLayout />}>
            <Route path="/" element={<Feed />} />
            <Route path="/notifications" element={<Suspense fallback={<RouteLoading />}><Notifications /></Suspense>} />
            <Route path="/search" element={<Suspense fallback={<RouteLoading />}><SearchPage /></Suspense>} />
            <Route path="/news/history" element={<Suspense fallback={<RouteLoading />}><NewsPage /></Suspense>} />
            <Route path="/maps" element={<Suspense fallback={<RouteLoading />}><LimeMaps /></Suspense>} />
            <Route path="/news" element={<Suspense fallback={<RouteLoading />}><NewsPage /></Suspense>} />
            <Route path="/messages/:conversationId?" element={<Suspense fallback={<RouteLoading />}><DirectMessages /></Suspense>} />
            <Route path="/chat" element={<Suspense fallback={<RouteLoading />}><Navigate to="/messages/limeai" replace /></Suspense>} /> {/* AIチャットページのルーティングを追加 */}
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
