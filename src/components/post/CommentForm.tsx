import {DraftEmojiText} from '@/components/stickers/DraftEmojiText';
import { StickerPicker, StickerDraft } from '@/components/stickers/Stickers';
import { appendSticker, insertDraftEmoji, hasDraftEmojis, draftEmojiCharacter } from '@/lib/stickers';
import { createPortal } from 'react-dom';
import type { PostWithAuthor } from '@/types';
import { PostCard } from '@/components/feed/PostCard';
import { ReplyChain } from '@/components/post/ReplyChain';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ImagePlus, Loader2, Send, X } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PostComposer } from '@/components/feed/PostComposer';
import { useAuth } from '@/hooks/useAuth';
import { useCreateComment } from '@/hooks/useComments';
import { toast } from 'sonner';

const MAX = 280;

type CommentFormVariant = 'default' | 'mobileDock' | 'bottomNav' | 'desktopReply' | 'mediaViewer' | 'mediaViewerMobile';

export function CommentForm({
  postId,
  variant = 'default',
  parentCommentId = null,
  replyTo,
}: {
  postId: string;
  variant?: CommentFormVariant;
  parentCommentId?: string | null;
  replyTo?: PostWithAuthor;
}) {
  const { user } = useAuth();
  const { mutateAsync, isPending } = useCreateComment(postId);
  const [text, setText] = useState('');
  const [inputScroll,setInputScroll]=useState({left:0,top:0});
  const [sticker,setSticker]=useState<string|null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [mediaReplyOpen, setMediaReplyOpen] = useState(false);
  const [editingImage, setEditingImage] = useState<string | null>(null);
  const originals = useRef(new Map<string, string>());
  const compactInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const compactMobile = variant === 'mobileDock' || variant === 'bottomNav';
  const expanded = editing || text.length > 0 || images.length > 0;
  const changeText=(value:string)=>{setText(sticker && value.trim()?value+draftEmojiCharacter(sticker):value);if(sticker && value.trim())setSticker(null);};
  useLayoutEffect(() => {
    const input = textareaRef.current;
    if (!input) return;
    input.style.setProperty('height', 'auto', 'important');
    input.style.setProperty('height', `${Math.min(240, Math.max(44, input.scrollHeight))}px`, 'important');
  }, [text, mediaReplyOpen]);
  useLayoutEffect(() => { if (mediaReplyOpen) textareaRef.current?.focus({ preventScroll: true }); }, [mediaReplyOpen]);
  const releaseImages = useCallback(() => {
    new Set([...imageRefs.current, ...originals.current.values()]).forEach(url => URL.revokeObjectURL(url));
    imageRefs.current = []; originals.current.clear();
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRefs = useRef<string[]>([]);
  const submitting = useRef(false);
  useEffect(() => () => { releaseImages(); }, [releaseImages]);
  useEffect(() => {
    setText(''); setSticker(null);
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
    const t = appendSticker(text,sticker);
    if (submitting.current || isPending || (!t && images.length === 0)) return;
    if (t.length > MAX) {
      toast.error(`コメントは${MAX}文字以内で入力してください`);
      return;
    }
    try {
      submitting.current = true;
      await mutateAsync({ content: t, imageUrls: images, parentCommentId });
      setText(''); setSticker(null);
      releaseImages();
      setImages([]); setEditing(false); setMediaReplyOpen(false); setEditingImage(null);
    } catch {
      /* hook側でtoast */
    } finally {
      submitting.current = false;
    }
  };

  const isMobileDock = variant === 'mobileDock';
  const isBottomNav = variant === 'bottomNav';
  const isDesktopReply = variant === 'desktopReply';
  const isMediaViewer = variant === 'mediaViewer' || variant === 'mediaViewerMobile';
  const form = (
      <div
        data-lime-reply-composer
        data-variant={variant}
        data-editing={expanded}
        data-focused={editing}
        data-lime-thread-item={isMediaViewer || undefined}
        data-compact={compactMobile}
        onFocusCapture={() => setEditing(true)}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget) && !(event.relatedTarget instanceof Element && event.relatedTarget.closest("[data-lime-sticker-picker]"))) setEditing(false); }}
        style={isDesktopReply ? { '--reply-avatar-size': '44px' } as React.CSSProperties : undefined}
        className={`flex items-center gap-3 rounded-3xl border border-border/60 bg-card p-3 shadow-soft ${
          isMobileDock ? 'comment-form-mobile-dock' : ''
        } ${isBottomNav ? 'comment-form-bottom-nav' : ''} ${isDesktopReply ? 'comment-form-desktop-reply' : ''} ${isMediaViewer ? 'comment-form-media-viewer' : ''}`}
      >
        <Link data-lime-thread-avatar={isMediaViewer || undefined} to={`/u/${user.username}`} aria-label="自分のプロフィールを開く" className="shrink-0">
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
        <div className="relative min-w-0 flex-1">
        {hasDraftEmojis(text)&&<div aria-hidden="true" className={`pointer-events-none absolute inset-0 z-10 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 ${isDesktopReply?"leading-[28px]":"text-sm"} ${compactMobile?"px-4 text-base font-medium leading-6":""}`}><span className="block" style={{transform:`translate(${-inputScroll.left}px,${-inputScroll.top}px)`,whiteSpace:compactMobile?"pre":undefined}}><DraftEmojiText text={text}/></span></div>}
        {compactMobile ? (        <Input
          ref={compactInputRef}
          value={text}
          data-inline-emoji={hasDraftEmojis(text)}
          onScroll={event=>setInputScroll({left:event.currentTarget.scrollLeft,top:event.currentTarget.scrollTop})}
          disabled={isPending}
          onChange={(e) => changeText(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.items).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => !!file);
            if (files.length > 0) { e.preventDefault(); addImages(files); }
          }}
          placeholder="返信をポスト"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
          style={hasDraftEmojis(text)?{color:"transparent",caretColor:"hsl(var(--foreground))"}:undefined}
          className={`h-9 flex-1 rounded-full border-0 bg-secondary/60 focus-visible:ring-1 focus-visible:ring-primary/40 ${
            isMobileDock ? 'comment-form-mobile-dock-input' : ''
          } ${isBottomNav ? 'comment-form-bottom-nav-input' : ''} ${isDesktopReply ? 'comment-form-desktop-reply-input' : ''}`}
        />
) : (        <Textarea
          ref={textareaRef}
          rows={1}
          value={text}
          data-inline-emoji={hasDraftEmojis(text)}
          onScroll={event=>setInputScroll({left:event.currentTarget.scrollLeft,top:event.currentTarget.scrollTop})}
          disabled={isPending}
          onChange={(e) => changeText(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.items).filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => !!file);
            if (files.length > 0) { e.preventDefault(); addImages(files); }
          }}
          placeholder="返信をポスト"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
          style={hasDraftEmojis(text)?{color:"transparent",caretColor:"hsl(var(--foreground))"}:undefined}
          className={`h-9 min-h-0 resize-none flex-1 rounded-full border-0 bg-secondary/60 focus-visible:ring-1 focus-visible:ring-primary/40 ${
            isMobileDock ? 'comment-form-mobile-dock-input' : ''
          } ${isBottomNav ? 'comment-form-bottom-nav-input' : ''} ${isDesktopReply ? 'comment-form-desktop-reply-input' : ''}`}
        />
)}
        </div>
        <div className={`reply-attachment-tools flex shrink-0 items-center ${editing?"":"invisible pointer-events-none"}`} aria-hidden={!editing}>
        {<button type="button" onPointerDown={event=>event.preventDefault()} onClick={() => fileRef.current?.click()} disabled={isPending || !editing || images.length >= 4} data-lime-attachment-tool aria-label="返信に画像を添付" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-accent hover:bg-accent-soft hover:text-accent disabled:opacity-50"><ImagePlus className="h-5 w-5" /></button>}
        <StickerPicker iconOnly disabled={isPending || !editing} onSelect={name=>{if(text.trim())insertDraftEmoji(compactMobile?compactInputRef.current:textareaRef.current,text,name,setText);else setSticker(name);setEditing(true);}} />
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addImages(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        </div>
        {(images.length > 0 || sticker) && <div className={`reply-attachments grid w-full gap-2 ${compactMobile ? 'flex flex-wrap' : images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          <StickerDraft inline={!!text.trim()} name={sticker} onRemove={()=>setSticker(null)}/>
          {images.map(url => <div key={url} className={`relative overflow-hidden rounded-2xl border border-border/60 ${compactMobile ? "h-16 w-16" : ""}`}>
            <img src={url} alt="添付画像のプレビュー" className={compactMobile ? 'h-full w-full object-cover' : images.length === 1 ? 'block w-full max-h-[480px] object-contain' : 'aspect-square w-full object-cover'} />
            <button type="button" disabled={isPending} onClick={() => setEditingImage(url)} aria-label="編集" className={compactMobile ? "absolute inset-0" : "absolute left-1.5 top-1.5 inline-flex items-center rounded-full bg-black/55 px-3 py-1.5 text-xs font-bold text-white shadow-sm backdrop-blur-md transition hover:bg-black/70"}>{!compactMobile && "編集"}</button>
            <button type="button" disabled={isPending} onClick={() => removeImage(url)} aria-label="添付画像を削除" className="absolute right-1.5 top-1.5 rounded-full bg-background/80 p-1 backdrop-blur transition hover:bg-background"><X className="h-4 w-4" /></button>
          </div>)}
        </div>}

        <Button
          onClick={submit}
          disabled={isPending || (!appendSticker(text,sticker) && images.length === 0)}
          size="icon"
          className={`reply-submit h-9 w-9 shrink-0 rounded-full bg-gradient-primary shadow-soft ${
            isMobileDock ? 'comment-form-mobile-dock-submit' : ''
          } ${isBottomNav ? 'comment-form-bottom-nav-submit' : ''} ${isDesktopReply ? 'comment-form-desktop-reply-submit' : ''}`}
          aria-label="コメントを送信"
        >
          {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : (isDesktopReply || variant === 'mediaViewer') ? '返信' : <Send className="h-5 w-5" />}
        </Button>
      </div>
  );
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
        [data-lime-reply-composer] [data-inline-emoji="true"] { color: transparent !important; caret-color: hsl(var(--foreground)) !important; }
        [data-lime-reply-composer] {
          display: grid !important;
          grid-template-columns: var(--reply-avatar-size, 36px) minmax(0, 1fr) auto;
          align-items: start !important;
        }
        [data-lime-reply-composer] > a { grid-column: 1; grid-row: 1; }
        [data-lime-reply-composer] .reply-input-shell { grid-column: 2; grid-row: 1; align-items: flex-start; }
        [data-lime-reply-composer] .reply-attachments { grid-column: 2 / -1; grid-row: 2; }
        [data-lime-reply-composer] .reply-submit { grid-column: 3; grid-row: 1; align-self: start; }

        [data-lime-reply-composer] .comment-form-desktop-reply-input {
          padding-top: 8px !important;
          padding-bottom: 8px !important;
          line-height: 28px !important;
        }
        [data-lime-reply-composer][data-compact="true"] .reply-attachments { grid-column: 1 / -1; grid-row: 2; }
        @media (max-width: 639px) {
          [data-lime-reply-composer][data-compact="true"] { grid-template-columns: 36px minmax(0, 1fr) 0px; transition: grid-template-columns .22s ease; }
          [data-lime-reply-composer][data-compact="true"][data-focused="true"] { grid-template-columns: 36px minmax(0, 1fr) 36px; }
          [data-lime-reply-composer][data-compact="true"] .reply-attachment-tools { width:0; opacity:0; overflow:hidden; transition:width .22s ease,opacity .18s ease; }
          [data-lime-reply-composer][data-compact="true"][data-focused="true"] .reply-attachment-tools { width:72px; opacity:1; }
          [data-lime-reply-composer][data-compact="true"] .reply-submit { width:0!important; padding:0!important; min-width:0; opacity:0; overflow:hidden; pointer-events:none; transition:width .22s ease,opacity .18s ease; }
          [data-lime-reply-composer][data-compact="true"][data-focused="true"] .reply-submit { width:36px!important; opacity:1; pointer-events:auto; }

          .comment-form-mobile-dock {
            position: fixed;
            left: 0;
            right: 0;
            bottom: calc(var(--lime-bottom-nav-height, 58px));
            z-index: 120;
            display: grid !important;
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

      {variant === 'mediaViewerMobile' ? <>
        <button type="button" className="lime-media-reply-launcher" aria-label="返信を入力" onClick={() => { setMediaReplyOpen(true); setEditing(true); }}>{text || '返信をポスト'}</button>
        {mediaReplyOpen && createPortal(<div className="lime-media-reply-dialog dark" role="dialog" aria-modal="true" aria-label="返信を作成" data-lime-media-reply-dialog onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setMediaReplyOpen(false); } }}>
          <header><button type="button" aria-label="返信入力を閉じる" onClick={() => setMediaReplyOpen(false)}><ArrowLeft /></button><button type="button" className="lime-media-reply-send" aria-label="コメントを送信" disabled={isPending || (!appendSticker(text, sticker) && images.length === 0)} onClick={submit}>{isPending ? <Loader2 className="animate-spin h-5 w-5" /> : '返信'}</button></header>
          <main>
            <ReplyChain>
              {replyTo && <div className="lime-media-reply-source"><PostCard post={replyTo} embedded thread /><p className="lime-media-reply-recipient">返信先: <Link to={`/u/${replyTo.author.username}`} className="text-primary">@{replyTo.author.username}</Link>さん</p></div>}
              {form}
            </ReplyChain>
          </main>
        </div>, document.body)}
      </> : form}

    </>
  );
}
