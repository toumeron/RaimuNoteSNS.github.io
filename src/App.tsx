import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect, useState, useRef, type ChangeEvent } from "react";
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
import { ImagePlus, Loader2, Send, X, AtSign, Hash, Globe, Users, Plus, PenSquare } from 'lucide-react';
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
  DropdownMenuPortal,
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

const NotificationWatcher = () => {
  const { user } = useAuth();
  useOSNotification(user?.id ?? null);
  return null;
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

interface PostComposerProps {
  initialQuotedPost?: PostWithAuthor | null;
  initialContent?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

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

export function PostComposer({ initialQuotedPost, initialContent = '', onSuccess, onCancel }: PostComposerProps) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const quoteId = searchParams.get('quote');
  
  const { mutateAsync, isPending } = useCreatePost();
  
  const [content, setContent] = useState(initialContent);
  const [previews, setPreviews] = useState<string[]>([]);
  const [quotedPost, setQuotedPost] = useState<PostWithAuthor | null>(initialQuotedPost || null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [visibility, setVisibility] = useState<'public' | 'following'>('public');

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<any[]>([]);
  const [hashtagQuery, setHashtagQuery] = useState<string | null>(null); 
  const [hashtagResults, setHashtagResults] = useState<any[]>([]); 
  const [cursorPosition, setCursorPosition] = useState(0);
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 }); 
  const [scrollTop, setScrollTop] = useState(0);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialContent) {
      setContent(initialContent);
    }
  }, [initialContent]);

  useEffect(() => {
    if (quoteId && !initialQuotedPost) {
      getPostById(quoteId).then(setQuotedPost).catch(() => {
        toast.error('引用元の投稿が見つかりませんでした');
        setSearchParams({});
      });
    }
  }, [quoteId, initialQuotedPost, setSearchParams]);

  useEffect(() => {
    if (initialQuotedPost) {
      setQuotedPost(initialQuotedPost);
    }
  }, [initialQuotedPost]);

  useEffect(() => {
    const fetchUsers = async () => {
      if (!mentionQuery) {
        setMentionResults([]);
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .ilike('username', `${mentionQuery}%`)
        .limit(5);
      
      setMentionResults(data || []);
    };
    fetchUsers();
  }, [mentionQuery]);

  useEffect(() => {
    const fetchHashtags = async () => {
      if (!hashtagQuery) {
        setHashtagResults([]);
        return;
      }
      const { data } = await supabase
        .from('hashtags')
        .select('tag')
        .ilike('tag', `${hashtagQuery}%`)
        .order('usage_count', { ascending: false })
        .limit(5);
      
      setHashtagResults(data || []);
    };
    fetchHashtags();
  }, [hashtagQuery]);

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

  if (!user) return null;

  const handleContentChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const pos = e.target.selectionStart;
    setContent(val);
    setCursorPosition(pos);

    const lastAtIdx = val.lastIndexOf('@', pos - 1);
    const lastHashIdx = val.lastIndexOf('#', pos - 1);

    if (lastAtIdx !== -1 && (lastHashIdx === -1 || lastAtIdx > lastHashIdx)) {
      const query = val.slice(lastAtIdx + 1, pos);
      if (!query.includes(' ') && !query.includes('\n')) {
        setMentionQuery(query);
        setHashtagQuery(null);
        updatePopupPosition(pos);
        return;
      }
    }
    
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

  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
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

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const slots = MAX_IMAGES - previews.length;
    if (slots <= 0) {
      toast.error(`画像は最大${MAX_IMAGES}枚までです`);
      return;
    }
    const next = files.slice(0, slots).map((f) => URL.createObjectURL(f));
    setPreviews((p) => [...p, ...next]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const removePreview = (i: number) => {
    setPreviews((p) => {
      URL.revokeObjectURL(p[i]);
      return p.filter((_, idx) => idx !== i);
    });
  };

  const cancelQuote = () => {
    setSearchParams({});
    setQuotedPost(null);
  };

  const submit = async () => {
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
      await mutateAsync({ 
        content: trimmed, 
        imageUrls: previews,
        parentId: quotedPost?.id,
        isQuote: !!quotedPost,
        user_id: user.id,
        visibility: visibility 
      } as any);

      const hashtagRegex = /#([a-zA-Z0-9_\u3041-\u3094\u30a1-\u30fa\u30fc\u4e00-\u9fa5]+)/g;
      const matches = trimmed.match(hashtagRegex);
      if (matches) {
        const uniqueTags = Array.from(new Set(matches.map(tag => tag.slice(1))));
        uniqueTags.forEach(async (tag) => {
          try {
            await supabase.rpc('upsert_hashtag', { tag_name: tag });
          } catch (e) {
            console.warn(`Hashtag upsert failed for #${tag}:`, e);
          }
        });
      }

      setContent('');
      previews.forEach(URL.revokeObjectURL);
      setPreviews([]);
      setVisibility('public'); 
      cancelQuote();
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error("Submission failed:", err);
    }
  };

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

  return (
    <div className="relative flex flex-col rounded-3xl bg-card shadow-soft transition-all duration-300">
      {/* ヘッダー領域 */}
      <div className="flex items-center justify-end px-4 pt-3 pb-0">
        {onCancel && (
          <Button 
            variant="ghost" 
            size="icon"
            className="h-8 w-8 rounded-full hover:bg-muted" 
            onClick={onCancel}
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </Button>
        )}
      </div>

      <div className="flex gap-3 p-5 pt-2">
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
              onScroll={handleScroll}
              rows={3}
              spellCheck={false}
              className="relative z-10 resize-none border-0 bg-transparent px-0 py-2 text-[20px] leading-relaxed shadow-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none outline-none w-full text-transparent selection:bg-[#b4d7ff] selection:text-black dark:selection:bg-[#385474] dark:selection:text-white"
              style={{ color: "transparent", caretColor: "hsl(var(--foreground))" }}
            />
          </div>

          {(mentionResults.length > 0 && mentionQuery !== null) && (
            <div 
              className="absolute z-[60] w-64 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-xl backdrop-blur-md transition-all duration-150"
              style={{ top: popupPos.top - scrollTop, left: popupPos.left }}
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
              className="absolute z-[60] w-64 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-xl backdrop-blur-md transition-all duration-150"
              style={{ top: popupPos.top - scrollTop, left: popupPos.left }}
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
            <div className="relative mt-2 overflow-hidden rounded-2xl border border-border/60 bg-muted/20 p-4 transition-all">
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
                    onClick={() => removePreview(i)}
                    className="absolute right-1.5 top-1.5 rounded-full bg-background/80 p-1 backdrop-blur transition hover:bg-background"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border/60 pt-3">
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
                <DropdownMenuPortal>
                  <DropdownMenuContent align="start" className="rounded-xl z-[10001]">
                    <DropdownMenuItem onClick={() => setVisibility('public')}>
                      <Globe className="mr-2 h-4 w-4" />
                      全員
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setVisibility('following')}>
                      <Users className="mr-2 h-4 w-4" />
                      フォロー中
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenuPortal>
              </DropdownMenu>

              <span className={cn('text-xs tabular-nums', overLimit ? 'font-bold text-destructive' : 'text-muted-foreground')}>
                {remaining}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={submit}
                disabled={isPending || overLimit || !content.trim()}
                className="rounded-full bg-gradient-primary px-5 h-9 font-bold shadow-soft transition hover:shadow-pop"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Send className="mr-1.5 h-4 w-4" />
                    {quotedPost ? '引用' : 'ポスト'}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
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
const isMediaPage = lowerPath === "/media" || lowerPath.startsWith("/media/");

// いずれかの非表示対象ページであるか、またはスクロールによって非表示にするか
const shouldHideFAB = !isFABVisible || isChatPage || isAuthPage || isTermsPage || isMediaPage;

  return (
    <>
      <ScrollToTop />
      
      <AuthProvider>
        <NotificationWatcher />
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
            <AppContent />
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;