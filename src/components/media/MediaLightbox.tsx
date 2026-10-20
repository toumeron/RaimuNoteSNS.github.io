import { ContentLink } from "@/components/ui/button";
import { displayUsername } from "@/lib/utils";
import { usePrivateMediaUrl } from "@/components/ui/avatar";
import { useVideoMutedPreference } from "@/components/video/PostVideoPlayer";
import {resolvePrivateMediaUrl} from '@/lib/privateMediaFetch';
import { getVideoRecommendationPage, type VideoRecommendationCursor } from "@/api/video-recommendations";
import {twitterReplyUrl} from '@/lib/fxTwitter';
import { ProviderVerificationBadge } from "@/components/ui/avatar";
import { VideoLightboxPlayer } from "@/components/video/PostVideoPlayer";
import { videoSelections, videoSwipeDirection, mergeVideoQueue } from "@/lib/mediaThumbnail";
import { PostPoll } from '@/components/feed/PostPoll';
import { useCachedChatImage } from "@/lib/aiFriends";
import {forwardRef,type ImgHTMLAttributes} from 'react';
import { PrivateAccountBadge } from "@/components/ui/avatar";
import {getBlueskyPostUrl} from '@/lib/bluesky';
import { OfflineBookmarkContext } from "@/components/stickers/Stickers";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { getPostById } from '@/api/posts';
import { getExternalPost, isExternalPostId } from '@/api/external-posts';
import { getReplyPost } from "@/api/external-posts";
import { useAuth } from '@/hooks/useAuth';
import { postKey } from '@/hooks/useFeed';
import { PostCard } from '@/components/feed/PostCard';
import { CommentForm } from "@/components/post/CommentForm";
import { CommentList, CommentCard } from '@/components/post/CommentList';
import { FollowButton } from "@/components/profile/ProfileHeader";
import { renderStickerText } from "@/components/stickers/Stickers";
import { PostOverlayContext, usePostOverlay } from "@/components/layout/DesktopLayoutContext";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import type { PostWithAuthor } from '@/types';
import { type MediaViewerSelection } from './openMediaViewer';

import { containSize, clampPan, focalPan, pinchZoom } from "@/lib/mediaThumbnail";

const CachedLightboxImage=forwardRef<HTMLImageElement,ImgHTMLAttributes<HTMLImageElement>&{account?:string}>(({src,account,...props},ref)=>{const resolved=usePrivateMediaUrl(src);const cached=useCachedChatImage(resolved??'',account);return <img {...props} ref={ref} src={cached||undefined}/>});

export {MediaLightboxRoot} from './MediaLightboxRoot';

export function MediaLightbox({ selection: initialSelection, onClose }: { selection: MediaViewerSelection; onClose: () => void }) {
  const [selection,setSelection]=useState(initialSelection);
  const videoMode=!!selection.video;
  const [videoHost,setVideoHost]=useState<HTMLDivElement|null>(null);
  const [videoMuted,setVideoMuted]=useVideoMutedPreference();
  const [videoRate,setVideoRate]=useState(1),[videoDirection,setVideoDirection]=useState(0),[videoNotice,setVideoNotice]=useState(''),[videoAdvancing,setVideoAdvancing]=useState(false);
  const videoRequest=useRef(0),videoTarget=useRef<number|null>(null);
  const videoPageRequest=useRef<ReturnType<typeof videoFeed.refetch>|null>(null);
  const videoSource=useRef(''),videoPointers=useRef(new Map<number,{x:number;y:number}>()),videoGesture=useRef<{x:number;y:number;panX:number;panY:number;scale:number;distance:number;focal:{x:number;y:number};moved:boolean;pinched:boolean}|null>(null),suppressVideoClick=useRef(0);
  const advanceVideoRef=useRef<(delta:number,motion?:number)=>Promise<void>>(async()=>{});
  const { user } = useAuth();
  const videoFeed=useInfiniteQuery({
    queryKey:['media-video-recommendations-v2',user?.id,initialSelection.video?.postId],initialPageParam:undefined as VideoRecommendationCursor|undefined,
    queryFn:({pageParam,signal})=>getVideoRecommendationPage(initialSelection,user?.id,pageParam,signal),getNextPageParam:page=>page.nextCursor??undefined,
    enabled:!!initialSelection.video?.postId&&!initialSelection.offline,staleTime:60_000,retry:false,refetchOnWindowFocus:false,
  });
  const queuedVideos=(data:typeof videoFeed.data=videoFeed.data)=>videoSelections(initialSelection,data?.pages);
  const videoQueueRef=useRef<MediaViewerSelection[]>([initialSelection]);
  const watchedVideoCount=useRef(1);
  watchedVideoCount.current=Math.max(watchedVideoCount.current,videoQueueRef.current.findIndex(item=>(item.video?.postId??item.url)===(selection.video?.postId??selection.url))+1);
  const incoming=mergeVideoQueue(videoQueueRef.current,selection,queuedVideos(),watchedVideoCount.current);
  videoQueueRef.current.splice(0,videoQueueRef.current.length,...incoming);
  const videoQueue=videoQueueRef.current;
  const videoIndex=videoQueue.findIndex(item=>(item.video?.postId??item.url)===(selection.video?.postId??selection.url));
  const prefetchedVideoIndexes=useRef(new Set<number>());
  useEffect(()=>{
    if(!videoMode||initialSelection.offline||videoAdvancing||videoFeed.isFetching||videoFeed.isError||!videoFeed.hasNextPage||videoQueue.length-videoIndex>5||prefetchedVideoIndexes.current.has(videoIndex))return;
    prefetchedVideoIndexes.current.add(videoIndex);
    const read=videoFeed.fetchNextPage({cancelRefetch:false});
    videoPageRequest.current=read;
    const clear=()=>{if(videoPageRequest.current===read)videoPageRequest.current=null;};
    void read.then(clear,clear);
  },[videoMode,initialSelection.offline,videoAdvancing,videoFeed.isFetching,videoFeed.isError,videoFeed.hasNextPage,videoIndex,videoQueue.length]);
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
  const [likeState, setLikeState] = useState<{ liked: boolean; count: number;postId:string } | null>(null);
  const post = useMemo(() => sourcePost && likeState?.postId===id ? { ...sourcePost, likedByMe: likeState.liked, likesCount: likeState.count } : sourcePost, [sourcePost, likeState,id]);
  advanceVideoRef.current=async(delta:number,motion=delta)=>{
    const request=++videoRequest.current;
    const next=Math.max(0,(videoTarget.current??videoIndex)+delta);
    videoTarget.current=next;
    setVideoNotice('');
    try{
      const queue=videoQueue;
      if(next>=queue.length&&!initialSelection.offline&&(videoFeed.isPending||videoFeed.isError||videoFeed.hasNextPage)){
        setVideoAdvancing(true);setSwipeOffset(0);
        let data=videoFeed.data;
        // Share each page request while every gesture updates the requested destination.
        while(next>=queue.length){
          if(!videoPageRequest.current){
            const read=!data?.pages.length?videoFeed.refetch({cancelRefetch:false}):videoFeed.fetchNextPage({cancelRefetch:false});
            videoPageRequest.current=read;
            const clear=()=>{if(videoPageRequest.current===read)videoPageRequest.current=null;};
            void read.then(clear,clear);
          }
          const result=await videoPageRequest.current;
          if(request!==videoRequest.current)return;
          if(result.isError)throw result.error;
          data=result.data;
          const candidates=mergeVideoQueue(queue,selection,queuedVideos(result.data),watchedVideoCount.current);
          queue.splice(0,queue.length,...candidates);
          if(!result.data?.pages.at(-1)?.nextCursor)break;
        }
      }
      if(request!==videoRequest.current)return;
      if(!queue[next]){videoTarget.current=null;return;}
      videoSource.current='';setLikeState(null);setVideoDirection(motion);setSelection(queue[next]);setZoom(1);setPan({x:0,y:0});setSwipeOffset(0);setControls(true);setDetails(true);
    }catch(error){if(request===videoRequest.current)setVideoNotice((error as Error).name==='VideoSourceRateLimitError'?(error as Error).message:'動画を読み込めませんでした。もう一度お試しください');}
    finally{if(request===videoRequest.current){videoTarget.current=null;setVideoAdvancing(false);}}
  };
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
    ++videoRequest.current;videoTarget.current=null;setVideoAdvancing(false);
    setClosing(true);
    closeTimer.current = setTimeout(onClose, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160);
  }, [onClose]);
  useEffect(() => () => { ++videoRequest.current;clearTimeout(closeTimer.current); clearTimeout(tapTimer.current); }, []);
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
    if(videoMode)document.querySelectorAll<HTMLVideoElement>('.post-video-player video').forEach(video=>video.pause());
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
      if(videoMode&&(event.key==='ArrowDown'||event.key==='ArrowUp')){event.preventDefault();void advanceVideoRef.current(event.key==='ArrowDown'?1:-1);}
      if (event.key === 'ArrowLeft'&&!videoMode) move(-1);
      if (event.key === 'ArrowRight'&&!videoMode) move(1);
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
  }, [close, move,videoMode]);
  const geometry = () => {
    const rect = stage.current!.getBoundingClientRect();
    const video=videoMode?stage.current?.querySelector('video'):null;
    return { rect, size: containSize(rect.width, rect.height, videoMode?(video?.videoWidth||selection.video?.video.width||0):(image.current?.naturalWidth??0), videoMode?(video?.videoHeight||selection.video?.video.height||0):(image.current?.naturalHeight??0)) };
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
      const size = geometry().size;
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
    if (external) { const url=twitterReplyUrl(post?.id??'')??getBlueskyPostUrl(post);if(url)window.open(url, '_blank', 'noopener,noreferrer');return; }
    if(videoMode){root.current?.querySelector<HTMLButtonElement>('.lime-media-mobile-reply .lime-media-reply-launcher')?.click();return;}
    setControls(true); setDetails(true);
    requestAnimationFrame(() => { const input = [...(stage.current?.closest('[role=dialog]')?.querySelectorAll<HTMLElement>('.lime-media-reply-launcher,input,textarea') ?? [])].find(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'); if (input?.matches('.lime-media-reply-launcher')) input.click(); else input?.focus(); input?.scrollIntoView({ block: 'nearest' }); });
  };
  const download = async () => {
    if (!current || current.type === 'youtube') return;
    try {
      const source=videoMode?videoSource.current:current.src;if(!source){toast.error('動画の読み込みが完了してからお試しください');return;}
      const resolved=await resolvePrivateMediaUrl(source);if(!resolved)throw new Error('download');
      const response = await fetch(resolved);
      if (!response.ok) throw new Error('download');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `LimeNote-${index + 1}.${blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'}`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {if(videoMode)toast.error('動画を保存できませんでした');else{toast.error('保存できませんでした。画像を新しいタブで開きます'); window.open(current.src, '_blank', 'noopener,noreferrer');} }
  };
  const postControls = (presentation: 'actions' | 'menu') => post && (post.replyId ?
    <CommentCard key={`${post.id}:${presentation}`} comment={{ ...post, id: post.replyId, postId: post.replyPostId! }} currentUserId={user?.id ?? null} mobileFlat mediaDownload={() => void download()} mediaPresentation={presentation} onMediaReply={requestReply} onMediaLikeChange={state=>setLikeState({...state,postId:id})} /> :
    <PostCard key={`${post.id}:${presentation}`} post={post} mediaPresentation={presentation} onMediaReply={requestReply} onMediaLikeChange={state=>setLikeState({...state,postId:id})} mediaDownload={() => void download()} />);
  const actions = () => <div className="lime-media-actions" {...(offline ? { inert: '' } : {})}>{postControls('actions')}</div>;
  const author = post ? <div className="lime-media-author">
    <Link className="lime-media-avatar" to={`/u/${post.author.username}`}><Avatar><AvatarImage src={post.author.avatarUrl} /><AvatarFallback>{post.author.displayName.slice(0, 1)}</AvatarFallback></Avatar></Link>
    <Link to={`/u/${post.author.username}`} className="lime-media-name"><strong><span className="lime-media-display-name">{post.author.displayName}</span>{post.author.isPrivate && <PrivateAccountBadge/>}<ProviderVerificationBadge verification={post.author.providerVerification}/>{post.author.isOfficial && <img src={`${import.meta.env.BASE_URL}verified.png`} alt="認証済み" />}</strong><span className="lime-media-username">@{displayUsername(post.author.username)}</span></Link>
    {user && user.id !== post.userId && <div className="lime-media-follow"><FollowButton userId={post.author.id} /></div>}
  </div> : null;
  const replies = post && !external && !offline && replyPostId ? <><div ref={replyRef}><CommentForm postId={replyPostId} parentCommentId={post.replyId ?? null} variant="mediaViewer" replyTo={post} /></div><CommentList postId={replyPostId} parentCommentId={post.replyId ?? null} mobileFlat /></> : null;
  return createPortal(<PostOverlayContext.Provider value={quotedPost => { onClose(); openPostOverlay(quotedPost); }}><div ref={root} className={`lime-media-lightbox ${videoMode?'lime-video-mode':''} ${closing ? 'lime-media-closing' : ''} ${zoom > 1 ? 'lime-media-zoomed' : ''} ${controls ? '' : 'lime-media-controls-hidden'} ${details ? '' : 'lime-media-details-hidden'}`} role="dialog" aria-modal="true" aria-busy={videoMode?videoAdvancing:undefined} aria-label={videoMode?'動画を拡大表示':'メディアを拡大表示'}
    onPointerDownCapture={event=>{
      if(!videoMode||event.button!==0)return;
      const control=(event.target as Element).closest('button,input,select,a,textarea');
      if(control&&!control.matches('.lime-video-overlay-play'))return;
      videoPointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});
      const points=[...videoPointers.current.values()],current=transform.current,rect=stage.current!.getBoundingClientRect();
      if(points.length===1)videoGesture.current={x:event.clientX,y:event.clientY,panX:current.pan.x,panY:current.pan.y,scale:current.zoom,distance:0,focal:{x:0,y:0},moved:false,pinched:false};
      else if(points.length===2){
        clearTimeout(tapTimer.current);setSwipeOffset(0);
        videoGesture.current={x:event.clientX,y:event.clientY,panX:current.pan.x,panY:current.pan.y,scale:current.zoom,distance:Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y),focal:{x:(points[0].x+points[1].x)/2-rect.left-rect.width/2,y:(points[0].y+points[1].y)/2-rect.top-rect.height/2},moved:true,pinched:true};
      }
    }} onPointerMoveCapture={event=>{
      if(!videoPointers.current.has(event.pointerId))return;
      videoPointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});
      const g=videoGesture.current;if(!g)return;
      const points=[...videoPointers.current.values()],dx=event.clientX-g.x,dy=event.clientY-g.y;
      if(points.length===2&&g.distance){
        event.preventDefault();clearTimeout(tapTimer.current);
        const rect=stage.current!.getBoundingClientRect(),distance=Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);
        const focal={x:(points[0].x+points[1].x)/2-rect.left-rect.width/2,y:(points[0].y+points[1].y)/2-rect.top-rect.height/2};
        const next=pinchZoom(g.scale,g.distance,distance),panned=focalPan({x:g.panX,y:g.panY},g.scale,next,g.focal);
        applyTransform(next,{x:panned.x+focal.x-g.focal.x,y:panned.y+focal.y-g.focal.y});g.moved=true;
      }else if(Math.hypot(dx,dy)>12){
        g.moved=true;event.preventDefault();clearTimeout(tapTimer.current);if(event.isTrusted)event.currentTarget.setPointerCapture(event.pointerId);
        if(transform.current.zoom>1)applyTransform(transform.current.zoom,{x:g.panX+dx,y:g.panY+dy});
        else if(!g.pinched&&Math.abs(dy)>Math.abs(dx)*1.35)setSwipeOffset(dy*.3);
      }
    }} onPointerUpCapture={event=>{
      if(!videoPointers.current.has(event.pointerId))return;
      videoPointers.current.delete(event.pointerId);const g=videoGesture.current;if(!g)return;
      if(videoPointers.current.size){const point=[...videoPointers.current.values()][0],current=transform.current;videoGesture.current={...g,x:point.x,y:point.y,panX:current.pan.x,panY:current.pan.y,scale:current.zoom,distance:0,moved:true,pinched:true};return;}
      videoGesture.current=null;setSwipeOffset(0);
      if(g.moved||g.pinched){
        suppressVideoClick.current=Date.now()+350;event.preventDefault();
        if(!g.pinched&&transform.current.zoom===1){const direction=videoSwipeDirection(event.clientX-g.x,event.clientY-g.y);if(direction)void advanceVideoRef.current(direction,event.clientY>=g.y?1:-1);}
      }
    }} onPointerCancelCapture={()=>{videoPointers.current.clear();videoGesture.current=null;setSwipeOffset(0);}}
    onClickCapture={event=>{const control=(event.target as Element).closest('button,input,select,a,textarea');if(videoMode&&Date.now()<suppressVideoClick.current&&(!control||control.matches('.lime-video-overlay-play'))){event.preventDefault();event.stopPropagation();}}}>
    <section className="lime-media-main dark" onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <header className="lime-media-top">
        <button ref={closeButton} aria-label={videoMode?'動画を閉じる':'画像を閉じる'} onClick={close}><X className="lime-media-desktop-close" /><ArrowLeft className="lime-media-mobile-back" /></button>
        <div className="lime-media-top-right">{!!id && <button className="lime-media-pane-toggle" aria-label={details ? '詳細を隠す' : '詳細を表示'} onClick={() => setDetails(value => !value)}>{details ? <ChevronsRight /> : <ChevronsLeft />}</button>}<div className="lime-media-mobile-menu">{postControls('menu')}</div></div>

      </header>
      <div ref={stage} className="lime-media-stage" onDoubleClick={event => {
        clearTimeout(tapTimer.current);
        if (!imageHit(event.clientX, event.clientY)) return;
        applyTransform(transform.current.zoom === 1 ? 2.5 : 1, { x: 0, y: 0 });
      }}
        onPointerDown={event => {
          if(videoMode)return;
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
          if(videoMode)return;
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
          if(videoMode)return;
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
        {videoMode&&selection.video?<>{videoQueue.slice(videoIndex,videoIndex+2).map((item,offset)=>item.video&&<div key={item.video.postId||item.url} aria-hidden={offset>0||undefined} className={`lime-video-frame ${offset?'lime-video-preload':videoDirection>0?'lime-video-forward':videoDirection<0?'lime-video-backward':''}`} style={{transform:`translateY(${offset?0:swipeOffset}px)`}}>
          <VideoLightboxPlayer suspended={offset>0} selection={item.video} host={offset?null:videoHost} muted={videoMuted} onMutedChange={setVideoMuted} rate={videoRate} onRateChange={setVideoRate} onSource={url=>{if(!offset)videoSource.current=url;}} zoom={offset?1:zoom} pan={offset?{x:0,y:0}:pan} onTap={toggle=>{clearTimeout(tapTimer.current);tapTimer.current=setTimeout(()=>{if(window.matchMedia('(max-width: 767px)').matches)setControls(value=>!value);else toggle();},220);}}/>
        </div>)}</>:imageFailed ? <p>画像を読み込めませんでした。<button onClick={() => setImageFailed(false)}>再試行</button></p> : current?.type === 'youtube' ?
          <iframe src={`https://www.youtube-nocookie.com/embed/${current.youtubeId}?autoplay=1&rel=0&playsinline=1`} title="YouTube" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /> : current?.type === 'video' ?
          <video src={current.src} controls playsInline /> : <div ref={track} className="lime-media-image-track" style={{ transform: `translateX(${swipeOffset}px)` }}>
            {media.map((item, itemIndex) => (!item.type || item.type === 'image') && <CachedLightboxImage referrerPolicy={post?.source==='x'?'no-referrer':undefined} account={user?.id} key={item.src} ref={itemIndex === index ? image : undefined} className={itemIndex === index ? undefined : 'lime-media-adjacent'} src={item.src} alt={itemIndex === index ? `拡大画像 ${index + 1}` : ''} aria-hidden={itemIndex !== index || undefined} draggable={false} onError={() => { if (itemIndex === index) setImageFailed(true); }} style={{ transform: itemIndex === index ? `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` : `translateX(${(itemIndex - index) * 100}%)` }} />)}
          </div>}
        {videoAdvancing&&<div className="lime-video-next-loading" role="status" aria-label="次の動画を読み込み中"><Loader2 className="animate-spin"/></div>}
      </div>
      {!videoMode&&index > 0 && <button className="lime-media-prev" aria-label="前の画像" onClick={() => move(-1)}><ChevronLeft /></button>}
      {!videoMode&&index < media.length - 1 && <button className="lime-media-next" aria-label="次の画像" onClick={() => move(1)}><ChevronRight /></button>}
      <footer ref={dock} className="lime-media-bottom" onClick={event => { if (event.target === event.currentTarget) close(); }}>
        {!videoMode&&media.length > 1 && <div className="lime-media-dots">{media.map((item, i) => <button key={item.src} aria-label={`画像 ${i + 1}`} aria-current={index === i} onClick={() => setIndex(i)} />)}</div>}
        {post && <div className="lime-media-mobile-summary">{author}<p>{renderStickerText(post.content, text => text.split(/(https?:\/\/[^\s]+)/g).map((part, i) => /^https?:\/\//.test(part) ? <ContentLink key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-primary">{part}</ContentLink> : part))}</p></div>}
        {post && actions()}

        <div className="lime-media-mobile-reply">{post && !external && !offline && <div ><CommentForm postId={replyPostId!} parentCommentId={post.replyId ?? null} variant="mediaViewerMobile" replyTo={post} /></div>}</div>
        {videoMode&&<><div ref={setVideoHost}/><div className="lime-video-navigation"><button aria-label="前の動画" onClick={()=>void advanceVideoRef.current(-1)}>前の動画</button><button aria-label="次の動画" onClick={()=>void advanceVideoRef.current(1)}>次の動画</button></div>{videoNotice&&<p className="lime-video-notice" role="status">{videoNotice}<button onClick={()=>void advanceVideoRef.current(1)}>再試行</button></p>}</>}
        {!!id && !post && postQuery.isPending && <Loader2 className="animate-spin" />}
        {!post && postQuery.isError && <button onClick={() => void postQuery.refetch()}>ポストを再読み込み</button>}
      </footer>
    </section>
    {!!id&&!videoMode && <aside className="lime-media-detail" aria-hidden={!details || undefined} {...(!details ? { inert: '' } : {})}>
      {post ? <><div className="lime-media-author-header">{author}{postControls('menu')}</div><p className="lime-media-content">{renderStickerText(post.content, text => text.split(/(https?:\/\/[^\s]+)/g).map((part, i) => /^https?:\/\//.test(part) ? <ContentLink key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-primary">{part}</ContentLink> : part))}</p>{post.poll && <PostPoll post={post}/>}<p className="lime-media-date">{new Date(post.createdAt).toLocaleTimeString('ja-JP', { hour: 'numeric', minute: '2-digit', hour12: true })} · {new Date(post.createdAt).toLocaleDateString('ja-JP', {year:'numeric',month:'long',day:'numeric'})}{post.clientName && ` · ${post.clientName}`}</p>{actions()}{replies}</> : <p>{postQuery.isError ? 'ポストの取得に失敗しました' : '読み込み中…'}</p>}
    </aside>}
  </div></PostOverlayContext.Provider>, document.body);
}
