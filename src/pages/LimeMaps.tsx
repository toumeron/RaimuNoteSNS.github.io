import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { getMapPosts, type FeedCursor } from '@/api/posts';
import type { MapBounds, MapLocation } from '@/lib/mapLocation';
import type { PostWithAuthor } from '@/types';
import LimeMap from '@/components/maps/LimeMap';
import { PostComposer } from '@/components/feed/PostComposer';
import { usePost } from '@/hooks/useFeed';
import { PostCard } from '@/components/feed/PostCard';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Menu, Search, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

export default function LimeMaps() {
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [compose, setCompose] = useState<MapLocation | null>(null);
  const [selected, setSelected] = useState<PostWithAuthor | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [sidebarClosed, setSidebarClosed] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setFilter(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  const selectedPost = usePost(selected?.id ?? '');
  const query = useInfiniteQuery({
    queryKey: ['map-posts', bounds, filter], enabled: !!bounds,
    initialPageParam: undefined as FeedCursor | undefined,
    queryFn: ({ pageParam, signal }) => getMapPosts(bounds!, pageParam, signal, filter),
    getNextPageParam: last => last.length === 40 ? { createdAt: last.at(-1)!.createdAt, id: last.at(-1)!.id } : undefined,
    placeholderData: previous => previous,
    staleTime: 30_000, gcTime: 60_000, refetchOnWindowFocus: false, retry: false,
  });
  const posts = useMemo(() => [...new Map((query.data?.pages.flat() ?? []).map(post => [post.id, post])).values()], [query.data]);
  const schemaMissing = query.error && ('code' in query.error) && ['42703','PGRST204'].includes(String(query.error.code));

  return (
    <div data-lime-maps className="lime-maps-page">
      <LimeMap posts={posts} onBounds={setBounds} onPin={setCompose} onPost={setSelected} />
      <div className="lime-maps-toolbar">
        <button className="lime-maps-menu lime-maps-tool" aria-label="メニューを開く" onClick={() => window.dispatchEvent(new Event('lime-mobile-menu-open'))}><Menu size={20}/></button>
        <button className="lime-maps-sidebar-toggle lime-maps-tool" aria-label={sidebarClosed?'サイドバーを開く':'サイドバーを閉じる'} onClick={()=>{const closed=!sidebarClosed;setSidebarClosed(closed);window.dispatchEvent(new CustomEvent('lime-maps-sidebar-toggle',{detail:closed}));}}>{sidebarClosed?<PanelLeftOpen size={20}/>:<PanelLeftClose size={20}/>}</button>
        <span className="lime-maps-brand">LimeMaps</span>
        <label className="lime-maps-search"><Search size={18}/><input aria-label="ポスト・ハッシュタグを検索" placeholder="ポスト・ハッシュタグを検索" maxLength={100} value={search} onChange={event=>setSearch(event.target.value)}/>{search && <button aria-label="検索をクリア" onClick={()=>setSearch('')}><X size={16}/></button>}</label>
      </div>
      {query.isFetching && <div className="lime-maps-loading" role="status" aria-label="ポストを読み込み中"><Loader2 size={18} className="animate-spin"/></div>}
      {query.hasNextPage && <button className="lime-maps-more lime-maps-tool" disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>さらに表示</button>}
      {query.isError && <p className="lime-maps-data-error" role="alert">{schemaMissing ? '位置付きポストの保存設定が未適用です。' : 'ポストを読み込めませんでした。'}</p>}
      {selected && (
        <aside className="lime-map-post-detail" aria-label="選択したポスト">
          <button className="lime-map-detail-close" aria-label="ポストを閉じる" onClick={()=>setSelected(null)}><X size={18}/></button>
          <div data-lime-map-selected-post><PostCard post={selectedPost.data ?? selected}/></div>
        </aside>
      )}
      <Dialog open={!!compose} onOpenChange={open => { if (!open) setCompose(null); }}>
        <DialogContent className="lime-map-dialog flex max-h-[90dvh] flex-col overflow-hidden p-4 max-sm:inset-0 max-sm:h-[100dvh] max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-w-2xl" aria-describedby={undefined} onInteractOutside={event => event.preventDefault()}>
          <DialogTitle className="pr-8">ポストする</DialogTitle>
          <div className="lime-map-dialog-body">{compose && <PostComposer key={`${compose.latitude},${compose.longitude}`} mapLocation={compose} onSuccess={() => setCompose(null)} />}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
