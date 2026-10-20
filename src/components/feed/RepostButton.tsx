import { recordRecommendationEngagement, recommendationIdentity, recommendationFingerprint, recordRecommendationLike, addRecommendationInterest, selectRecommendationLikeSamples } from "@/lib/recommendations";
import { useAuth, useBlueskySession } from "@/hooks/useAuth";
import { RepostIcon } from "@/components/feed/PostPoll";
import { useRef, useState, useContext, useEffect, type ReactNode, useCallback } from "react";
import { Pencil, Quote, Bookmark, Star, StarOff, Pin, PinOff, Heart } from "lucide-react";
import { useToggleRepost } from "@/hooks/useFeed";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/button";
import { usePostOverlay } from "@/components/layout/DesktopLayoutContext";
import { type PostWithAuthor } from "@/types/index";
import { useQuery, useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { getExternalRepostState, isExternalPostId, getNativeRepostState, getExternalLikeState, setExternalLike, getReplyPost, getReplyRepostState, isReplyPostId } from "@/api/external-posts";
import { AnimatedCount } from "@/components/feed/QuotedPost";
import { toast } from "sonner";
import { OfflineBookmarkContext } from "@/components/stickers/Stickers";
import { getBookmarkIds, setBookmark, type BookmarkTarget } from "@/api/users";
import { cn } from "@/lib/utils";
import { isPostHighlighted, postHighlightKey, profileHighlightsKey, setPostHighlighted, getProfilePin, setProfilePin, profilePinKey } from "@/api/comments";
import { LikeButton } from "@/components/post/LikeButton";
import { fetchBlueskyPostViewerState, getBlueskyUriFromPostId, likeBlueskyPost, unlikeBlueskyPost } from "@/lib/bluesky";
import * as Dialog from "@radix-ui/react-dialog";
import { supabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/currentUser";
import { useIsPWA, usePageVisible } from "@/hooks/useViewportWidth";

// RepostButton
// PostActionSheet
function PostActionSheet({ open, onOpenChange, title, children, onCloseAutoFocus }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new CustomEvent('lime-post-action-sheet-open', {detail: true}));
    return () => {window.dispatchEvent(new CustomEvent('lime-post-action-sheet-open', {detail: false}));};
  }, [open]);
  return <Dialog.Root modal={false} open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      {open && <button type="button" aria-label="リポストの操作を閉じる" data-lime-dismiss-backdrop className="lime-post-action-sheet-backdrop" onTouchMove={event => event.preventDefault()} onClick={event => {event.stopPropagation();onOpenChange(false);}} /> }
      <Dialog.Content className="lime-post-action-sheet" aria-describedby={undefined} onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={onCloseAutoFocus} onPointerDownOutside={() => onOpenChange(false)} onClick={event => event.stopPropagation()}>
        <Dialog.Title className="sr-only">{title}</Dialog.Title>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

// PWA menus use OS conventions; the browser cannot create a native OS context menu.
function mobilePostMenuOS() {
  return typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios' : 'android';
}

function useMobilePostMenu() {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)');
    const update = () => setMobile(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return mobile;
}

// RepostButton
function RepostButton({ post, mobilePresentation = false, refreshState = false, active = true }: { post: PostWithAuthor; mobilePresentation?: boolean; refreshState?: boolean; active?: boolean }) {
  const pageVisible = usePageVisible();
  const openPostOverlay = usePostOverlay();
  const pendingQuote = useRef(false);
  const mutation = useToggleRepost();
  const {user} = useAuth();
  const [persistedState,setPersistedState]=useState<{count:number;reposted:boolean;updatedAt:number}|null>(null);
  const externalState = useQuery({queryKey: ['repost-state', post.id, user?.id ?? null],
    queryFn: ({signal}) => isReplyPostId(post.id) ? getReplyRepostState(post.id) : isExternalPostId(post.id) ? getExternalRepostState(post.id,signal) : getNativeRepostState(post.id), enabled: active && pageVisible && (refreshState || isExternalPostId(post.id) || isReplyPostId(post.id)), staleTime:30_000, ...(isExternalPostId(post.id)?{retry:false,retryOnMount:false,refetchOnReconnect:false,refetchOnMount:false}:{}), refetchOnWindowFocus:false});
  const usePersisted = persistedState && externalState.dataUpdatedAt <= persistedState.updatedAt;
  const reposted = usePersisted ? persistedState.reposted : externalState.data?.repostedByMe ?? post.repostedByMe;
  const external=isExternalPostId(post.id);
  const localCount=usePersisted?persistedState.count:externalState.data?.repostsCount??(external?0:post.repostsCount??0);
  const remoteCount=external?post.externalDetails?.reposts??post.repostsCount??0:0;
  const count=remoteCount+localCount;
  const mobile = useMobilePostMenu();
  const [sheetOpen, setSheetOpen] = useState(false);
  const quoteAfterClose = (event: Event) => {
    if (!pendingQuote.current) return;
    event.preventDefault();
    pendingQuote.current = false;
    if (isReplyPostId(post.id) && !post.replyToUsername) {
      void getReplyPost(post.id).then(source => {
        if (source) openPostOverlay(source);
        else toast.error('引用元の返信を閲覧できません');
      }).catch(() => toast.error('引用元の返信の取得に失敗しました'));
    } else openPostOverlay(post);
  };
  const repost = () => { const viewer = user?.id ?? null; mutation.mutate(post.id, {onSuccess: result => {
    recordRecommendationEngagement(post,viewer,'repost',result.reposted);
    if (refreshState || isExternalPostId(post.id) || isReplyPostId(post.id)) setPersistedState({reposted:result.reposted,count:result.repostsCount ?? Math.max(0,localCount+(result.reposted?1:-1)),updatedAt:externalState.dataUpdatedAt});
  }}); };
  const trigger = <button type="button" aria-label="リポスト" data-lime-post-action="repost" disabled={mutation.isPending}
    onClick={mobile ? () => setSheetOpen(true) : undefined}
    className={`group inline-flex h-full items-center gap-1.5 rounded-full py-1 transition-colors outline-none select-none disabled:opacity-50 ${mobilePresentation ? 'px-2 text-[13px]' : 'px-2.5 text-sm'} hover:text-green-500 ${reposted ? 'text-green-500' : 'text-muted-foreground'}`}>
    <RepostIcon className="h-5 w-5 shrink-0 transition-transform duration-200 group-hover:scale-110 pointer-events-none" />
    <span className={`font-bold tabular-nums pointer-events-none ${mobilePresentation ? 'text-[15px]' : 'text-sm'}`}><AnimatedCount count={count} /></span>
  </button>;
  return <div className="flex h-full items-center" onClick={event => event.stopPropagation()}>
    {mobile ? <>
      {trigger}
      <PostActionSheet open={sheetOpen} onOpenChange={setSheetOpen} title="リポストの操作" onCloseAutoFocus={quoteAfterClose}>
        <button type="button" disabled={mutation.isPending} onClick={() => {setSheetOpen(false);repost();}}><RepostIcon />{reposted ? 'リポストを取り消す' : 'リポストする'}</button>
        <button type="button" onClick={() => {pendingQuote.current=true;setSheetOpen(false);}}><Pencil />引用リポスト</button>
      </PostActionSheet>
    </> : <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={event => event.stopPropagation()} onCloseAutoFocus={quoteAfterClose}>
        <DropdownMenuItem disabled={mutation.isPending} onSelect={repost}><RepostIcon className="mr-2 h-4 w-4" />{reposted ? 'リポストを取り消す' : 'リポストする'}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => {pendingQuote.current=true;}}><Quote className="mr-2 h-4 w-4" />引用リポスト</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>}
  </div>;
}

// BookmarkButton
function BookmarkButton({ post, className }: { post: BookmarkTarget; className?: string }) {
  const { user } = useAuth();
  const offline=useContext(OfflineBookmarkContext);
  const client = useQueryClient();
  const key = ['bookmarks', 'ids', user?.id];
  const mutationKey = ['bookmark-action', user?.id, post.id];
  const { data = [], isPending, isError, refetch } = useQuery({ queryKey: key, queryFn: () => getBookmarkIds(user!.id), enabled: !!user && !offline, staleTime: 30_000 });
  const saved = (offline?.bookmarkIds??data).includes(post.id);
  const change = (saved: boolean) => client.setQueryData<string[]>(key, old => saved ? [...new Set([...(old ?? []), post.id])] : (old ?? []).filter(id => id !== post.id));
  const pending = useIsMutating({ mutationKey }) > 0;
  const mutation = useMutation({
    mutationKey,
    mutationFn: (next: boolean) => setBookmark(post, next, user!.id),
    onMutate: async next => { await client.cancelQueries({ queryKey: key }); const previous = client.getQueryData<string[]>(key)?.includes(post.id) ?? false; change(next); return { previous, key, postId: post.id }; },
    onSuccess: (_data, next, context) => { toast.success(next ? 'ブックマークに追加しました' : 'ブックマークを解除しました'); client.invalidateQueries({ queryKey: ['bookmarks', 'pages', context?.key[2]] }); client.invalidateQueries({ queryKey: ['bookmarks', 'shared'] }); },
    onError: (_error, _next, context) => { if (context) client.setQueryData<string[]>(context.key, old => context.previous ? [...new Set([...(old ?? []), context.postId])] : (old ?? []).filter(id => id !== context.postId)); toast.error('ブックマークの更新に失敗しました'); },
  });
  return <button type="button" aria-label={saved ? 'ブックマークを解除' : 'ブックマークに追加'} aria-pressed={saved} disabled={!!offline || pending || (!!user && isPending)} data-lime-bookmark-button className={cn('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full p-1.5 text-muted-foreground transition-colors hover:text-primary disabled:opacity-50', saved && 'text-primary', className)} onClick={event => {
    event.preventDefault(); event.stopPropagation();
    if (!user) { toast.error('ログインが必要です'); return; }
    if (isError) { void refetch(); toast.error('ブックマークの取得に失敗しました。もう一度お試しください'); return; }
    mutation.mutate(!saved);
  }}><Bookmark className="h-5 w-5" fill={saved ? 'currentColor' : 'none'} /></button>;
}

// HighlightPostMenuButton
function HighlightPostMenuButton({ userId, postId, onClose }: { userId: string; postId: string; onClose: () => void }) {
  const client = useQueryClient();
  const highlight = useQuery({ queryKey: postHighlightKey(userId, postId), queryFn: () => isPostHighlighted(userId, postId) });
  const highlighted = highlight.data === true;
  const mutation = useMutation({
    mutationFn: () => setPostHighlighted(userId, postId, !highlighted),
    onSuccess: () => {
      client.setQueryData(postHighlightKey(userId, postId), !highlighted);
      void client.invalidateQueries({ queryKey: profileHighlightsKey(userId) });
      onClose();
      toast.success(highlighted ? 'ハイライトからポストを解除しました' : 'ハイライトにポストを追加しました');
    },
    onError: () => toast.error('ハイライトを変更できませんでした'),
  });

  return <button type="button" disabled={highlight.isPending || highlight.isError || mutation.isPending}
    onClick={event => { event.preventDefault(); event.stopPropagation(); mutation.mutate(); }}
    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted disabled:opacity-50">
    {highlighted ? <StarOff className="h-4 w-4" /> : <Star className="h-4 w-4" />}
    {highlighted ? 'ハイライトから解除' : 'ハイライトに追加'}
  </button>;
}

function PinPostMenuButton({userId,postId,onClose}:{userId:string;postId:string;onClose:()=>void}){
  const client=useQueryClient();
  const pin=useQuery({queryKey:profilePinKey(userId),queryFn:()=>getProfilePin(userId)});
  const pinned=pin.data===postId;
  const mutation=useMutation({mutationFn:()=>setProfilePin(userId,pinned?null:postId),onSuccess:()=>{client.setQueryData(profilePinKey(userId),pinned?null:postId);onClose();toast.success(pinned?'ポストの固定を解除しました':'プロフィールにポストを固定しました');},onError:()=>toast.error('ポストの固定を変更できませんでした')});
  return <button type="button" disabled={pin.isPending||pin.isError||mutation.isPending} onClick={event=>{event.preventDefault();event.stopPropagation();mutation.mutate();}} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted disabled:opacity-50">{pinned?<PinOff className="h-4 w-4"/>:<Pin className="h-4 w-4"/>}{pinned?'プロフィールから固定を解除':'プロフィールに固定'}</button>;
}

// ExternalLikeButton
function ExternalLikeButton({post,onChange,active=true}:{post:PostWithAuthor;onChange?:(state:{liked:boolean;count:number})=>void;active?:boolean}){
 const pageVisible=usePageVisible();
 const {user}=useAuth(),session=useBlueskySession(post.id),client=useQueryClient();
 const [sourceCount,setSourceCount]=useState(post.likesCount);
 useEffect(()=>setSourceCount(post.likesCount),[post.id,post.likesCount]);
 const key=['external-like',user?.id??null,post.id];
 const state=useQuery({queryKey:key,queryFn:()=>getExternalLikeState(post.id,user?.id??null),enabled:active&&pageVisible,staleTime:30000});
 const persist=async(liked:boolean)=>{
  if(!user){toast.error('LimeNoteへのログインが必要です');throw new Error('LimeNoteへのログインが必要です');}
  let saved;try{saved=await setExternalLike(post,liked);}catch(error){toast.error('いいねを保存できませんでした');throw error;}let count=sourceCount;
  // Cloud persistence owns the LimeNote state. Provider errors must never
  // undo a successful save or require an external account for a local like.
  recordRecommendationLike(post,liked,user.id);
  if(session){
   try{
    const uri=getBlueskyUriFromPostId(post.id);if(!uri)throw new Error('投稿URLが無効です');
    const remote=await fetchBlueskyPostViewerState(uri);
    if(liked){
     if(!remote.likeUri){const cid=remote.cid??post.cid;if(!cid)throw new Error('投稿情報が取得できません');await likeBlueskyPost(uri,cid);count++;}
     saved=await setExternalLike(post,true,true);
    }else if(remote.likeUri){await unlikeBlueskyPost(remote.likeUri);count=Math.max(0,count-1);}
   }catch{toast.info(liked?'LimeNoteにいいねを保存しました。外部SNSへの反映に失敗しました。':'LimeNoteのいいねを解除しました。外部SNSへの反映に失敗しました。');}
  }
  setSourceCount(count);client.setQueryData(key,saved);
  void client.invalidateQueries({queryKey:['posts','likes',user.id]});
  void client.invalidateQueries({queryKey:['recommendation-preferences',user.id]});
  // New likes affect future recommendation pages without rearranging the
  // timeline the reader already has open.
  client.setQueriesData<any>({predicate:query=>query.queryKey[0]==='feed'&&query.queryKey[1]==='recommended'&&query.queryKey[3]===user.id},current=>current?{...current,pages:current.pages.map((page:any)=>{
   const preferences={...page.preferences,authors:{...page.preferences.authors},terms:{...page.preferences.terms},recentAuthors:{...page.preferences.recentAuthors},recentTerms:{...page.preferences.recentTerms},authorTopics:Object.fromEntries(Object.entries(page.preferences.authorTopics??{}).map(([id,topics])=>[id,{...topics as object}]))};
   if(liked&&!preferences.likedPostIds?.includes(post.id))addRecommendationInterest(preferences,post,2);
   if(liked)preferences.feedback=(preferences.feedback??[]).filter((row:any)=>row.id!==recommendationIdentity(post)&&(!row.fingerprint||row.fingerprint!==recommendationFingerprint(post)));
   preferences.likedPostIds=[...(preferences.likedPostIds??[]).filter((id:string)=>id!==post.id),...(liked?[post.id]:[])];
   preferences.likedSamples=selectRecommendationLikeSamples([...(liked?[{...post,engagedAt:new Date().toISOString()}]:[]),...(preferences.likedSamples??[]).filter((row:PostWithAuthor)=>row.id!==post.id)]);
   return {...page,preferences,next:page.next?{...page.next,preferences}:undefined};
  })}:current);
  return {liked:saved.liked,count:count+saved.unmirroredCount};
 };
 return <LikeButton postId={post.id} liked={state.data?.liked??false} count={sourceCount+(state.data?.unmirroredCount??0)} syncState persistLike={persist} onChange={onChange}/>;
}

// Commentlikebutton
interface CommentlikebuttonProps {
  commentId: string;
  liked: boolean;
  count: number;
  size?: 'sm' | 'md';
  onChange?: (state: { liked: boolean; count: number }) => void;
  syncState?: boolean;
}

const formatDisplayCount = (count: number = 0) => {
  if (count <= 0) return '';
  const n = Number(count) || 0;
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  return n.toLocaleString();
};

function Commentlikebutton({
  commentId,
  liked: initialLiked,
  count: initialCount,
  size = 'md',
  onChange,
  syncState = false,
}: CommentlikebuttonProps) {
  const queryClient = useQueryClient();

  const isPWA = useIsPWA();
  const [isMobile, setIsMobile] = useState(false);
  const isPWAMobile = isPWA && isMobile;

  // 表示用の状態（楽観的更新用）
  const [displayLiked, setDisplayLiked] = useState(initialLiked);
  const [displayCount, setDisplayCount] = useState(Number(initialCount) || 0);
  const [previousDisplayCount, setPreviousDisplayCount] = useState(Number(initialCount) || 0);
  const [countDirection, setCountDirection] = useState<'up' | 'down'>('up');
  const [isAnimating, setIsAnimating] = useState(false);
  const [isCountAnimating, setIsCountAnimating] = useState(false);

  const animationTimerRef = useRef<number | null>(null);
  const countTimerRef = useRef<number | null>(null);
  const lastTargetRef = useRef({ commentId });
  const hasLocalStateRef = useRef(false);

  // 最新の状態を常に保持するためのRef
  const stateRef = useRef({
    liked: initialLiked,
    count: Number(initialCount) || 0,
  });

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => {
      window.removeEventListener('resize', checkMobile);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (animationTimerRef.current !== null) window.clearTimeout(animationTimerRef.current);
      if (countTimerRef.current !== null) window.clearTimeout(countTimerRef.current);
    };
  }, []);

  // クリックまたは初期DB確認の前だけPropsと同期する。
  useEffect(() => {
    const targetChanged = lastTargetRef.current.commentId !== commentId;

    if (targetChanged) {
      lastTargetRef.current = { commentId };
      hasLocalStateRef.current = false;
    }

    if (targetChanged || !hasLocalStateRef.current || syncState) {
      const safeCount = Number(initialCount) || 0;
      setDisplayLiked(initialLiked);
      setDisplayCount(safeCount);
      setPreviousDisplayCount(safeCount);
      setIsCountAnimating(false);
      stateRef.current.liked = initialLiked;
      stateRef.current.count = safeCount;
    }
  }, [commentId, initialLiked, initialCount, syncState]);

  // props の liked が false のまま来るケースに備えて、表示初期化時だけDB上の実状態を反映する。
  useEffect(() => {
    let cancelled = false;

    const syncInitialLiked = async () => {
      const userId = await getCurrentUserId();
      if (!userId || cancelled || hasLocalStateRef.current) return;

      const { data, error } = await supabase
        .from('comment_likes')
        .select('user_id')
        .match({ comment_id: commentId, user_id: userId })
        .maybeSingle();

      if (cancelled || hasLocalStateRef.current) return;

      if (error) {
        console.error('Initial comment like state check failed:', error);
        return;
      }

      const currentLiked = Boolean(data);
      setDisplayLiked(currentLiked);
      stateRef.current.liked = currentLiked;
      hasLocalStateRef.current = true;
    };

    syncInitialLiked();

    return () => {
      cancelled = true;
    };
  }, [commentId]);

  const animateCount = useCallback((fromCount: number, toCount: number) => {
    if (countTimerRef.current !== null) {
      window.clearTimeout(countTimerRef.current);
    }

    setPreviousDisplayCount(fromCount);
    setDisplayCount(toCount);
    setCountDirection(toCount >= fromCount ? 'up' : 'down');
    setIsCountAnimating(fromCount !== toCount);

    countTimerRef.current = window.setTimeout(() => {
      setIsCountAnimating(false);
      setPreviousDisplayCount(toCount);
      countTimerRef.current = null;
    }, 320);
  }, []);

  const handleLike = useCallback(async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const wasLiked = stateRef.current.liked;
    const wasCount = stateRef.current.count;
    const willBeLiked = !wasLiked;
    const nextCount = willBeLiked ? wasCount + 1 : Math.max(0, wasCount - 1);

    stateRef.current.liked = willBeLiked;
    stateRef.current.count = nextCount;
    hasLocalStateRef.current = true;

    setDisplayLiked(willBeLiked);
    animateCount(wasCount, nextCount);

    if (animationTimerRef.current !== null) {
      window.clearTimeout(animationTimerRef.current);
    }

    setIsAnimating(willBeLiked);
    if (willBeLiked) {
      animationTimerRef.current = window.setTimeout(() => {
        setIsAnimating(false);
        animationTimerRef.current = null;
      }, 1050);
    }

    const userId = await getCurrentUserId();
    if (!userId) {
      alert('ログインが必要です');
      stateRef.current.liked = wasLiked;
      stateRef.current.count = wasCount;
      setDisplayLiked(wasLiked);
      animateCount(nextCount, wasCount);
      setIsAnimating(false);
      return;
    }

    try {
      if (willBeLiked) {
        const { error } = await supabase
          .from('comment_likes')
          .upsert(
            { comment_id: commentId, user_id: userId },
            { onConflict: 'comment_id, user_id' }
          );
        if (error && error.code !== '23505') throw error;
      } else {
        const { error } = await supabase
          .from('comment_likes')
          .delete()
          .match({ comment_id: commentId, user_id: userId });

        if (error) throw error;
      }

      // DB反映を待つ
      onChange?.({ liked: willBeLiked, count: nextCount });
      await queryClient.invalidateQueries({ queryKey: ['comments'] });
    } catch (err: any) {
      console.error('Comment like action failed:', err);
      // 失敗時のみ元の状態に戻す
      stateRef.current.liked = wasLiked;
      stateRef.current.count = wasCount;
      setDisplayLiked(wasLiked);
      animateCount(nextCount, wasCount);
      setIsAnimating(false);
    }
  }, [animateCount, commentId, queryClient, onChange]);

  return (
    <>
      <style>{`
        .twitter-like-effects {
          height: 40px;
          left: 50%;
          overflow: visible;
          pointer-events: none;
          position: absolute;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 40px;
        }

        .twitter-like-effects .circle {
          fill: transparent;
          stroke: #CD85E7;
          stroke-width: 0;
          transform-origin: 29.5px 29.5px;
        }

        .twitter-like-effects .particle-group {
          opacity: 0;
        }

        .twitter-like-effects .oval {
          transform-origin: 0 0 0;
        }

        .twitter-like-effects.is-animating .circle {
          animation: twitterLikeCircle 0.25s forwards;
        }

        .twitter-like-effects.is-animating .grp1,
        .twitter-like-effects.is-animating .grp2,
        .twitter-like-effects.is-animating .grp3,
        .twitter-like-effects.is-animating .grp4,
        .twitter-like-effects.is-animating .grp5,
        .twitter-like-effects.is-animating .grp6,
        .twitter-like-effects.is-animating .grp7 {
          opacity: 1;
          transition: 0.18s opacity 0.2s;
        }

        .twitter-like-effects.is-animating .grp1 .oval1 {
          transform: scale(0) translate(0, -18px);
          transition: 0.2s transform 0.2s;
        }

        .twitter-like-effects.is-animating .grp1 .oval2 {
          transform: scale(0) translate(7px, -30px);
          transition: 0.8s transform 0.2s;
        }

        .twitter-like-effects.is-animating .grp2 .oval1 {
          transform: scale(0) translate(18px, -9px);
          transition: 0.2s transform 0.2s;
        }

        .twitter-like-effects.is-animating .grp2 .oval2 {
          transform: scale(0) translate(33px, -9px);
          transition: 0.8s transform 0.2s;
        }

        .twitter-like-effects.is-animating .grp3 .oval1 {
          transform: scale(0) translate(18px, 0);
          transition: 0.2s transform 0.2s;
        }

        .twitter-like-effects.is-animating .grp3 .oval2 {
          transform: scale(0) translate(33px, 6px);
          transition: 0.8s transform 0.2s;
        }

        .twitter-like-effects.is-animating .grp4 .oval1 {
          transform: scale(0) translate(18px, 9px);
          transition: 0.2s transform 0.2s;
        }

        .twitter-like-effects.is-animating .grp4 .oval2 {
          transform: scale(0) translate(24px, 30px);
          transition: 0.8s transform 0.2s;
        }

        .twitter-like-effects.is-animating .grp5 .oval1 {
          transform: scale(0) translate(-6px, 13px);
          transition: 0.2s transform 0.2s;
        }

        .twitter-like-effects.is-animating .grp5 .oval2 {
          transform: scale(0) translate(-33px, 18px);
          transition: 0.8s transform 0.2s;
        }

        .twitter-like-effects.is-animating .grp6 .oval1 {
          transform: scale(0) translate(-18px, 0);
          transition: 0.2s transform 0.2s;
        }

        .twitter-like-effects.is-animating .grp6 .oval2 {
          transform: scale(0) translate(-33px, -3px);
          transition: 0.8s transform 0.2s;
        }

        .twitter-like-effects.is-animating .grp7 .oval1 {
          transform: scale(0) translate(-18px, -9px);
          transition: 0.2s transform 0.2s;
        }

        .twitter-like-effects.is-animating .grp7 .oval2 {
          transform: scale(0) translate(-31px, -18px);
          transition: 0.8s transform 0.2s;
        }

        .twitter-like-heart.is-animating {
          animation: twitterLikeHeart 0.25s 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275) both;
          transform-origin: center;
        }

        .twitter-like-count {
          display: inline-grid;
          line-height: 1;
          overflow: hidden;
          position: relative;
        }

        .twitter-like-count-static,
        .twitter-like-count-old,
        .twitter-like-count-new {
          grid-area: 1 / 1;
        }

        .twitter-like-count-old,
        .twitter-like-count-new {
          will-change: transform;
        }

        .twitter-like-count.is-up .twitter-like-count-old {
          animation: twitterCountOldUp 0.3s ease forwards;
        }

        .twitter-like-count.is-up .twitter-like-count-new {
          animation: twitterCountNewUp 0.3s ease forwards;
        }

        .twitter-like-count.is-down .twitter-like-count-old {
          animation: twitterCountOldDown 0.3s ease forwards;
        }

        .twitter-like-count.is-down .twitter-like-count-new {
          animation: twitterCountNewDown 0.3s ease forwards;
        }

        @keyframes twitterLikeCircle {
          from {
            transform: scale(0) translateY(-0.05px);
            stroke-width: 3px;
          }
          50% {
            transform: scale(4.6) translateY(-0.05px);
            stroke-width: 2.5px;
          }
          to {
            transform: scale(8.5) translateY(-0.05px);
            stroke-width: 0;
          }
        }

        @keyframes twitterLikeHeart {
          from {
            transform: scale(0.2);
          }
          to {
            transform: scale(1);
          }
        }

        @keyframes twitterCountOldUp {
          from {
            transform: translateY(0);
          }
          to {
            transform: translateY(-100%);
          }
        }

        @keyframes twitterCountNewUp {
          from {
            transform: translateY(100%);
          }
          to {
            transform: translateY(0);
          }
        }

        @keyframes twitterCountOldDown {
          from {
            transform: translateY(0);
          }
          to {
            transform: translateY(100%);
          }
        }

        @keyframes twitterCountNewDown {
          from {
            transform: translateY(-100%);
          }
          to {
            transform: translateY(0);
          }
        }
      `}</style>

      <button
        type="button"
        data-lime-post-action="like"
        onClick={handleLike}
        className={cn(
          'group inline-flex items-center rounded-full transition-colors outline-none select-none overflow-visible',
          isMobile
            ? 'gap-1.5 px-2 py-1 text-[13px] h-full'
            : 'gap-1.5 px-2.5 py-1',
          isPWAMobile && 'min-h-[32px]',
          displayLiked ? 'text-pink-500' : 'text-muted-foreground hover:text-pink-500'
        )}
      >
        <span className="relative inline-flex items-center justify-center overflow-visible pointer-events-none">
          <svg
            aria-hidden="true"
            className={cn('twitter-like-effects', isAnimating && displayLiked && 'is-animating')}
            viewBox="0 0 58 57"
            xmlns="http://www.w3.org/2000/svg"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <g fill="none" fillRule="evenodd">
              <circle className="circle" cx="29.5" cy="29.5" r="1.5" />

              <g className="particle-group grp7" transform="translate(7 6)">
                <circle className="oval oval1" fill="#9CD8C3" cx="2" cy="6" r="2" />
                <circle className="oval oval2" fill="#8CE8C3" cx="5" cy="2" r="2" />
              </g>

              <g className="particle-group grp6" transform="translate(0 28)">
                <circle className="oval oval1" fill="#CC8EF5" cx="2" cy="7" r="2" />
                <circle className="oval oval2" fill="#91D2FA" cx="3" cy="2" r="2" />
              </g>

              <g className="particle-group grp3" transform="translate(52 28)">
                <circle className="oval oval2" fill="#9CD8C3" cx="2" cy="7" r="2" />
                <circle className="oval oval1" fill="#8CE8C3" cx="4" cy="2" r="2" />
              </g>

              <g className="particle-group grp2" transform="translate(44 6)">
                <circle className="oval oval2" fill="#CC8EF5" cx="5" cy="6" r="2" />
                <circle className="oval oval1" fill="#CC8EF5" cx="2" cy="2" r="2" />
              </g>

              <g className="particle-group grp5" transform="translate(14 50)">
                <circle className="oval oval1" fill="#91D2FA" cx="6" cy="5" r="2" />
                <circle className="oval oval2" fill="#91D2FA" cx="2" cy="2" r="2" />
              </g>

              <g className="particle-group grp4" transform="translate(35 50)">
                <circle className="oval oval1" fill="#F48EA7" cx="6" cy="5" r="2" />
                <circle className="oval oval2" fill="#F48EA7" cx="2" cy="2" r="2" />
              </g>

              <g className="particle-group grp1" transform="translate(24)">
                <circle className="oval oval1" fill="#9FC7FA" cx="2.5" cy="3" r="2" />
                <circle className="oval oval2" fill="#9FC7FA" cx="7.5" cy="2" r="2" />
              </g>
            </g>
          </svg>

          <Heart
            className={cn(
              isMobile
                ? 'h-5 w-5'
                : size === 'sm'
                  ? 'h-4 w-4'
                  : 'h-5 w-5',
              'twitter-like-heart transition-transform duration-200 group-hover:scale-110 pointer-events-none',
              isAnimating && displayLiked && 'is-animating',
              displayLiked && 'fill-current'
            )}
            strokeWidth={displayLiked ? 0 : 2}
          />
        </span>

        <span
          className={cn(
            'font-bold tabular-nums pointer-events-none',
            isMobile
              ? 'text-[15px]'
              : size === 'sm'
                ? 'text-sm'
                : 'text-sm'
          )}
        >
          <span
            className={cn(
              'twitter-like-count',
              isCountAnimating && (countDirection === 'up' ? 'is-up' : 'is-down')
            )}
          >
            {isCountAnimating ? (
              <>
                <span className="twitter-like-count-old">{formatDisplayCount(previousDisplayCount)}</span>
                <span className="twitter-like-count-new">{formatDisplayCount(displayCount)}</span>
              </>
            ) : (
              <span className="twitter-like-count-static">{formatDisplayCount(displayCount)}</span>
            )}
          </span>
        </span>
      </button>
    </>
  );
}

export { RepostButton };
export { BookmarkButton };
export { HighlightPostMenuButton };
export { PinPostMenuButton };
export { ExternalLikeButton };
export { PostActionSheet };
export { mobilePostMenuOS };
export { useMobilePostMenu };
export { Commentlikebutton };
