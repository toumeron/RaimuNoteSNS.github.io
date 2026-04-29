import { useRef, useState, useEffect, type ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ImagePlus, Loader2, Send, X } from 'lucide-react';
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

const MAX_LEN = 500;
const MAX_IMAGES = 4;

interface PostComposerProps {
  initialQuotedPost?: PostWithAuthor | null;
  initialContent?: string; // ← 追加
  onSuccess?: () => void;
}

export function PostComposer({ initialQuotedPost, initialContent = '', onSuccess }: PostComposerProps) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const quoteId = searchParams.get('quote');
  
  const { mutateAsync, isPending } = useCreatePost();
  
  // ステートの初期値に initialContent を適用
  const [content, setContent] = useState(initialContent);
  const [previews, setPreviews] = useState<string[]>([]);
  const [quotedPost, setQuotedPost] = useState<PostWithAuthor | null>(initialQuotedPost || null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 外部から initialContent が変わった場合（共有データの読み込み遅延など）に同期
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

  if (!user) return null;

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

  const remaining = MAX_LEN - content.length;
  const overLimit = remaining < 0;

  return (
    <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft transition-all duration-300">
      <div className="flex gap-3">
        <Avatar className="h-11 w-11 border-2 border-primary/30 shrink-0">
          <AvatarImage src={user.avatarUrl} alt={user.displayName} />
          <AvatarFallback>{user.displayName.slice(0, 1)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0 space-y-3">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={quotedPost ? "コメントを添えてリポスト" : "いまどうしてる？"}
            rows={3}
            className="resize-none border-0 bg-transparent px-0 text-[15px] leading-relaxed shadow-none focus-visible:ring-0 w-full"
          />

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