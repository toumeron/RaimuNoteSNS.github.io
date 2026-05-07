import { useRef, useState, useEffect, type ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ImagePlus, Loader2, Send, X, AtSign } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { useCreatePost } from '@/hooks/useFeed';
import { getPostById } from '@/api/posts';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { PostWithAuthor } from '@/types';
import { formatRelative } from '@/lib/format';
import { supabase } from '@/lib/supabase';

const MAX_LEN = 500;
const MAX_IMAGES = 4;

interface PostComposerProps {
  initialQuotedPost?: PostWithAuthor | null;
  initialContent?: string;
  onSuccess?: () => void;
}

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

export function PostComposer({ initialQuotedPost, initialContent = '', onSuccess }: PostComposerProps) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const quoteId = searchParams.get('quote');
  
  const { mutateAsync, isPending } = useCreatePost();
  
  const [content, setContent] = useState(initialContent);
  const [previews, setPreviews] = useState<string[]>([]);
  const [quotedPost, setQuotedPost] = useState<PostWithAuthor | null>(initialQuotedPost || null);
  const fileRef = useRef<HTMLInputElement>(null);

  // メンション機能用ステートとRef
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<any[]>([]);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [mentionPos, setMentionPos] = useState({ top: 0, left: 0 });
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

  // メンション候補の検索ロジック
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

  // 外側クリックでメンション候補を閉じる
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMentionQuery(null);
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

    // カーソル位置の直前の単語が @で始まっているか確認
    const lastAtIdx = val.lastIndexOf('@', pos - 1);
    if (lastAtIdx !== -1) {
      const query = val.slice(lastAtIdx + 1, pos);
      // 空白が含まれていない場合のみ検索対象とする
      if (!query.includes(' ') && !query.includes('\n')) {
        setMentionQuery(query);
        // カーソル位置の座標を計算
        if (textareaRef.current) {
          const coords = getCaretCoordinates(textareaRef.current, pos);
          setMentionPos({ 
            top: coords.top + coords.height, 
            left: Math.min(coords.left, 150) // 右端にはみ出さないよう制限
          });
        }
      } else {
        setMentionQuery(null);
      }
    } else {
      setMentionQuery(null);
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
    
    // 入力エリアにフォーカスを戻す
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
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
        isQuote: !!quotedPost
      });
      setContent('');
      previews.forEach(URL.revokeObjectURL);
      setPreviews([]);
      cancelQuote();
      if (onSuccess) onSuccess();
    } catch {
      /* エラーはHook側で処理 */
    }
  };

  // メンション部分のテキスト色付け描画
  const renderHighlightedText = (text: string) => {
    const regex = /(@[a-zA-Z0-9_]+)/g;
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
    <div className="rounded-3xl bg-card p-5 shadow-soft transition-all duration-300">
      <div className="flex gap-3">
        <Avatar className="h-11 w-11 border-2 border-primary/30 shrink-0">
          <AvatarImage src={user.avatarUrl} alt={user.displayName} />
          <AvatarFallback>{user.displayName.slice(0, 1)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0 space-y-3 relative" ref={containerRef}>
          
          <div className="relative w-full overflow-hidden">
            {/* カスタムプレースホルダー */}
            {!content && (
              <div className="absolute inset-0 pointer-events-none px-0 py-2 text-[20px] leading-relaxed text-muted-foreground z-0">
                {quotedPost ? "コメントを添えてリポスト" : "いまどうしてる？"}
              </div>
            )}

            {/* バックドロップレイヤー（色付け用） */}
            <div
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none whitespace-pre-wrap break-words px-0 py-2 text-[20px] leading-relaxed text-foreground z-0"
              style={{ transform: `translateY(-${scrollTop}px)` }}
            >
              {renderHighlightedText(content)}
              {/* 最後の改行を正しくレンダリングするための処理 */}
              {content.endsWith('\n') ? <br /> : null}
            </div>

            {/* 実際のテキストエリア（文字を透明化） */}
            <Textarea
              ref={textareaRef}
              value={content}
              onChange={handleContentChange}
              onScroll={handleScroll}
              rows={3}
              spellCheck={false}
              /* selection:bg-[#b4d7ff] (ライトモード) / dark:selection:bg-[#385474] (ダークモード) でハイライト背景色を指定。
                selection:text-black (ライトモード) / dark:selection:text-white (ダークモード) で文字色を反転させ可視化。
              */
              className="relative z-10 resize-none border-0 bg-transparent px-0 py-2 text-[20px] leading-relaxed shadow-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none outline-none w-full text-transparent selection:bg-[#b4d7ff] selection:text-black dark:selection:bg-[#385474] dark:selection:text-white"
              style={{ color: "transparent", caretColor: "hsl(var(--foreground))" }}
            />
          </div>

          {/* メンション候補リスト（カーソル位置に追従） */}
          {mentionResults.length > 0 && mentionQuery !== null && (
            <div 
              className="absolute z-[60] w-64 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-xl backdrop-blur-md transition-all duration-150"
              style={{ top: mentionPos.top - scrollTop, left: mentionPos.left }}
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
                <ImagePlus className="mr-1.5 h-4 w-4" />
                画像
              </Button>
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
  );
}