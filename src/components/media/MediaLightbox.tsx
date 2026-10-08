import {getBlueskyPostUrl} from '@/lib/bluesky';
import { OfflineBookmarkContext } from '@/components/stickers/OfflineBookmarkContext';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { getPostById } from '@/api/posts';
import { getExternalPost, isExternalPostId } from '@/api/external-posts';
import { getReplyPost } from '@/api/reply-reposts';
import { useAuth } from '@/hooks/useAuth';
import { postKey } from '@/hooks/useFeed';
import { PostCard } from '@/components/feed/PostCard';
import { CommentForm } from '@/components/post/CommentForm';
import { CommentList, CommentCard } from '@/components/post/CommentList';
import { FollowButton } from '@/components/profile/FollowButton';
import { renderStickerText } from '@/components/stickers/renderStickerText';
import { PostOverlayContext, usePostOverlay } from '@/components/layout/PostOverlayContext';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import type { PostWithAuthor } from '@/types';
import { MEDIA_VIEWER_EVENT, type MediaViewerSelection } from './openMediaViewer';
import './media-lightbox.css';
import { containSize, clampPan, focalPan, pinchZoom } from './mediaGeometry';

export function MediaLightboxRoot() {
  const [selection, setSelection] = useState<MediaViewerSelection | null>(null);
  const location = useLocation();
  const { user } = useAuth();
  useEffect(() => {
    const open = (event: Event) => setSelection((event as CustomEvent<MediaViewerSelection>).detail);
    window.addEventListener(MEDIA_VIEWER_EVENT, open);
    return () => window.removeEventListener(MEDIA_VIEWER_EVENT, open);
  }, []);
  useEffect(() => setSelection(null), [location.key, user?.id]);
  return selection ? <OfflineBookmarkContext.Provider value={selection.offline ?? null}><MediaLightbox key={`${selection.post?.id ?? selection.postId}:${selection.url}`} selection={selection} onClose={() => setSelection(null)} /></OfflineBookmarkContext.Provider> : null;
}

export function MediaLightbox({ selection, onClose }: { selection: MediaViewerSelection; onClose: () => void }) {
  const { user } = useAuth();
  const openPostOverlay = usePostOverlay();
  const offline = useContext(OfflineBookmarkContext);
  const id = selection.post?.id ?? selection.postId ?? '';
  const postQuery = useQuery({
    queryKey: id.startsWith('reply:') ? ['media-viewer-post', id, user?.id] : postKey(id),
    queryFn: () => id.startsWith('reply:') ? getReplyPost(id) : isExternalPostId(id) ? getExternalPost(id) : getPostById(id),
    enabled: !!id && !offline && navigator.onLine,
    retry: 1,
  });
  const sourcePost = postQuery.data ?? selection.post;
  const [likeState, setLikeState] = useState<{ liked: boolean; count: number } | null>(null);
  const post = useMemo(() => sourcePost && likeState ? { ...sourcePost, likedByMe: likeState.liked, likesCount: likeState.count } : sourcePost, [sourcePost, likeState]);
  const media = selection.media?.length ? selection.media : [...new Set([...(post?.imageUrls ?? []), selection.url])].map(src => ({ src, type: 'image' as const }));
  const [index, setIndex] = useState(0);
  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current && (selection.media || post || !id)) {
      setIndex(Math.max(0, media.findIndex(item => item.src === selection.url)));
      initialized.current = true;
    }
  }, [post, selection, media, id]);
  const current = media[index] ?? media[0];
  const [details, setDetails] = useState(true);
  const [controls, setControls] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [imageFailed, setImageFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const transform = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  transform.current = { zoom, pan };
  const stage = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const indexRef = useRef(index); indexRef.current = index;
  const [swipeOffset, setSwipeOffset] = useState(0);
  const offsetRef = useRef(0); offsetRef.current = swipeOffset;
  const sliding = useRef(false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const tapTimer = useRef<ReturnType<typeof setTimeout>>();
  const close = useCallback(() => {
    if (closeTimer.current) return;
    setClosing(true);
    closeTimer.current = setTimeout(onClose, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160);
  }, [onClose]);
  useEffect(() => () => { clearTimeout(closeTimer.current); clearTimeout(tapTimer.current); }, []);
  const closeButton = useRef<HTMLButtonElement>(null);
  const replyRef = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = dock.current;
    if (!element) return;
    const measure = () => root.current?.style.setProperty('--lime-media-dock-height', `${element.getBoundingClientRect().height + 24}px`);
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ x: 0, y: 0, panX: 0, panY: 0, distance: 0, scale: 1, moved: false, pinched: false, focal: { x: 0, y: 0 }, imageHit: false });
  const move = useCallback((delta: number) => {
    const next = Math.max(0, Math.min(media.length - 1, indexRef.current + delta));
    if (next === indexRef.current || sliding.current) { setSwipeOffset(0); return; }
    const element = track.current;
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setIndex(next); setSwipeOffset(0); return; }
    sliding.current = true;
    const animation = element.animate([{ transform: `translateX(${offsetRef.current}px)` }, { transform: `translateX(${-Math.sign(delta) * element.clientWidth}px)` }], { duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' });
    animation.onfinish = () => {
      // Commit the new slide before releasing the final animation frame.
      flushSync(() => { setIndex(next); setSwipeOffset(0); setZoom(1); setPan({ x: 0, y: 0 }); setImageFailed(false); });
      animation.cancel(); sliding.current = false;
    };
    animation.oncancel = () => { sliding.current = false; };
  }, [media.length]);
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); setImageFailed(false); }, [index]);
  useEffect(() => { if (zoom === 1) setPan({ x: 0, y: 0 }); }, [zoom]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('[data-lime-media-reply-dialog]')) return;
      if (event.key === 'Escape') {
        if (document.querySelector('[data-lime-media-sheet], [data-radix-popper-content-wrapper] [role=menu], [data-lime-sticker-picker]')) return;
        event.preventDefault(); close();
      }
      if ((event.target as HTMLElement)?.matches('input,textarea,[contenteditable=true]')) return;
      if (event.key === 'ArrowLeft') move(-1);
      if (event.key === 'ArrowRight') move(1);
      if (event.key === 'Tab') {
        const dialog = stage.current?.closest('[role=dialog]');
        const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,textarea') ?? []).filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', keyboard); previous?.focus({ preventScroll: true }); };
  }, [close, move]);
  const geometry = () => {
    const rect = stage.current!.getBoundingClientRect();
    return { rect, size: containSize(rect.width, rect.height, image.current?.naturalWidth ?? 0, image.current?.naturalHeight ?? 0) };
  };
  const applyTransform = (nextZoom: number, nextPan: { x: number; y: number }) => {
    const { rect, size } = geometry();
    const bounded = clampPan(nextPan, size, rect, nextZoom);
    transform.current = { zoom: nextZoom, pan: bounded };
    setZoom(nextZoom); setPan(bounded);
  };
  const imageHit = (x: number, y: number) => {
    const { rect, size } = geometry(), current = transform.current;
    return Math.abs(x - rect.left - rect.width / 2 - current.pan.x) <= size.width * current.zoom / 2 && Math.abs(y - rect.top - rect.height / 2 - current.pan.y) <= size.height * current.zoom / 2;
  };
  // Own the gesture only while this viewer is mounted. Safari's page zoom must
  // not run alongside the image pinch, and wheel listeners must be non-passive.
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const prevent = (event: Event) => { if (!(event.target instanceof Element && event.target.closest('video,iframe'))) event.preventDefault(); };
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect(), previous = transform.current;
      const next = Math.min(12, Math.max(1, previous.zoom * Math.exp(-event.deltaY / 200)));
      const focal = { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
      const size = containSize(rect.width, rect.height, image.current?.naturalWidth ?? 0, image.current?.naturalHeight ?? 0);
      const nextPan = clampPan(focalPan(previous.pan, previous.zoom, next, focal), size, rect, next);
      transform.current = { zoom: next, pan: nextPan }; setZoom(next); setPan(nextPan);
    };
    const gestures = ['gesturestart', 'gesturechange', 'gestureend', 'touchmove'];
    gestures.forEach(name => element.addEventListener(name, prevent, { passive: false }));
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { gestures.forEach(name => element.removeEventListener(name, prevent)); element.removeEventListener('wheel', wheel); };
  }, []);
  const replyPostId = post?.replyPostId ?? post?.id;
  const external = !!post && isExternalPostId(post.id);
  const requestReply = () => {
    if (external) { const url=getBlueskyPostUrl(post);if(url)window.open(url, '_blank', 'noopener,noreferrer');return; }
    setControls(true); setDetails(true);
    requestAnimationFrame(() => { const input = [...(stage.current?.closest('[role=dialog]')?.querySelectorAll<HTMLElement>('.lime-media-reply-launcher,input,textarea') ?? [])].find(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'); if (input?.matches('.lime-media-reply-launcher')) input.click(); else input?.focus(); input?.scrollIntoView({ block: 'nearest' }); });
  };
  const download = async () => {
    if (!current || current.type === 'youtube') return;
    try {
      const response = await fetch(current.src);
      if (!response.ok) throw new Error('download');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `LimeNote-${index + 1}.${blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'}`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch { toast.error('保存できませんでした。画像を新しいタブで開きます'); window.open(current.src, '_blank', 'noopener,noreferrer'); }
  };
  const postControls = (presentation: 'actions' | 'menu') => post && (post.replyId ?
    <CommentCard comment={{ ...post, id: post.replyId, postId: post.replyPostId! }} currentUserId={user?.id ?? null} mobileFlat mediaDownload={() => void download()} mediaPresentation={presentation} onMediaReply={requestReply} onMediaLikeChange={setLikeState} /> :
    <PostCard post={post} mediaPresentation={presentation} onMediaReply={requestReply} onMediaLikeChange={setLikeState} mediaDownload={() => void download()} />);
  const actions = () => <div className="lime-media-actions" {...(offline ? { inert: '' } : {})}>{postControls('actions')}</div>;
  const author = post ? <div className="lime-media-author">
    <Link className="lime-media-avatar" to={`/u/${post.author.username}`}><Avatar><AvatarImage src={post.author.avatarUrl} /><AvatarFallback>{post.author.displayName.slice(0, 1)}</AvatarFallback></Avatar></Link>
    <Link to={`/u/${post.author.username}`} className="lime-media-name"><strong><span className="lime-media-display-name">{post.author.displayName}</span>{post.author.isOfficial && <img src={`${import.meta.env.BASE_URL}verified.png`} alt="認証済み" />}</strong><span className="lime-media-username">@{post.author.username}</span></Link>
    {user && user.id !== post.userId && <div className="lime-media-follow"><FollowButton userId={post.author.id} /></div>}
  </div> : null;
  const replies = post && !external && !offline && replyPostId ? <><div ref={replyRef}><CommentForm postId={replyPostId} parentCommentId={post.replyId ?? null} variant="mediaViewer" replyTo={post} /></div><CommentList postId={replyPostId} parentCommentId={post.replyId ?? null} mobileFlat /></> : null;
  return createPortal(<PostOverlayContext.Provider value={quotedPost => { onClose(); openPostOverlay(quotedPost); }}><div ref={root} className={`lime-media-lightbox ${closing ? 'lime-media-closing' : ''} ${zoom > 1 ? 'lime-media-zoomed' : ''} ${controls ? '' : 'lime-media-controls-hidden'} ${details ? '' : 'lime-media-details-hidden'}`} role="dialog" aria-modal="true" aria-label="メディアを拡大表示">
    <section className="lime-media-main dark" onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <header className="lime-media-top">
        <button ref={closeButton} aria-label="画像を閉じる" onClick={close}><X className="lime-media-desktop-close" /><ArrowLeft className="lime-media-mobile-back" /></button>
        <div className="lime-media-top-right"><button className="lime-media-pane-toggle" aria-label={details ? '詳細を隠す' : '詳細を表示'} onClick={() => setDetails(value => !value)}>{details ? <ChevronsRight /> : <ChevronsLeft />}</button><div className="lime-media-mobile-menu">{postControls('menu')}</div></div>

      </header>
      <div ref={stage} className="lime-media-stage" onDoubleClick={event => {
        clearTimeout(tapTimer.current);
        if (!imageHit(event.clientX, event.clientY)) return;
        applyTransform(transform.current.zoom === 1 ? 2.5 : 1, { x: 0, y: 0 });
      }}
        onPointerDown={event => {
          if ((event.target as HTMLElement).closest('video,iframe,button')) return;
          if (sliding.current) return;
          if (event.isTrusted) event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          const points = [...pointers.current.values()], rect = event.currentTarget.getBoundingClientRect();
          const focal = points.length === 2 ? { x: (points[0].x + points[1].x) / 2 - rect.left - rect.width / 2, y: (points[0].y + points[1].y) / 2 - rect.top - rect.height / 2 } : { x: 0, y: 0 };
          const current = transform.current;
          if (points.length > 1) { clearTimeout(tapTimer.current); setControls(true); }
          gesture.current = { x: event.clientX, y: event.clientY, panX: current.pan.x, panY: current.pan.y, distance: points.length === 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0, scale: current.zoom, moved: false, pinched: points.length > 1, focal, imageHit: imageHit(event.clientX, event.clientY) };
        }}
        onPointerMove={event => {
          if (!pointers.current.has(event.pointerId)) return;
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          const points = [...pointers.current.values()], g = gesture.current;
          if (points.length === 2 && g.distance) {
            const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            const next = pinchZoom(g.scale, g.distance, distance);
            const rect = event.currentTarget.getBoundingClientRect();
            const focal = { x: (points[0].x + points[1].x) / 2 - rect.left - rect.width / 2, y: (points[0].y + points[1].y) / 2 - rect.top - rect.height / 2 };
            if (g.distance < 40) {
              g.distance = distance; g.focal = focal; return;
            }
            const nextPan = focalPan({ x: g.panX, y: g.panY }, g.scale, next, g.focal);
            applyTransform(next, { x: nextPan.x + focal.x - g.focal.x, y: nextPan.y + focal.y - g.focal.y }); g.moved = true;
          } else if (Math.hypot(event.clientX - g.x, event.clientY - g.y) > (event.pointerType === 'touch' ? 12 : 8)) {
            g.moved = true;
            if (transform.current.zoom > 1) applyTransform(transform.current.zoom, { x: g.panX + event.clientX - g.x, y: g.panY + event.clientY - g.y });
            else if (Math.abs(event.clientX - g.x) > Math.abs(event.clientY - g.y)) {
              const dx = event.clientX - g.x;
              setSwipeOffset((indexRef.current === 0 && dx > 0) || (indexRef.current === media.length - 1 && dx < 0) ? dx * .2 : dx);
            }
          }
        }}
        onPointerUp={event => {
          pointers.current.delete(event.pointerId);
          const g = gesture.current;
          if (pointers.current.size) {
            const point = [...pointers.current.values()][0], current = transform.current;
            gesture.current = { ...g, x: point.x, y: point.y, panX: current.pan.x, panY: current.pan.y, distance: 0, scale: current.zoom, moved: true, pinched: true }; return;
          }
          if (g.pinched) return;
          const dx = event.clientX - g.x, dy = event.clientY - g.y;
          const touch = event.pointerType === 'touch';
          const swipeThreshold = touch ? Math.min(110, Math.max(80, event.currentTarget.clientWidth * .22)) : 50;
          if (transform.current.zoom === 1 && Math.abs(dx) > swipeThreshold && Math.abs(dx) > Math.abs(dy) * (touch ? 1.35 : 1)) move(dx < 0 ? 1 : -1);
          else if (transform.current.zoom === 1 && Math.abs(dy) > (touch ? 160 : 100) && Math.abs(dy) > Math.abs(dx) * (touch ? 1.35 : 1)) close();
          else if (!g.moved) {
            if (!g.imageHit) close();
            else { clearTimeout(tapTimer.current); tapTimer.current = setTimeout(() => setControls(value => !value), 220); }
          }
          else setSwipeOffset(0);
        }} onPointerCancel={() => { pointers.current.clear(); setSwipeOffset(0); }}>
        {imageFailed ? <p>画像を読み込めませんでした。<button onClick={() => setImageFailed(false)}>再試行</button></p> : current?.type === 'youtube' ?
          <iframe src={`https://www.youtube-nocookie.com/embed/${current.youtubeId}?autoplay=1&rel=0&playsinline=1`} title="YouTube" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /> : current?.type === 'video' ?
          <video src={current.src} controls playsInline /> : <div ref={track} className="lime-media-image-track" style={{ transform: `translateX(${swipeOffset}px)` }}>
            {media.map((item, itemIndex) => (!item.type || item.type === 'image') && <img key={item.src} ref={itemIndex === index ? image : undefined} className={itemIndex === index ? undefined : 'lime-media-adjacent'} src={item.src} alt={itemIndex === index ? `拡大画像 ${index + 1}` : ''} aria-hidden={itemIndex !== index || undefined} draggable={false} onError={() => { if (itemIndex === index) setImageFailed(true); }} style={{ transform: itemIndex === index ? `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` : `translateX(${(itemIndex - index) * 100}%)` }} />)}
          </div>}
      </div>
      {index > 0 && <button className="lime-media-prev" aria-label="前の画像" onClick={() => move(-1)}><ChevronLeft /></button>}
      {index < media.length - 1 && <button className="lime-media-next" aria-label="次の画像" onClick={() => move(1)}><ChevronRight /></button>}
      <footer ref={dock} className="lime-media-bottom" onClick={event => { if (event.target === event.currentTarget) close(); }}>
        {media.length > 1 && <div className="lime-media-dots">{media.map((item, i) => <button key={item.src} aria-label={`画像 ${i + 1}`} aria-current={index === i} onClick={() => setIndex(i)} />)}</div>}
        {post && <div className="lime-media-mobile-summary">{author}<p>{renderStickerText(post.content, text => text.split(/(https?:\/\/[^\s]+)/g).map((part, i) => /^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-primary">{part}</a> : part))}</p></div>}
        {post && actions()}

        <div className="lime-media-mobile-reply">{post && !external && !offline && <div ><CommentForm postId={replyPostId!} parentCommentId={post.replyId ?? null} variant="mediaViewerMobile" replyTo={post} /></div>}</div>
        {!post && postQuery.isPending && <Loader2 className="animate-spin" />}
        {!post && postQuery.isError && <button onClick={() => void postQuery.refetch()}>ポストを再読み込み</button>}
      </footer>
    </section>
    <aside className="lime-media-detail" aria-hidden={!details || undefined} {...(!details ? { inert: '' } : {})}>
      {post ? <><div className="lime-media-author-header">{author}{postControls('menu')}</div><p className="lime-media-content">{renderStickerText(post.content, text => text.split(/(https?:\/\/[^\s]+)/g).map((part, i) => /^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-primary">{part}</a> : part))}</p><p className="lime-media-date">{new Date(post.createdAt).toLocaleTimeString('ja-JP', { hour: 'numeric', minute: '2-digit', hour12: true })} · {new Date(post.createdAt).toLocaleDateString('ja-JP', {year:'numeric',month:'long',day:'numeric'})}{post.clientName && ` · ${post.clientName}`}</p>{actions()}{replies}</> : <p>{postQuery.isError ? 'ポストの取得に失敗しました' : '読み込み中…'}</p>}
    </aside>
  </div></PostOverlayContext.Provider>, document.body);
}
