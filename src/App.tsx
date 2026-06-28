import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type UIEvent as ReactUIEvent } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from 'react-router-dom';
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth"; 
import { AppLayout } from "@/components/layout/AppLayout";
import { ThemeProvider } from "next-themes"; 
import { useOSNotification } from "@/hooks/useOSNotification"; 
import AuthPage from "./pages/Auth";
import Feed from "./pages/Feed";
import PostDetail from "./pages/PostDetail";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import SearchPage from "./pages/SearchPage";
import PostActivity from "./pages/PostActivity";
import Share from "./pages/Share";
import NotFound from "./pages/NotFound";
import Notifications from "./pages/Notifications";
import FollowersFollowingPage from "./pages/FollowersFollowingPage";
import SpacePage from "./pages/SpacePage";
import NewsPage from './pages/NewsPage';
import ChatPage from "./pages/ChatPage"; // AIチャットページのインポートを追加
import TermsPage from "./pages/terms";
import MediaViewer from "./pages/MediaViewer.tsx"

// PostComposer 用のインポート群
import { ImagePlus, Loader2, Send, X, AtSign, Hash, Globe, Users, PenSquare } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useCreatePost } from '@/hooks/useFeed';
import { getPostById } from '@/api/posts';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { PostWithAuthor } from '@/types';
import { formatRelative } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// --- スクロール方向検知フック ---
const useScrollDirection = () => {
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);

  useEffect(() => {
    const controlNavbar = () => {
      const currentScrollY = window.scrollY;
      const threshold = 100; // 判定を緩くするためにしきい値を増加

      // 差分がしきい値以下の場合は何もしない（微細な揺れを無視）
      if (Math.abs(currentScrollY - lastScrollY) < threshold) return;

      if (currentScrollY > lastScrollY && currentScrollY > 100) {
        setIsVisible(false); // 下スクロールで非表示
      } else if (currentScrollY < lastScrollY) {
        setIsVisible(true);  // 上スクロールで表示
      }
      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', controlNavbar);
    return () => window.removeEventListener('scroll', controlNavbar);
  }, [lastScrollY]);

  return isVisible;
};

const ScrollToTop = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { 
      staleTime: 1000 * 60 * 60, 
      refetchOnWindowFocus: false, 
      retry: 3,
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

const NotificationWatcher = () => {
  const { user } = useAuth();
  useOSNotification(user?.id ?? null);
  return null;
};

interface IncomingLimeDrop {
  id: string;
  sender_id: string;
  recipient_id: string;
  post_id: string;
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
      navigate(`/post/${activeDrop.post_id}`);
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
                    <Send className="h-2.5 w-2.5" />
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
                    <Send className="h-2.5 w-2.5" />
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

const MAX_LEN = 500;
const MAX_IMAGES = 4;

const MENTION_SEARCH_DEBOUNCE_MS = 180;
const HASHTAG_SEARCH_DEBOUNCE_MS = 180;
const SUGGESTION_CACHE_LIMIT = 24;
const QUOTED_POST_CACHE_LIMIT = 8;

const mentionSuggestionCache = new Map<string, any[]>();
const hashtagSuggestionCache = new Map<string, any[]>();
const quotedPostCache = new Map<string, PostWithAuthor>();
const quotedPostFetches = new Map<string, Promise<PostWithAuthor | null>>();

const normalizeSuggestionQuery = (query: string) => query.trim().toLowerCase();

const setLimitedCache = <K, V>(map: Map<K, V>, key: K, value: V, limit: number) => {
  map.delete(key);
  map.set(key, value);

  while (map.size > limit) {
    const firstKey = map.keys().next().value as K | undefined;
    if (firstKey === undefined) break;
    map.delete(firstKey);
  }
};

const getLimitedCache = <K, V>(map: Map<K, V>, key: K) => {
  const cached = map.get(key);
  if (cached === undefined) return undefined;

  map.delete(key);
  map.set(key, cached);
  return cached;
};

const getQuotedPostCached = async (postId: string) => {
  const cached = getLimitedCache(quotedPostCache, postId);
  if (cached) return cached;

  const pending = quotedPostFetches.get(postId);
  if (pending) return pending;

  const request = getPostById(postId)
    .then((post) => {
      setLimitedCache(quotedPostCache, postId, post, QUOTED_POST_CACHE_LIMIT);
      return post;
    })
    .catch((error) => {
      console.error('Fetch quoted post failed:', error);
      return null;
    })
    .finally(() => {
      quotedPostFetches.delete(postId);
    });

  quotedPostFetches.set(postId, request);
  return request;
};

interface PostComposerProps {
  initialQuotedPost?: PostWithAuthor | null;
  initialContent?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
  timelineGlass?: boolean;
}

type CropOffset = { x: number; y: number };

type CropDragState = {
  dragging: boolean;
  startX: number;
  startY: number;
  baseX: number;
  baseY: number;
};

type CropPointer = { x: number; y: number };

type CropPinchState = {
  active: boolean;
  startDistance: number;
  startZoom: number;
};

type CropAspectId = 'original' | 'square' | 'portrait' | 'landscape' | 'wide';

const CROP_ASPECT_OPTIONS: Array<{
  id: CropAspectId;
  label: string;
  width: number;
  height: number;
  outputWidth: number;
  outputHeight: number;
  iconWidth: number;
  iconHeight: number;
}> = [
  // 一番左は「原寸」。画像本来の縦横比を使うので、編集を開いただけではトリミングしない。
  { id: 'original', label: '原寸', width: 1, height: 1, outputWidth: 1, outputHeight: 1, iconWidth: 22, iconHeight: 16 },
  { id: 'square', label: '1:1', width: 1, height: 1, outputWidth: 1080, outputHeight: 1080, iconWidth: 18, iconHeight: 18 },
  { id: 'portrait', label: '3:4', width: 3, height: 4, outputWidth: 1080, outputHeight: 1440, iconWidth: 15, iconHeight: 20 },
  { id: 'landscape', label: '4:3', width: 4, height: 3, outputWidth: 1440, outputHeight: 1080, iconWidth: 22, iconHeight: 16 },
  { id: 'wide', label: '16:9', width: 16, height: 9, outputWidth: 1600, outputHeight: 900, iconWidth: 24, iconHeight: 14 },
];

const clampCropZoomValue = (value: number) => Math.min(3, Math.max(1, value));

const getPointerDistance = (a: CropPointer, b: CropPointer) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
};

// テキストエリア内のカーソル座標を計算するためのヘルパー関数
function getCaretCoordinates(element: HTMLTextAreaElement, position: number) {
  const div = document.createElement('div');
  const style = window.getComputedStyle(element);

  ['width', 'height', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
   'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
   'fontSize', 'lineHeight', 'fontFamily', 'fontWeight', 'wordWrap', 'whiteSpace',
   'letterSpacing', 'boxSizing'].forEach((prop) => {
    (div.style as any)[prop] = style.getPropertyValue(prop);
  });

  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.overflow = 'hidden';

  div.textContent = element.value.substring(0, position);
  const span = document.createElement('span');
  span.textContent = element.value.substring(position) || '.';
  div.appendChild(span);

  document.body.appendChild(div);
  const coordinates = {
    top: span.offsetTop,
    left: span.offsetLeft,
    height: span.offsetHeight
  };
  document.body.removeChild(div);
  return coordinates;
}

export function PostComposer({ initialQuotedPost, initialContent = '', onSuccess, onCancel, timelineGlass = false }: PostComposerProps) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const quoteId = searchParams.get('quote');
  
  const { mutateAsync, isPending } = useCreatePost();
  
  const [content, setContent] = useState(initialContent);
  const [previews, setPreviews] = useState<string[]>([]);
  const [previewOriginals, setPreviewOriginals] = useState<string[]>([]);
  const [editingImageIndex, setEditingImageIndex] = useState<number | null>(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropAspectId, setCropAspectId] = useState<CropAspectId>('original');
  const [cropOffset, setCropOffset] = useState<CropOffset>({ x: 0, y: 0 });
  const [cropImageSize, setCropImageSize] = useState({ width: 0, height: 0 });
  const [cropBoxSize, setCropBoxSize] = useState({ width: 0, height: 0 });
  const [cropStageSize, setCropStageSize] = useState({ width: 0, height: 0 });
  const [quotedPost, setQuotedPost] = useState<PostWithAuthor | null>(initialQuotedPost || null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewsRef = useRef<string[]>([]);
  const previewOriginalsRef = useRef<string[]>([]);
  const cropStageRef = useRef<HTMLDivElement>(null);
  const cropBoxRef = useRef<HTMLDivElement>(null);
  const cropImageElementRef = useRef<HTMLImageElement | null>(null);
  const cropDragRef = useRef<CropDragState>({ dragging: false, startX: 0, startY: 0, baseX: 0, baseY: 0 });
  const cropPointersRef = useRef<Map<number, CropPointer>>(new Map());
  const cropPinchRef = useRef<CropPinchState>({ active: false, startDistance: 0, startZoom: 1 });
  const cropOffsetRef = useRef<CropOffset>({ x: 0, y: 0 });
  const cropZoomRef = useRef(1);
  const cropNativeTouchRef = useRef<{
    active: boolean;
    mode: 'drag' | 'pinch' | null;
    startX: number;
    startY: number;
    startMidX: number;
    startMidY: number;
    startDistance: number;
    startZoom: number;
    baseX: number;
    baseY: number;
  }>({
    active: false,
    mode: null,
    startX: 0,
    startY: 0,
    startMidX: 0,
    startMidY: 0,
    startDistance: 0,
    startZoom: 1,
    baseX: 0,
    baseY: 0,
  });
  const cropRafRef = useRef<number | null>(null);
  const suppressPointerUntilRef = useRef(0);

  // 公開範囲用ステート (追加)
  const [visibility, setVisibility] = useState<'public' | 'following'>('public');

  // メンション・ハッシュタグ機能用ステートとRef
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<any[]>([]);
  const [hashtagQuery, setHashtagQuery] = useState<string | null>(null); // 追加
  const [hashtagResults, setHashtagResults] = useState<any[]>([]); // 追加
  const [cursorPosition, setCursorPosition] = useState(0);
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 }); // 汎用的な名に変更
  const [scrollTop, setScrollTop] = useState(0);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cropOffsetRef.current = cropOffset;
  }, [cropOffset]);

  useEffect(() => {
    cropZoomRef.current = cropZoom;
  }, [cropZoom]);

  useEffect(() => {
    if (initialContent) {
      setContent(initialContent);
    }
  }, [initialContent]);

  useEffect(() => {
    if (!quoteId || initialQuotedPost) return;

    let cancelled = false;

    getQuotedPostCached(quoteId).then((post) => {
      if (cancelled) return;

      if (post) {
        setQuotedPost(post);
        return;
      }

      toast.error('引用元の投稿が見つかりませんでした');
      setSearchParams({});
    });

    return () => {
      cancelled = true;
    };
  }, [quoteId, initialQuotedPost, setSearchParams]);

  useEffect(() => {
    if (initialQuotedPost) {
      setQuotedPost(initialQuotedPost);
    }
  }, [initialQuotedPost]);

  // メンション候補の検索ロジック
  useEffect(() => {
    const query = mentionQuery === null ? '' : normalizeSuggestionQuery(mentionQuery);
    if (!query) {
      setMentionResults([]);
      return;
    }

    const cached = getLimitedCache(mentionSuggestionCache, query);
    if (cached) {
      setMentionResults(cached);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .ilike('username', `${query}%`)
        .limit(5);

      if (cancelled) return;

      if (error) {
        console.error('Fetch mention suggestions failed:', error);
        setMentionResults([]);
        return;
      }

      const rows = data || [];
      setLimitedCache(mentionSuggestionCache, query, rows, SUGGESTION_CACHE_LIMIT);
      setMentionResults(rows);
    }, MENTION_SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mentionQuery]);

  // ハッシュタグ候補の検索ロジック (追加)
  useEffect(() => {
    const query = hashtagQuery === null ? '' : normalizeSuggestionQuery(hashtagQuery);
    if (!query) {
      setHashtagResults([]);
      return;
    }

    const cached = getLimitedCache(hashtagSuggestionCache, query);
    if (cached) {
      setHashtagResults(cached);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const { data, error } = await supabase
        .from('hashtags')
        .select('tag')
        .ilike('tag', `${query}%`)
        .order('usage_count', { ascending: false })
        .limit(5);

      if (cancelled) return;

      if (error) {
        console.error('Fetch hashtag suggestions failed:', error);
        setHashtagResults([]);
        return;
      }

      const rows = data || [];
      setLimitedCache(hashtagSuggestionCache, query, rows, SUGGESTION_CACHE_LIMIT);
      setHashtagResults(rows);
    }, HASHTAG_SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hashtagQuery]);

  // 外側クリックで候補を閉じる
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMentionQuery(null);
        setHashtagQuery(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    previewsRef.current = previews;
  }, [previews]);

  useEffect(() => {
    previewOriginalsRef.current = previewOriginals;
  }, [previewOriginals]);

  useEffect(() => {
    return () => {
      const urls = new Set([...previewsRef.current, ...previewOriginalsRef.current]);
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const addImageFiles = useCallback((incomingFiles: File[]) => {
    const imageFiles = incomingFiles.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return false;

    const slots = MAX_IMAGES - previewsRef.current.length;
    if (slots <= 0) {
      toast.error(`画像は最大${MAX_IMAGES}枚までです`);
      return true;
    }

    if (imageFiles.length > slots) {
      toast.error(`画像は最大${MAX_IMAGES}枚までです`);
    }

    const next = imageFiles.slice(0, slots).map((file) => URL.createObjectURL(file));
    setPreviews((current) => [...current, ...next]);
    setPreviewOriginals((current) => [...current, ...next]);
    return true;
  }, []);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardItems = Array.from(event.clipboardData?.items ?? []);
    const imageFiles = clipboardItems
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (imageFiles.length === 0) return;

    event.preventDefault();
    addImageFiles(imageFiles);
  }, [addImageFiles]);

  const editingImageSrc = editingImageIndex !== null ? (previewOriginals[editingImageIndex] ?? previews[editingImageIndex]) : null;
  const selectedCropAspectBase = CROP_ASPECT_OPTIONS.find((option) => option.id === cropAspectId) ?? CROP_ASPECT_OPTIONS[0];
  const selectedCropAspect = selectedCropAspectBase.id === 'original'
    ? {
        ...selectedCropAspectBase,
        width: cropImageSize.width || 1,
        height: cropImageSize.height || 1,
        outputWidth: cropImageSize.width || 1,
        outputHeight: cropImageSize.height || 1,
      }
    : selectedCropAspectBase;

  const cropAspectRatio = selectedCropAspect.width / selectedCropAspect.height || 1;
  const cropFrameSize = (() => {
    const availableWidth = Math.max(1, cropStageSize.width || 560);
    const availableHeight = Math.max(1, cropStageSize.height || 480);
    const maxWidth = Math.min(availableWidth, 620);
    const maxHeight = availableHeight;

    let width = maxWidth;
    let height = width / cropAspectRatio;

    if (height > maxHeight) {
      height = maxHeight;
      width = height * cropAspectRatio;
    }

    return {
      width: Math.max(48, Math.round(width)),
      height: Math.max(48, Math.round(height)),
    };
  })();

  const getCropAspectIconSize = (option: (typeof CROP_ASPECT_OPTIONS)[number]) => {
    if (option.id !== 'original' || !cropImageSize.width || !cropImageSize.height) {
      return { width: option.iconWidth, height: option.iconHeight };
    }

    const ratio = cropImageSize.width / cropImageSize.height;
    const maxWidth = 24;
    const maxHeight = 20;

    if (ratio >= maxWidth / maxHeight) {
      return { width: maxWidth, height: Math.max(10, Math.round(maxWidth / ratio)) };
    }

    return { width: Math.max(10, Math.round(maxHeight * ratio)), height: maxHeight };
  };

  useEffect(() => {
    if (!editingImageSrc) return;

    const previous = {
      bodyOverflow: document.body.style.overflow,
      htmlOverflow: document.documentElement.style.overflow,
      bodyOverscrollBehavior: document.body.style.overscrollBehavior,
      htmlOverscrollBehavior: document.documentElement.style.overscrollBehavior,
      bodyTouchAction: document.body.style.touchAction,
      htmlTouchAction: document.documentElement.style.touchAction,
      bodyUserSelect: document.body.style.userSelect,
      htmlUserSelect: document.documentElement.style.userSelect,
    };

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.style.overscrollBehavior = 'none';
    document.body.style.touchAction = 'none';
    document.documentElement.style.touchAction = 'none';
    document.body.style.userSelect = 'none';
    document.documentElement.style.userSelect = 'none';

    document.body.classList.add('limenote-crop-editor-open');
    document.documentElement.classList.add('limenote-crop-editor-open');

    const style = document.createElement('style');
    style.setAttribute('data-limenote-crop-editor-lock', 'true');
    style.textContent = `
      html.limenote-crop-editor-open,
      body.limenote-crop-editor-open {
        overflow: hidden !important;
        overscroll-behavior: none !important;
        touch-action: none !important;
        -webkit-user-select: none !important;
        user-select: none !important;
      }

      .limenote-crop-editor-overlay,
      .limenote-crop-editor-overlay * {
        touch-action: none !important;
        -webkit-user-select: none !important;
        user-select: none !important;
        -webkit-touch-callout: none !important;
      }
    `;
    document.head.appendChild(style);

    const preventNativeGesture = (event: Event) => {
      // iOS Safari のページ全体ズームだけ止める。stopPropagation すると画像枠側のピンチ処理まで止まる。
      if (event.cancelable) event.preventDefault();
    };

    const preventEditorTouchZoom = (event: TouchEvent) => {
      if (event.touches.length < 2) return;
      // 2本指ジェスチャーをブラウザズームへ渡さない。ただし画像枠側のtouch handlerには届かせる。
      if (event.cancelable) event.preventDefault();
    };

    const preventCtrlWheelZoom = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      if (event.cancelable) event.preventDefault();
    };

    const options: AddEventListenerOptions = { passive: false, capture: true };
    const gestureTargets: Array<Window | Document | HTMLElement> = [window, document, document.documentElement, document.body];

    gestureTargets.forEach((target) => {
      target.addEventListener('gesturestart', preventNativeGesture as EventListener, options);
      target.addEventListener('gesturechange', preventNativeGesture as EventListener, options);
      target.addEventListener('gestureend', preventNativeGesture as EventListener, options);
      target.addEventListener('touchstart', preventEditorTouchZoom, options);
      target.addEventListener('touchmove', preventEditorTouchZoom, options);
      target.addEventListener('wheel', preventCtrlWheelZoom as EventListener, options);
    });

    return () => {
      document.body.style.overflow = previous.bodyOverflow;
      document.documentElement.style.overflow = previous.htmlOverflow;
      document.body.style.overscrollBehavior = previous.bodyOverscrollBehavior;
      document.documentElement.style.overscrollBehavior = previous.htmlOverscrollBehavior;
      document.body.style.touchAction = previous.bodyTouchAction;
      document.documentElement.style.touchAction = previous.htmlTouchAction;
      document.body.style.userSelect = previous.bodyUserSelect;
      document.documentElement.style.userSelect = previous.htmlUserSelect;
      document.body.classList.remove('limenote-crop-editor-open');
      document.documentElement.classList.remove('limenote-crop-editor-open');
      style.remove();

      gestureTargets.forEach((target) => {
        target.removeEventListener('gesturestart', preventNativeGesture as EventListener, options);
        target.removeEventListener('gesturechange', preventNativeGesture as EventListener, options);
        target.removeEventListener('gestureend', preventNativeGesture as EventListener, options);
        target.removeEventListener('touchstart', preventEditorTouchZoom, options);
        target.removeEventListener('touchmove', preventEditorTouchZoom, options);
        target.removeEventListener('wheel', preventCtrlWheelZoom as EventListener, options);
      });
    };
  }, [editingImageSrc]);

  const getCropBoxSize = useCallback(() => {
    const rect = cropBoxRef.current?.getBoundingClientRect();
    return {
      width: cropBoxSize.width || rect?.width || 320,
      height: cropBoxSize.height || rect?.height || 320,
    };
  }, [cropBoxSize.height, cropBoxSize.width]);

  const clampCropOffset = useCallback((nextOffset: CropOffset, nextZoom = cropZoom) => {
    if (!cropImageSize.width || !cropImageSize.height) return nextOffset;

    const box = getCropBoxSize();
    const baseScale = cropAspectId === 'original'
      ? Math.min(box.width / cropImageSize.width, box.height / cropImageSize.height)
      : Math.max(box.width / cropImageSize.width, box.height / cropImageSize.height);
    const scale = baseScale * nextZoom;
    const renderedWidth = cropImageSize.width * scale;
    const renderedHeight = cropImageSize.height * scale;
    const maxX = Math.max(0, (renderedWidth - box.width) / 2);
    const maxY = Math.max(0, (renderedHeight - box.height) / 2);

    return {
      x: Math.min(maxX, Math.max(-maxX, nextOffset.x)),
      y: Math.min(maxY, Math.max(-maxY, nextOffset.y)),
    };
  }, [cropAspectId, cropImageSize.height, cropImageSize.width, cropZoom, getCropBoxSize]);

  const applyCropTransformRaf = useCallback((nextZoom: number, nextOffset: CropOffset) => {
    if (cropRafRef.current !== null) {
      window.cancelAnimationFrame(cropRafRef.current);
    }

    cropRafRef.current = window.requestAnimationFrame(() => {
      cropRafRef.current = null;
      setCropZoom(nextZoom);
      setCropOffset(nextOffset);
    });
  }, []);

  const openImageEditor = useCallback((index: number) => {
    cropPointersRef.current.clear();
    cropNativeTouchRef.current.active = false;
    cropNativeTouchRef.current.mode = null;
    cropDragRef.current.dragging = false;
    cropPinchRef.current = { active: false, startDistance: 0, startZoom: 1 };
    if (cropRafRef.current !== null) {
      window.cancelAnimationFrame(cropRafRef.current);
      cropRafRef.current = null;
    }
    cropImageElementRef.current = null;
    setEditingImageIndex(index);
    setCropAspectId('original');
    setCropZoom(1);
    setCropOffset({ x: 0, y: 0 });
    setCropImageSize({ width: 0, height: 0 });
    setCropBoxSize({ width: 0, height: 0 });
    setCropStageSize({ width: 0, height: 0 });
  }, []);

  const closeImageEditor = useCallback(() => {
    cropPointersRef.current.clear();
    cropNativeTouchRef.current.active = false;
    cropNativeTouchRef.current.mode = null;
    cropDragRef.current.dragging = false;
    cropPinchRef.current = { active: false, startDistance: 0, startZoom: 1 };
    if (cropRafRef.current !== null) {
      window.cancelAnimationFrame(cropRafRef.current);
      cropRafRef.current = null;
    }
    cropImageElementRef.current = null;
    setEditingImageIndex(null);
    setCropAspectId('original');
    setCropZoom(1);
    setCropOffset({ x: 0, y: 0 });
    setCropImageSize({ width: 0, height: 0 });
    setCropBoxSize({ width: 0, height: 0 });
    setCropStageSize({ width: 0, height: 0 });
  }, []);

  useEffect(() => {
    if (!editingImageSrc) return;

    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      cropImageElementRef.current = img;
      setCropImageSize({ width: img.naturalWidth, height: img.naturalHeight });
      setCropOffset({ x: 0, y: 0 });
      setCropZoom(1);
    };
    img.onerror = () => {
      if (!cancelled) toast.error('画像を読み込めませんでした');
    };
    img.src = editingImageSrc;

    return () => {
      cancelled = true;
    };
  }, [editingImageSrc]);

  useEffect(() => {
    if (!editingImageSrc || !cropStageRef.current) return;

    const target = cropStageRef.current;
    const updateCropStageSize = () => {
      const rect = target.getBoundingClientRect();
      setCropStageSize({ width: rect.width, height: rect.height });
    };

    updateCropStageSize();

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateCropStageSize) : null;
    observer?.observe(target);
    window.addEventListener('resize', updateCropStageSize);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateCropStageSize);
    };
  }, [editingImageSrc]);

  useEffect(() => {
    if (!editingImageSrc || !cropBoxRef.current) return;

    const target = cropBoxRef.current;
    const updateCropBoxSize = () => {
      const rect = target.getBoundingClientRect();
      setCropBoxSize({ width: rect.width, height: rect.height });
    };

    updateCropBoxSize();

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateCropBoxSize) : null;
    observer?.observe(target);
    window.addEventListener('resize', updateCropBoxSize);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateCropBoxSize);
    };
  }, [cropAspectId, editingImageSrc]);

  useEffect(() => {
    if (editingImageIndex === null) return;
    setCropOffset((current) => clampCropOffset(current, cropZoom));
  }, [clampCropOffset, cropAspectId, cropBoxSize.height, cropBoxSize.width, cropImageSize.height, cropImageSize.width, cropZoom, editingImageIndex]);

  useEffect(() => {
    if (editingImageIndex === null) return;

    const handlePointerMove = (event: PointerEvent) => {
      const pointers = cropPointersRef.current;
      if (Date.now() < suppressPointerUntilRef.current) return;

      if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      if (pointers.size >= 2) {
        event.preventDefault();
        cropDragRef.current.dragging = false;
        const [first, second] = Array.from(pointers.values()) as CropPointer[];
        const distance = getPointerDistance(first, second);

        if (!cropPinchRef.current.active || cropPinchRef.current.startDistance <= 0) {
          cropPinchRef.current = { active: true, startDistance: distance, startZoom: cropZoomRef.current };
          return;
        }

        const nextZoom = clampCropZoomValue(cropPinchRef.current.startZoom * (distance / cropPinchRef.current.startDistance));
        applyCropTransformRaf(nextZoom, clampCropOffset(cropOffsetRef.current, nextZoom));
        return;
      }

      if (!cropDragRef.current.dragging) return;

      event.preventDefault();
      const dx = event.clientX - cropDragRef.current.startX;
      const dy = event.clientY - cropDragRef.current.startY;
      applyCropTransformRaf(
        cropZoomRef.current,
        clampCropOffset({
          x: cropDragRef.current.baseX + dx,
          y: cropDragRef.current.baseY + dy,
        })
      );
    };

    const handlePointerUp = (event: PointerEvent) => {
      const pointers = cropPointersRef.current;
      pointers.delete(event.pointerId);

      if (pointers.size === 0) {
        cropDragRef.current.dragging = false;
        cropPinchRef.current = { active: false, startDistance: 0, startZoom: cropZoomRef.current };
        return;
      }

      if (pointers.size === 1) {
        const remaining = (Array.from(pointers.values()) as CropPointer[])[0];
        cropPinchRef.current = { active: false, startDistance: 0, startZoom: cropZoomRef.current };
        cropDragRef.current = {
          dragging: true,
          startX: remaining.x,
          startY: remaining.y,
          baseX: cropOffsetRef.current.x,
          baseY: cropOffsetRef.current.y,
        };
      }
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      cropPointersRef.current.clear();
      cropDragRef.current.dragging = false;
      cropPinchRef.current = { active: false, startDistance: 0, startZoom: cropZoomRef.current };
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [applyCropTransformRaf, clampCropOffset, editingImageIndex]);

  const startCropGesture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (Date.now() < suppressPointerUntilRef.current) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const pointers = cropPointersRef.current;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2) {
      const [first, second] = Array.from(pointers.values()) as CropPointer[];
      cropDragRef.current.dragging = false;
      cropPinchRef.current = {
        active: true,
        startDistance: getPointerDistance(first, second),
        startZoom: cropZoomRef.current,
      };
      return;
    }

    cropPinchRef.current = { active: false, startDistance: 0, startZoom: cropZoomRef.current };
    cropDragRef.current = {
      dragging: true,
      startX: event.clientX,
      startY: event.clientY,
      baseX: cropOffsetRef.current.x,
      baseY: cropOffsetRef.current.y,
    };
  }, []);

  const applyCropZoom = useCallback((nextZoomValue: number) => {
    const nextZoom = clampCropZoomValue(nextZoomValue);
    setCropZoom(nextZoom);
    setCropOffset((current) => clampCropOffset(current, nextZoom));
  }, [clampCropOffset]);

  const handleCropZoomChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    applyCropZoom(Number(event.target.value));
  }, [applyCropZoom]);

  useEffect(() => {
    if (!editingImageSrc || !cropBoxRef.current) return;

    const target = cropBoxRef.current;

    const midpoint = (first: Touch, second: Touch) => ({
      x: (first.clientX + second.clientX) / 2,
      y: (first.clientY + second.clientY) / 2,
    });

    const handleNativeWheel = (event: WheelEvent) => {
      if (!target.contains(event.target as Node)) return;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      const nextZoom = clampCropZoomValue(cropZoomRef.current - event.deltaY * 0.0014);
      applyCropTransformRaf(nextZoom, clampCropOffset(cropOffsetRef.current, nextZoom));
    };

    const handleNativeTouchStart = (event: TouchEvent) => {
      if (!target.contains(event.target as Node)) return;
      suppressPointerUntilRef.current = Date.now() + 450;
      cropPointersRef.current.clear();
      cropDragRef.current.dragging = false;

      if (event.cancelable) event.preventDefault();
      event.stopPropagation();

      if (event.touches.length >= 2) {
        const [first, second] = [event.touches[0], event.touches[1]];
        const mid = midpoint(first, second);
        cropNativeTouchRef.current = {
          active: true,
          mode: 'pinch',
          startX: first.clientX,
          startY: first.clientY,
          startMidX: mid.x,
          startMidY: mid.y,
          startDistance: getPointerDistance(
            { x: first.clientX, y: first.clientY },
            { x: second.clientX, y: second.clientY }
          ),
          startZoom: cropZoomRef.current,
          baseX: cropOffsetRef.current.x,
          baseY: cropOffsetRef.current.y,
        };
        return;
      }

      const first = event.touches[0];
      cropNativeTouchRef.current = {
        active: true,
        mode: 'drag',
        startX: first.clientX,
        startY: first.clientY,
        startMidX: first.clientX,
        startMidY: first.clientY,
        startDistance: 0,
        startZoom: cropZoomRef.current,
        baseX: cropOffsetRef.current.x,
        baseY: cropOffsetRef.current.y,
      };
    };

    const handleNativeTouchMove = (event: TouchEvent) => {
      if (!target.contains(event.target as Node)) return;
      suppressPointerUntilRef.current = Date.now() + 450;

      if (event.cancelable) event.preventDefault();
      event.stopPropagation();

      const state = cropNativeTouchRef.current;
      if (!state.active) return;

      if (event.touches.length >= 2) {
        const [first, second] = [event.touches[0], event.touches[1]];
        const currentDistance = getPointerDistance(
          { x: first.clientX, y: first.clientY },
          { x: second.clientX, y: second.clientY }
        );
        const currentMid = midpoint(first, second);
        const startDistance = state.mode === 'pinch' && state.startDistance > 0
          ? state.startDistance
          : currentDistance;
        const startZoom = state.mode === 'pinch' ? state.startZoom : cropZoomRef.current;
        const baseX = state.mode === 'pinch' ? state.baseX : cropOffsetRef.current.x;
        const baseY = state.mode === 'pinch' ? state.baseY : cropOffsetRef.current.y;
        const startMidX = state.mode === 'pinch' ? state.startMidX : currentMid.x;
        const startMidY = state.mode === 'pinch' ? state.startMidY : currentMid.y;

        if (state.mode !== 'pinch') {
          cropNativeTouchRef.current = {
            ...state,
            mode: 'pinch',
            startDistance,
            startZoom,
            startMidX,
            startMidY,
            baseX,
            baseY,
          };
        }

        const nextZoom = clampCropZoomValue(startZoom * (currentDistance / Math.max(1, startDistance)));
        const nextOffset = clampCropOffset({
          x: baseX + (currentMid.x - startMidX),
          y: baseY + (currentMid.y - startMidY),
        }, nextZoom);
        applyCropTransformRaf(nextZoom, nextOffset);
        return;
      }

      const first = event.touches[0];
      if (!first) return;

      if (state.mode !== 'drag') {
        cropNativeTouchRef.current = {
          active: true,
          mode: 'drag',
          startX: first.clientX,
          startY: first.clientY,
          startMidX: first.clientX,
          startMidY: first.clientY,
          startDistance: 0,
          startZoom: cropZoomRef.current,
          baseX: cropOffsetRef.current.x,
          baseY: cropOffsetRef.current.y,
        };
        return;
      }

      applyCropTransformRaf(
        cropZoomRef.current,
        clampCropOffset({
          x: state.baseX + (first.clientX - state.startX),
          y: state.baseY + (first.clientY - state.startY),
        })
      );
    };

    const handleNativeTouchEnd = (event: TouchEvent) => {
      if (event.cancelable && event.touches.length > 0) event.preventDefault();
      event.stopPropagation();

      if (event.touches.length === 1) {
        const first = event.touches[0];
        cropNativeTouchRef.current = {
          active: true,
          mode: 'drag',
          startX: first.clientX,
          startY: first.clientY,
          startMidX: first.clientX,
          startMidY: first.clientY,
          startDistance: 0,
          startZoom: cropZoomRef.current,
          baseX: cropOffsetRef.current.x,
          baseY: cropOffsetRef.current.y,
        };
        return;
      }

      cropNativeTouchRef.current.active = false;
      cropNativeTouchRef.current.mode = null;
    };

    const options: AddEventListenerOptions = { passive: false, capture: true };
    target.addEventListener('wheel', handleNativeWheel, options);
    target.addEventListener('touchstart', handleNativeTouchStart, options);
    target.addEventListener('touchmove', handleNativeTouchMove, options);
    target.addEventListener('touchend', handleNativeTouchEnd, options);
    target.addEventListener('touchcancel', handleNativeTouchEnd, options);

    return () => {
      target.removeEventListener('wheel', handleNativeWheel, options);
      target.removeEventListener('touchstart', handleNativeTouchStart, options);
      target.removeEventListener('touchmove', handleNativeTouchMove, options);
      target.removeEventListener('touchend', handleNativeTouchEnd, options);
      target.removeEventListener('touchcancel', handleNativeTouchEnd, options);
    };
  }, [applyCropTransformRaf, clampCropOffset, editingImageSrc]);

  const selectCropAspect = useCallback((nextAspectId: CropAspectId) => {
    setCropAspectId(nextAspectId);

    if (nextAspectId === 'original') {
      // 一番左のアイコンは「原寸」。画像本来の縦横比に戻し、全体が見える状態へ戻す。
      setCropZoom(1);
      setCropOffset({ x: 0, y: 0 });
      return;
    }

    // その他の比率変更ではズームや位置を初期化しない。
    // 画像の位置を保ったまま、変更後の枠内に収まる分だけ補正する。
    window.requestAnimationFrame(() => {
      setCropOffset((current) => clampCropOffset(current, cropZoom));
    });
  }, [clampCropOffset, cropZoom]);

  const saveCroppedImage = useCallback(async () => {
    if (editingImageIndex === null || !editingImageSrc || !cropImageSize.width || !cropImageSize.height) return;

    const box = getCropBoxSize();
    const baseScale = cropAspectId === 'original'
      ? Math.min(box.width / cropImageSize.width, box.height / cropImageSize.height)
      : Math.max(box.width / cropImageSize.width, box.height / cropImageSize.height);
    const scale = baseScale * cropZoom;
    const sourceWidth = Math.min(cropImageSize.width, box.width / scale);
    const sourceHeight = Math.min(cropImageSize.height, box.height / scale);
    const centerX = cropImageSize.width / 2 - cropOffset.x / scale;
    const centerY = cropImageSize.height / 2 - cropOffset.y / scale;
    const sourceX = Math.min(cropImageSize.width - sourceWidth, Math.max(0, centerX - sourceWidth / 2));
    const sourceY = Math.min(cropImageSize.height - sourceHeight, Math.max(0, centerY - sourceHeight / 2));

    const isOriginalUntouched =
      cropAspectId === 'original' &&
      Math.abs(cropZoom - 1) < 0.001 &&
      Math.abs(cropOffset.x) < 0.5 &&
      Math.abs(cropOffset.y) < 0.5;

    if (isOriginalUntouched) {
      const previousUrl = previewsRef.current[editingImageIndex];
      const originalUrl = previewOriginalsRef.current[editingImageIndex] ?? editingImageSrc;
      setPreviews((current) => current.map((src, index) => (index === editingImageIndex ? originalUrl : src)));
      if (previousUrl && previousUrl !== originalUrl) URL.revokeObjectURL(previousUrl);
      closeImageEditor();
      return;
    }

    let img = cropImageElementRef.current;
    if (!img || !img.complete || !img.naturalWidth || !img.naturalHeight) {
      img = new Image();
      await new Promise<void>((resolve, reject) => {
        img!.onload = () => resolve();
        img!.onerror = () => reject(new Error('crop image load failed'));
        img!.src = editingImageSrc;
      });
      cropImageElementRef.current = img;
    }

    const canvas = document.createElement('canvas');
    canvas.width = selectedCropAspect.outputWidth;
    canvas.height = selectedCropAspect.outputHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      toast.error('画像編集に失敗しました');
      return;
    }

    ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) {
      toast.error('画像編集に失敗しました');
      return;
    }

    const nextUrl = URL.createObjectURL(blob);
    const previousUrl = previewsRef.current[editingImageIndex];
    const originalUrl = previewOriginalsRef.current[editingImageIndex];

    setPreviews((current) => current.map((src, index) => (index === editingImageIndex ? nextUrl : src)));
    if (previousUrl && previousUrl !== originalUrl) URL.revokeObjectURL(previousUrl);
    closeImageEditor();
  }, [closeImageEditor, cropImageSize.height, cropImageSize.width, cropOffset.x, cropOffset.y, cropZoom, editingImageIndex, editingImageSrc, getCropBoxSize, cropAspectId, selectedCropAspect.outputHeight, selectedCropAspect.outputWidth]);

  const handleContentChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const pos = e.target.selectionStart;
    setContent(val);
    setCursorPosition(pos);

    const lastAtIdx = val.lastIndexOf('@', pos - 1);
    const lastHashIdx = val.lastIndexOf('#', pos - 1);

    // メンション判定
    if (lastAtIdx !== -1 && (lastHashIdx === -1 || lastAtIdx > lastHashIdx)) {
      const query = val.slice(lastAtIdx + 1, pos);
      if (!query.includes(' ') && !query.includes('\n')) {
        setMentionQuery(query);
        setHashtagQuery(null);
        updatePopupPosition(pos);
        return;
      }
    }
    
    // ハッシュタグ判定 (追加)
    if (lastHashIdx !== -1 && (lastAtIdx === -1 || lastHashIdx > lastAtIdx)) {
      const query = val.slice(lastHashIdx + 1, pos);
      if (!query.includes(' ') && !query.includes('\n')) {
        setHashtagQuery(query);
        setMentionQuery(null);
        updatePopupPosition(pos);
        return;
      }
    }

    setMentionQuery(null);
    setHashtagQuery(null);
  };

  const updatePopupPosition = (pos: number) => {
    if (textareaRef.current) {
      const coords = getCaretCoordinates(textareaRef.current, pos);
      setPopupPos({ 
        top: coords.top + coords.height, 
        left: Math.min(coords.left, 150) 
      });
    }
  };

  const handleScroll = (e: ReactUIEvent<HTMLTextAreaElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  const selectMention = (username: string) => {
    const lastAtIdx = content.lastIndexOf('@', cursorPosition - 1);
    const beforeAt = content.slice(0, lastAtIdx);
    const afterCursor = content.slice(cursorPosition);
    const newContent = `${beforeAt}@${username} ${afterCursor}`;
    setContent(newContent);
    setMentionQuery(null);
    setMentionResults([]);
    if (textareaRef.current) textareaRef.current.focus();
  };

  const selectHashtag = (tag: string) => {
    const lastHashIdx = content.lastIndexOf('#', cursorPosition - 1);
    const beforeHash = content.slice(0, lastHashIdx);
    const afterCursor = content.slice(cursorPosition);
    const newContent = `${beforeHash}#${tag} ${afterCursor}`;
    setContent(newContent);
    setHashtagQuery(null);
    setHashtagResults([]);
    if (textareaRef.current) textareaRef.current.focus();
  };

  const onFile = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    addImageFiles(Array.from(e.target.files ?? []));
    if (fileRef.current) fileRef.current.value = '';
  }, [addImageFiles]);

  const removePreview = useCallback((i: number) => {
    const previewUrl = previewsRef.current[i];
    const originalUrl = previewOriginalsRef.current[i];
    if (previewUrl && previewUrl !== originalUrl) URL.revokeObjectURL(previewUrl);
    if (originalUrl) URL.revokeObjectURL(originalUrl);

    setPreviews((p) => p.filter((_, idx) => idx !== i));
    setPreviewOriginals((p) => p.filter((_, idx) => idx !== i));
    setEditingImageIndex((current) => {
      if (current === null) return null;
      if (current === i) return null;
      return current > i ? current - 1 : current;
    });
  }, []);

  const cancelQuote = useCallback(() => {
    setSearchParams({});
    setQuotedPost(null);
  }, [setSearchParams]);

  const submit = async () => {
    if (!user) return;

    const trimmed = content.trim();
    if (!trimmed) {
      toast.error('本文を入力してください');
      return;
    }
    if (trimmed.length > MAX_LEN) {
      toast.error(`本文は${MAX_LEN}文字以内で入力してください`);
      return;
    }
    try {
      // 投稿処理を先に実行し、確実に完了を待つ (visibilityを追加)
      await mutateAsync({ 
        content: trimmed, 
        imageUrls: previews,
        parentId: quotedPost?.id,
        isQuote: !!quotedPost,
        user_id: user.id,
        visibility: visibility // 追加
      } as any);

      // ハッシュタグの抽出と統計更新 (投稿後に非同期で実行)
      const hashtagRegex = /#([a-zA-Z0-9_\u3041-\u3094\u30a1-\u30fa\u30fc\u4e00-\u9fa5]+)/g;
      const matches = trimmed.match(hashtagRegex);
      if (matches) {
        const uniqueTags = Array.from(new Set(matches.map(tag => tag.slice(1))));
        // 各ハッシュタグの処理。エラーが起きても全体が止まらないように個別にcatch
        uniqueTags.forEach(async (tag) => {
          try {
            await supabase.rpc('upsert_hashtag', { tag_name: tag });
          } catch (e) {
            console.warn(`Hashtag upsert failed for #${tag}:`, e);
          }
        });
      }

      setContent('');
      const urls = new Set([...previewsRef.current, ...previewOriginalsRef.current]);
      urls.forEach((url) => URL.revokeObjectURL(url));
      setPreviews([]);
      setPreviewOriginals([]);
      setVisibility('public'); // リセット
      cancelQuote();
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error("Submission failed:", err);
      /* エラーはHook側で処理されるが、デバッグ用にログ出力 */
    }
  };

  // メンション・ハッシュタグ部分のテキスト色付け描画
  const renderHighlightedText = (text: string) => {
    const regex = /(@[a-zA-Z0-9_]+|#[a-zA-Z0-9_\u3041-\u3094\u30a1-\u30fa\u30fc\u4e00-\u9fa5]+)/g;
    const parts = text.split(regex);
    return parts.map((part, i) => {
      if (part.match(regex)) {
        return <span key={i} className="text-primary ">{part}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  const remaining = MAX_LEN - content.length;
  const overLimit = remaining < 0;

  if (!user) return null;

  return (
    <>
      <div
        className={cn(
        "rounded-3xl bg-card p-5 shadow-soft transition-all duration-300",
        timelineGlass &&
          "border border-border/45 bg-card/70 shadow-none backdrop-blur-2xl supports-[backdrop-filter]:bg-card/60"
      )}
    >
      {onCancel && (
        <div className="mb-2 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full hover:bg-muted"
            onClick={onCancel}
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </Button>
        </div>
      )}
      <div className="flex gap-3">
        <Avatar className="h-11 w-11 border-2 border-primary/30 shrink-0">
          <AvatarImage src={user.avatarUrl} alt={user.displayName} />
          <AvatarFallback>{user.displayName.slice(0, 1)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0 space-y-3 relative" ref={containerRef}>
          
          <div className="relative w-full overflow-hidden">
            {!content && (
              <div className="absolute inset-0 pointer-events-none px-0 py-2 text-[20px] leading-relaxed text-muted-foreground z-0">
                {quotedPost ? "コメントを添えてリポスト" : "いまどうしてる？"}
              </div>
            )}

            <div
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none whitespace-pre-wrap break-words px-0 py-2 text-[20px] leading-relaxed text-foreground z-0"
              style={{ transform: `translateY(-${scrollTop}px)` }}
            >
              {renderHighlightedText(content)}
              {content.endsWith('\n') ? <br /> : null}
            </div>

            <Textarea
              ref={textareaRef}
              value={content}
              onChange={handleContentChange}
              onPaste={handlePaste}
              onScroll={handleScroll}
              rows={3}
              spellCheck={false}
              className="relative z-10 resize-none border-0 bg-transparent px-0 py-2 text-[20px] leading-relaxed shadow-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none outline-none w-full text-transparent selection:bg-[#b4d7ff] selection:text-black dark:selection:bg-[#385474] dark:selection:text-white"
              style={{ color: "transparent", caretColor: "hsl(var(--foreground))" }}
            />
          </div>

          {/* 候補ポップアップ */}
          {(mentionResults.length > 0 && mentionQuery !== null) && (
            <div 
              className={cn("absolute z-[2147483647] w-64 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-xl backdrop-blur-md transition-all duration-150", timelineGlass && "bg-popover/85 backdrop-blur-xl")}
              style={{ top: popupPos.top - scrollTop, left: popupPos.left, zIndex: 2147483647 }}
            >
              <div className="p-2 text-xs font-bold text-muted-foreground bg-muted/30 flex items-center gap-1">
                <AtSign className="w-3 h-3" /> メンションします
              </div>
              {mentionResults.map((result) => (
                <button
                  key={result.id}
                  onClick={() => selectMention(result.username)}
                  className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-accent focus:bg-accent outline-none"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={result.avatar_url} />
                    <AvatarFallback>{result.username[0]}</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold truncate leading-none mb-1">
                      {result.display_name || result.username}
                    </span>
                    <span className="text-xs text-muted-foreground leading-none">
                      @{result.username}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {hashtagResults.length > 0 && hashtagQuery !== null && (
            <div 
              className={cn("absolute z-[2147483647] w-64 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-xl backdrop-blur-md transition-all duration-150", timelineGlass && "bg-popover/85 backdrop-blur-xl")}
              style={{ top: popupPos.top - scrollTop, left: popupPos.left, zIndex: 2147483647 }}
            >
              <div className="p-2 text-xs font-bold text-muted-foreground bg-muted/30 flex items-center gap-1">
                <Hash className="w-3 h-3" /> ハッシュタグを検索
              </div>
              {hashtagResults.map((result, idx) => (
                <button
                  key={idx}
                  onClick={() => selectHashtag(result.tag)}
                  className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-accent focus:bg-accent outline-none"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                    <Hash className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-bold truncate">#{result.tag}</span>
                </button>
              ))}
            </div>
          )}

          {quotedPost && (
            <div className={cn("relative mt-2 overflow-hidden rounded-2xl border border-border/60 bg-muted/20 p-4 transition-all", timelineGlass && "bg-background/35 backdrop-blur-xl")}>
              {!initialQuotedPost && (
                <button
                  type="button"
                  onClick={cancelQuote}
                  className="absolute right-2 top-2 z-10 rounded-full bg-background/80 p-1 backdrop-blur hover:bg-background"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
              
              <div className="flex items-center gap-2 mb-1.5">
                <Avatar className="h-5 w-5">
                  <AvatarImage src={quotedPost.author.avatarUrl} />
                  <AvatarFallback>{quotedPost.author.displayName[0]}</AvatarFallback>
                </Avatar>
                <span className="text-sm font-bold text-foreground truncate">{quotedPost.author.displayName}</span>
                <span className="text-xs text-muted-foreground">@{quotedPost.author.username}</span>
                <span className="text-xs text-muted-foreground">· {formatRelative(quotedPost.createdAt)}</span>
              </div>
              <p className="text-[14px] text-foreground line-clamp-2 leading-snug whitespace-pre-wrap">
                {quotedPost.content}
              </p>
              {quotedPost.imageUrls.length > 0 && (
                <div className="mt-2 text-xs text-accent font-bold">
                  [画像あり]
                </div>
              )}
            </div>
          )}

          {previews.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {previews.map((src, i) => (
                <div key={src} className="relative overflow-hidden rounded-2xl border border-border/60">
                  <img src={src} alt="" className="aspect-square w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => openImageEditor(i)}
                    className="absolute left-1.5 top-1.5 inline-flex items-center rounded-full bg-black/55 px-3 py-1.5 text-xs font-bold text-white shadow-sm backdrop-blur-md transition hover:bg-black/70"
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    onClick={() => removePreview(i)}
                    className="absolute right-1.5 top-1.5 rounded-full bg-background/80 p-1 backdrop-blur transition hover:bg-background"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className={cn("flex items-center justify-between border-t border-border/60 pt-3", timelineGlass && "border-border/40")}>
            <div className="flex items-center gap-2">
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFile} />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-9 rounded-full text-accent hover:bg-accent-soft hover:text-accent"
                onClick={() => fileRef.current?.click()}
                disabled={previews.length >= MAX_IMAGES}
              >
                <ImagePlus className="sm:mr-1.5 h-4 w-4" />
                <span className="hidden sm:inline">画像</span>
              </Button>

              {/* 公開範囲選択 (追加) */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-9 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {visibility === 'public' ? (
                      <>
                        <Globe className="sm:mr-1.5 h-4 w-4" />
                        <span className="hidden sm:inline">全員</span>
                      </>
                    ) : (
                      <>
                        <Users className="sm:mr-1.5 h-4 w-4 text-accent" />
                        <span className="text-accent hidden sm:inline">限定</span>
                      </>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  sideOffset={8}
                  className="z-[2147483647] rounded-xl"
                  style={{ zIndex: 2147483647 }}
                >
                  <DropdownMenuItem onClick={() => setVisibility('public')}>
                    <Globe className="mr-2 h-4 w-4" />
                    全員
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setVisibility('following')}>
                    <Users className="mr-2 h-4 w-4" />
                    フォロー中
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <span className={cn('text-xs tabular-nums', overLimit ? 'font-bold text-destructive' : 'text-muted-foreground')}>
                {remaining}
              </span>
            </div>
            <Button
              type="button"
              onClick={submit}
              disabled={isPending || overLimit || !content.trim()}
              className="rounded-full bg-gradient-primary px-5 font-bold shadow-soft transition hover:shadow-pop"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Send className="mr-1.5 h-4 w-4" />
                  {quotedPost ? '引用ポスト' : 'ポスト'}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
      </div>
      {editingImageSrc && typeof document !== 'undefined' && createPortal(
        <div
          className="limenote-crop-editor-overlay fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/78 p-2 sm:p-3 backdrop-blur-sm"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeImageEditor();
          }}
        >
          <div className="flex h-[min(92svh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border/60 bg-card text-card-foreground shadow-2xl">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border/60 px-4">
              <button
                type="button"
                onClick={closeImageEditor}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="編集を閉じる"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="text-lg font-black">メディアをトリミング</div>
              <Button type="button" size="sm" className="rounded-full px-4 font-bold" onClick={saveCroppedImage}>
                保存
              </Button>
            </div>

            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2 sm:p-4">
              <div ref={cropStageRef} className="relative mx-auto flex h-full w-full max-w-[620px] items-center justify-center overflow-hidden bg-transparent touch-none select-none">
                <div
                  ref={cropBoxRef}
                  className="relative z-10 cursor-grab overflow-hidden bg-transparent shadow-2xl touch-none select-none active:cursor-grabbing"
                  style={{
                    width: `${cropFrameSize.width}px`,
                    height: `${cropFrameSize.height}px`,
                    maxWidth: '100%',
                    maxHeight: '100%',
                    aspectRatio: `${selectedCropAspect.width} / ${selectedCropAspect.height}`,
                    touchAction: 'none',
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  }}
                  onPointerDown={startCropGesture}
                >
                  <div
                    className="absolute inset-0 bg-center bg-no-repeat"
                    style={{
                      backgroundImage: `url(${editingImageSrc})`,
                      backgroundSize: cropImageSize.width && cropImageSize.height
                        ? (() => {
                            const baseScale = cropAspectId === 'original'
                              ? Math.min((cropBoxSize.width || 320) / cropImageSize.width, (cropBoxSize.height || 320) / cropImageSize.height)
                              : Math.max((cropBoxSize.width || 320) / cropImageSize.width, (cropBoxSize.height || 320) / cropImageSize.height);

                            return `${cropImageSize.width * baseScale * cropZoom}px ${cropImageSize.height * baseScale * cropZoom}px`;
                          })()
                        : 'contain',
                      backgroundPosition: `calc(50% + ${cropOffset.x}px) calc(50% + ${cropOffset.y}px)`,
                    }}
                  />
                  <div className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-accent" />
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 border-t border-border/60 px-3 py-3 sm:gap-3 sm:px-4">
              <div className="flex shrink-0 items-center gap-2">
                {CROP_ASPECT_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => selectCropAspect(option.id)}
                    className={cn(
                      'inline-flex h-9 w-9 items-center justify-center rounded-full transition',
                      cropAspectId === option.id
                        ? 'text-accent'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                    aria-label={`${option.label}でトリミング`}
                    title={option.label}
                  >
                    {(() => {
                      const iconSize = getCropAspectIconSize(option);

                      return (
                        <span
                          className={cn(
                            'block rounded-[3px] border-2',
                            cropAspectId === option.id ? 'border-current' : 'border-current/70'
                          )}
                          style={{ width: `${iconSize.width}px`, height: `${iconSize.height}px` }}
                        />
                      );
                    })()}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => applyCropZoom(cropZoom - 0.15)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="縮小"
              >
                −
              </button>
              <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={cropZoom}
                onChange={handleCropZoomChange}
                className="min-w-0 flex-1 accent-current"
              />
              <button
                type="button"
                onClick={() => applyCropZoom(cropZoom + 0.15)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="拡大"
              >
                +
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

const PostOverlay = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center bg-black/50 p-4 pt-16 sm:items-center sm:pt-4 overflow-y-auto">
      <div 
        className="fixed inset-0" 
        onClick={onClose} 
      />
      <div className="relative w-full max-w-xl animate-in fade-in zoom-in-95 duration-200">
        <PostComposer onSuccess={onClose} onCancel={onClose} />
      </div>
    </div>
  );
};

// コンポーネントツリー内で useLocation を利用できるようにするためのラッパーコンポーネント
const AppContent = () => {
  const [isPostModalOpen, setPostModalOpen] = useState(false);
  const isFABVisible = useScrollDirection();
  const { pathname } = useLocation();

  // 大文字小文字の違い（/CHAT または /chat）を許容するため、小文字に変換して判定
  const isChatPage = pathname.toLowerCase() === "/chat" || pathname.toLowerCase() === "/ramunotesns.github.io/chat";
const lowerPath = pathname.toLowerCase();
const isAuthPage = lowerPath.includes("/auth");
const isTermsPage = lowerPath.includes("/terms");
const isPostDetailPage = lowerPath.includes("/post/");
const isMediaPage = lowerPath === "/media" || lowerPath.startsWith("/media/");

// いずれかの非表示対象ページであるか、またはスクロールによって非表示にするか
const shouldHideFAB = !isFABVisible || isChatPage || isAuthPage || isTermsPage || isMediaPage || isPostDetailPage;

  return (
    <>
      <ScrollToTop />
      
      <AuthProvider>
        <NotificationWatcher />
        <LimeDropReceiver />
        <EmojiRainEffect /> 
        
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route element={<AppLayout />}>
            <Route path="/" element={<Feed />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/news" element={<NewsPage />} />
            <Route path="/chat" element={<ChatPage />} /> {/* AIチャットページのルーティングを追加 */}
            <Route path="/post/:id" element={<PostDetail />} />
            <Route path="/post/:postId/activity" element={<PostActivity />} />
            <Route path="/u/:username" element={<Profile />} />
            <Route path="/u/:username/followers_following" element={<FollowersFollowingPage />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/share" element={<Share />} />
            <Route path="/spaces/:id" element={<SpacePage />} />
            <Route path="/media" element={<MediaViewer />} />
<Route path="/media/:username" element={<MediaViewer />} />
          </Route>
          <Route path="/index" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>

        <button 
          onClick={() => setPostModalOpen(true)}
          className={cn(
            "fixed z-[999] flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-all duration-500 hover:scale-110 active:scale-95",
            "bottom-24 right-6 h-12 w-12 md:hidden",
            shouldHideFAB && "scale-0 opacity-0"
          )}
          aria-label="新規投稿"
        >
          
          <PenSquare className="h-5 w-5" />
        </button>

        <PostOverlay 
          isOpen={isPostModalOpen} 
          onClose={() => setPostModalOpen(false)} 
        />

      </AuthProvider>
    </>
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
            basename="/RaimuNoteSNS.github.io"
            future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
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
