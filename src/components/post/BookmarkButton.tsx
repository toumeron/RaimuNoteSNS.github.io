import { useContext } from "react";
import { OfflineBookmarkContext } from "@/components/stickers/OfflineBookmarkContext";
import { Bookmark, Star, StarOff, Pin, PinOff } from "lucide-react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { getBookmarkIds, setBookmark, type BookmarkTarget } from "@/api/bookmarks";
import { cn } from "@/lib/utils";
import { isPostHighlighted, postHighlightKey, profileHighlightsKey, setPostHighlighted, getProfilePin, setProfilePin, profilePinKey } from "@/api/profile-highlights";

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

export { BookmarkButton };
export { HighlightPostMenuButton };
export { PinPostMenuButton };
