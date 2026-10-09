import { PostActionSheet } from '@/components/post/PostActionSheet';
import { useMobilePostMenu } from '@/components/post/mobilePostMenu';
import { RepostIcon } from './RepostIcon';
import { useRef, useState } from 'react';
import { Pencil, Quote } from 'lucide-react';
import { useToggleRepost } from '@/hooks/useFeed';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { usePostOverlay } from '@/components/layout/PostOverlayContext';
import type { PostWithAuthor } from '@/types';
import { useQuery } from '@tanstack/react-query';
import { getExternalRepostState, isExternalPostId } from '@/api/external-posts';
import { getReplyPost, getReplyRepostState, isReplyPostId } from '@/api/reply-reposts';
import { AnimatedCount } from '@/components/post/AnimatedCount';
import { toast } from 'sonner';
import { getNativeRepostState } from '@/api/repost-state';

export function RepostButton({ post, mobilePresentation = false, refreshState = false }: { post: PostWithAuthor; mobilePresentation?: boolean; refreshState?: boolean }) {
  const openPostOverlay = usePostOverlay();
  const pendingQuote = useRef(false);
  const mutation = useToggleRepost();
  const [persistedState,setPersistedState]=useState<{count:number;reposted:boolean;updatedAt:number}|null>(null);
  const externalState = useQuery({queryKey: ['repost-state', post.id],
    queryFn: () => isReplyPostId(post.id) ? getReplyRepostState(post.id) : isExternalPostId(post.id) ? getExternalRepostState(post.id) : getNativeRepostState(post.id), enabled: refreshState || isExternalPostId(post.id) || isReplyPostId(post.id)});
  const usePersisted = persistedState && externalState.dataUpdatedAt <= persistedState.updatedAt;
  const reposted = usePersisted ? persistedState.reposted : externalState.data?.repostedByMe ?? post.repostedByMe;
  const count = usePersisted ? persistedState.count : externalState.data?.repostsCount ?? post.repostsCount ?? 0;
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
  const repost = () => mutation.mutate(post.id, {onSuccess: result => {
    if (refreshState || isExternalPostId(post.id) || isReplyPostId(post.id)) setPersistedState({reposted:result.reposted,count:result.repostsCount ?? Math.max(0,count+(result.reposted?1:-1)),updatedAt:externalState.dataUpdatedAt});
  }});
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
