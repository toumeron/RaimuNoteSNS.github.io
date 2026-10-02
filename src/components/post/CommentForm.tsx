import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Send, X } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PostComposer } from '@/components/feed/PostComposer';
import { useAuth } from '@/hooks/useAuth';
import { useCreateComment } from '@/hooks/useComments';
import { toast } from 'sonner';

const MAX = 280;

type CommentFormVariant = 'default' | 'mobileDock' | 'bottomNav' | 'desktopReply';

export function CommentForm({
  postId,
  variant = 'default',
  parentCommentId = null,
}: {
  postId: string;
  variant?: CommentFormVariant;
  parentCommentId?: string | null;
}) {
  const { user } = useAuth();
  const { mutateAsync, isPending } = useCreateComment(postId);
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [editingImage, setEditingImage] = useState<string | null>(null);
  const originals = useRef(new Map<string, string>());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const compactMobile = variant === 'mobileDock' || variant === 'bottomNav';
  const expanded = editing || text.length > 0 || images.length > 0;
  useLayoutEffect(() => {
    const input = textareaRef.current;
    if (!input) return;
    if (!expanded) { input.style.removeProperty('height'); return; }
    input.style.setProperty('height', 'auto', 'important');
    input.style.setProperty('height', `${Math.min(240, Math.max(44, input.scrollHeight))}px`, 'important');
  }, [text, expanded]);
  const releaseImages = useCallback(() => {
    new Set([...imageRefs.current, ...originals.current.values()]).forEach(url => URL.revokeObjectURL(url));
    imageRefs.current = []; originals.current.clear();
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRefs = useRef<string[]>([]);
  const submitting = useRef(false);
  useEffect(() => () => { releaseImages(); }, [releaseImages]);
  useEffect(() => {
    setText('');
    releaseImages();
    setImages([]); setEditing(false); setEditingImage(null);
  }, [postId, parentCommentId, releaseImages]);

  const addImages = (files: File[]) => {
    if (isPending || submitting.current) return;
    const valid = files.filter(file => file.type.startsWith('image/'));
    if (valid.length > 4 - imageRefs.current.length) toast.error('画像は4枚まで添付できます');
    const added = valid.slice(0, 4 - imageRefs.current.length).map(file => URL.createObjectURL(file));
    added.forEach(url => originals.current.set(url, url));
    setEditing(true);
    imageRefs.current = [...imageRefs.current, ...added];
    setImages(imageRefs.current);
  };

  const removeImage = (url: string) => {
    new Set([url, originals.current.get(url) ?? url]).forEach(url => URL.revokeObjectURL(url));
    originals.current.delete(url);
    imageRefs.current = imageRefs.current.filter(image => image !== url);
    setImages(imageRefs.current);
  };

  if (!user) return null;

  const submit = async () => {
    const t = text.trim();
    if (submitting.current || isPending || (!t && images.length === 0)) return;
    if (t.length > MAX) {
      toast.error(`コメントは${MAX}文字以内で入力してください`);
      return;
    }
    try {
      submitting.current = true;
      await mutateAsync({ content: t, imageUrls: images, parentCommentId });
      setText('');
      releaseImages();
      setImages([]); setEditing(false); setEditingImage(null);
    } catch {
      /* hook側でtoast */
    } finally {
      submitting.current = false;
    }
  };

  const isMobileDock = variant === 'mobileDock';
  const isBottomNav = variant === 'bottomNav';
  const isDesktopReply = variant === 'desktopReply';
  return (
    <>
      {editingImage && <PostComposer key={editingImage} imageEditor={{ src: originals.current.get(editingImage) ?? editingImage, onClose: () => setEditingImage(null), onApply: url => {
        const original = originals.current.get(editingImage) ?? editingImage;
        if (editingImage !== original && editingImage !== url) URL.revokeObjectURL(editingImage);
        originals.current.delete(editingImage); originals.current.set(url, original);
        imageRefs.current = imageRefs.current.map(image => image === editingImage ? url : image);
        setImages(imageRefs.current);
      } }} />}
      <style>{`
        [data-lime-reply-composer][data-compact="false"][data-editing="true"] {
          display: grid !important;
          grid-template-columns: var(--reply-avatar-size, 36px) minmax(0, 1fr) auto !important;
          align-items: start !important;
        }
        [data-lime-reply-composer][data-compact="false"][data-editing="true"] .reply-input-shell { grid-column: 2 / -1; }
        [data-lime-reply-composer][data-compact="false"][data-editing="true"] .reply-attachments { grid-column: 2 / -1; }
        [data-lime-reply-composer][data-compact="false"][data-editing="true"] .reply-photo-action { grid-column: 2; justify-self: start; }
        [data-lime-reply-composer][data-compact="false"][data-editing="true"] .reply-submit { grid-column: 3; justify-self: end; align-self: center; }

        [data-lime-reply-composer] .comment-form-desktop-reply-input {
          padding-top: 8px !important;
          padding-bottom: 8px !important;
          line-height: 28px !important;
        }
        [data-lime-reply-composer][data-compact="true"] .reply-attachments { grid-column: 1 / -1; grid-row: 1; }
        @media (max-width: 639px) {
          .comment-form-mobile-dock {
            position: fixed;
            left: 0;
            right: 0;
            bottom: calc(var(--lime-bottom-nav-height, 58px));
            z-index: 120;
            display: grid !important;
            grid-template-columns: 40px minmax(0, 1fr) 38px;
            align-items: center;
            gap: 9px;
            min-height: 58px;
            padding: 8px 12px;
            border: 0 !important;
            border-top: 1px solid hsl(var(--border) / 0.62) !important;
            border-radius: 0 !important;
            background: hsl(var(--background)) !important;
            box-shadow: none !important;
            -webkit-backdrop-filter: none !important;
            backdrop-filter: none !important;
          }

          .comment-form-bottom-nav {
            display: grid !important;
            grid-template-columns: 38px minmax(0, 1fr) 36px;
            align-items: center;
            gap: 8px;
            width: 100%;
            min-height: 46px;
            padding: 0 !important;
            border: 0 !important;
            border-radius: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
            -webkit-backdrop-filter: none !important;
            backdrop-filter: none !important;
          }

          .comment-form-mobile-dock-avatar,
          .comment-form-bottom-nav-avatar {
            width: 36px !important;
            height: 36px !important;
            border-color: hsl(var(--border) / 0.62) !important;
          }

          .comment-form-mobile-dock-input,
          .comment-form-bottom-nav-input {
            height: 40px !important;
            min-width: 0 !important;
            border: 0 !important;
            border-radius: 9999px !important;
            background: hsl(var(--muted) / 0.72) !important;
            color: hsl(var(--foreground)) !important;
            caret-color: hsl(var(--primary)) !important;
            padding-left: 16px !important;
            padding-right: 16px !important;
            font-size: 16px !important;
            font-weight: 500 !important;
            box-shadow: none !important;
          }

          .comment-form-mobile-dock-input::placeholder,
          .comment-form-bottom-nav-input::placeholder {
            color: hsl(var(--muted-foreground)) !important;
            opacity: 1 !important;
          }

          .comment-form-mobile-dock-input:focus-visible,
          .comment-form-bottom-nav-input:focus-visible {
            --tw-ring-color: hsl(var(--primary) / 0.55) !important;
            --tw-ring-offset-color: transparent !important;
            outline: none !important;
            box-shadow: 0 0 0 1px hsl(var(--primary) / 0.55) !important;
          }

          .comment-form-mobile-dock-submit,
          .comment-form-bottom-nav-submit {
            width: 36px !important;
            height: 36px !important;
            border-radius: 9999px !important;
            background: hsl(var(--primary)) !important;
            color: white !important;
            box-shadow: none !important;
          }

          .comment-form-mobile-dock-submit:disabled,
          .comment-form-bottom-nav-submit:disabled {
            opacity: 0.42 !important;
          }
        }
      `}</style>

      <div
        data-lime-reply-composer
        data-editing={expanded}
        data-compact={compactMobile}
        onFocusCapture={() => setEditing(true)}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setEditing(false); }}
        style={isDesktopReply ? { '--reply-avatar-size': '44px' } as React.CSSProperties : undefined}
        className={`flex items-center gap-3 rounded-3xl border border-border/60 bg-card p-3 shadow-soft ${
          isMobileDock ? 'comment-form-mobile-dock' : ''
        } ${isBottomNav ? 'comment-form-bottom-nav' : ''} ${isDesktopReply ? 'comment-form-desktop-reply' : ''}`}
      >
        <Link to={`/u/${user.username}`} aria-label="自分のプロフィールを開く" className="shrink-0">
        <Avatar
          className={`h-9 w-9 border border-primary/30 ${
            isMobileDock ? 'comment-form-mobile-dock-avatar' : ''
          } ${isBottomNav ? 'comment-form-bottom-nav-avatar' : ''} ${isDesktopReply ? 'comment-form-desktop-reply-avatar' : ''}`}
        >
          <AvatarImage src={user.avatarUrl} alt={user.displayName} />
          <AvatarFallback>{user.displayName.slice(0, 1)}</AvatarFallback>
        </Avatar>
        </Link>
        <div className="reply-input-shell flex min-w-0 flex-1 items-center gap-1">
        {compactMobile ? (        <Input
          value={text}
          disabled={isPending}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.items).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => !!file);
            if (files.length > 0) { e.preventDefault(); addImages(files); }
          }}
          placeholder="返信をポスト"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
          className={`h-9 flex-1 rounded-full border-0 bg-secondary/60 focus-visible:ring-1 focus-visible:ring-primary/40 ${
            isMobileDock ? 'comment-form-mobile-dock-input' : ''
          } ${isBottomNav ? 'comment-form-bottom-nav-input' : ''} ${isDesktopReply ? 'comment-form-desktop-reply-input' : ''}`}
        />
) : (        <Textarea
          ref={textareaRef}
          rows={1}
          value={text}
          disabled={isPending}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.items).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => !!file);
            if (files.length > 0) { e.preventDefault(); addImages(files); }
          }}
          placeholder="返信をポスト"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
          className={`h-9 min-h-0 resize-none flex-1 rounded-full border-0 bg-secondary/60 focus-visible:ring-1 focus-visible:ring-primary/40 ${
            isMobileDock ? 'comment-form-mobile-dock-input' : ''
          } ${isBottomNav ? 'comment-form-bottom-nav-input' : ''} ${isDesktopReply ? 'comment-form-desktop-reply-input' : ''}`}
        />
)}
        {compactMobile && expanded && <button type="button" onClick={() => fileRef.current?.click()} disabled={isPending || images.length >= 4} aria-label="返信に画像を添付" className="shrink-0 rounded-full p-1 text-primary disabled:opacity-40"><ImagePlus className="h-5 w-5" /></button>}
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addImages(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        </div>
        {images.length > 0 && <div className={`reply-attachments grid w-full gap-2 ${compactMobile ? 'flex flex-wrap' : images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {images.map(url => <div key={url} className={`relative overflow-hidden rounded-2xl border border-border/60 ${compactMobile ? "h-16 w-16" : ""}`}>
            <img src={url} alt="添付画像のプレビュー" className={compactMobile ? 'h-full w-full object-cover' : images.length === 1 ? 'block w-full max-h-[480px] object-contain' : 'aspect-square w-full object-cover'} />
            <button type="button" disabled={isPending} onClick={() => setEditingImage(url)} aria-label="編集" className={compactMobile ? "absolute inset-0" : "absolute left-1.5 top-1.5 inline-flex items-center rounded-full bg-black/55 px-3 py-1.5 text-xs font-bold text-white shadow-sm backdrop-blur-md transition hover:bg-black/70"}>{!compactMobile && "編集"}</button>
            <button type="button" disabled={isPending} onClick={() => removeImage(url)} aria-label="添付画像を削除" className="absolute right-1.5 top-1.5 rounded-full bg-background/80 p-1 backdrop-blur transition hover:bg-background"><X className="h-4 w-4" /></button>
          </div>)}
        </div>}
        {!compactMobile && expanded && <button type="button" onClick={() => fileRef.current?.click()} disabled={isPending || images.length >= 4} aria-label="返信に画像を添付" className="reply-photo-action shrink-0 rounded-full p-2 text-primary disabled:opacity-40"><ImagePlus className="h-5 w-5" /></button>}
        <Button
          onClick={submit}
          disabled={isPending || (!text.trim() && images.length === 0)}
          size="icon"
          className={`reply-submit h-9 w-9 shrink-0 rounded-full bg-gradient-primary shadow-soft ${
            isMobileDock ? 'comment-form-mobile-dock-submit' : ''
          } ${isBottomNav ? 'comment-form-bottom-nav-submit' : ''} ${isDesktopReply ? 'comment-form-desktop-reply-submit' : ''}`}
          aria-label="コメントを送信"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : isDesktopReply ? '返信' : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </>
  );
}
