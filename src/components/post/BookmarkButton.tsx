import { Bookmark } from 'lucide-react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { getBookmarkIds, setBookmark, type BookmarkTarget } from '@/api/bookmarks';
import { cn } from '@/lib/utils';

export function BookmarkButton({ post, className }: { post: BookmarkTarget; className?: string }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const key = ['bookmarks', 'ids', user?.id];
  const mutationKey = ['bookmark-action', user?.id, post.id];
  const { data = [], isPending, isError, refetch } = useQuery({ queryKey: key, queryFn: () => getBookmarkIds(user!.id), enabled: !!user, staleTime: 30_000 });
  const saved = data.includes(post.id);
  const change = (saved: boolean) => client.setQueryData<string[]>(key, old => saved ? [...new Set([...(old ?? []), post.id])] : (old ?? []).filter(id => id !== post.id));
  const pending = useIsMutating({ mutationKey }) > 0;
  const mutation = useMutation({
    mutationKey,
    mutationFn: (next: boolean) => setBookmark(post, next, user!.id),
    onMutate: async next => { await client.cancelQueries({ queryKey: key }); const previous = client.getQueryData<string[]>(key)?.includes(post.id) ?? false; change(next); return { previous, key, postId: post.id }; },
    onSuccess: (_data, next, context) => { toast.success(next ? 'ブックマークに追加しました' : 'ブックマークを解除しました'); client.invalidateQueries({ queryKey: ['bookmarks', 'pages', context?.key[2]] }); },
    onError: (_error, _next, context) => { if (context) client.setQueryData<string[]>(context.key, old => context.previous ? [...new Set([...(old ?? []), context.postId])] : (old ?? []).filter(id => id !== context.postId)); toast.error('ブックマークの更新に失敗しました'); },
  });
  return <button type="button" aria-label={saved ? 'ブックマークを解除' : 'ブックマークに追加'} aria-pressed={saved} disabled={pending || (!!user && isPending)} data-lime-bookmark-button className={cn('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full p-1.5 text-muted-foreground transition-colors hover:text-primary disabled:opacity-50', saved && 'text-primary', className)} onClick={event => {
    event.preventDefault(); event.stopPropagation();
    if (!user) { toast.error('ログインが必要です'); return; }
    if (isError) { void refetch(); toast.error('ブックマークの取得に失敗しました。もう一度お試しください'); return; }
    mutation.mutate(!saved);
  }}><Bookmark className="h-5 w-5" fill={saved ? 'currentColor' : 'none'} /></button>;
}
