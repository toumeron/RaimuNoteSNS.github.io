import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { getExternalMapPostPage, getExternalMapPostDetail, MapRateLimitError, type ExternalMapCursor } from '@/api/external-map-posts';
import { getMapPosts, type FeedCursor } from '@/api/posts';
import { expandedMapBounds, mapAreaContains, type MapBounds, type MapLocation, type MapPostPin } from '@/lib/mapLocation';
import type { PostWithAuthor } from '@/types';
import LimeMap from '@/components/maps/LimeMap';
import { PostOverlay } from '@/App';
import { getPostById } from '@/api/posts';
import { PostCard } from '@/components/feed/PostCard';
import { Menu, Search, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

export default function LimeMaps() {
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [compose, setCompose] = useState<MapLocation | null>(null);
  const [selected, setSelected] = useState<PostWithAuthor | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [sidebarClosed, setSidebarClosed] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setFilter(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  const queryClient = useQueryClient();
  const loadPost = (pin: MapPostPin) => queryClient.fetchQuery({ queryKey: ['map-post-detail',pin.id], staleTime: 60_000, queryFn: async () => {
    if(pin.source==='flickr')return getExternalMapPostDetail(pin.id);
    return getPostById(pin.id);
  }});
  const [fetchBounds,setFetchBounds]=useState<MapBounds|null>(null);
  useEffect(()=>{if(bounds)setFetchBounds(previous=>previous&&mapAreaContains(previous,bounds)?previous:expandedMapBounds(bounds));},[bounds]);
  const externalQuery = useInfiniteQuery({ queryKey: ['external-map-geo-v1', fetchBounds, filter], enabled: !!fetchBounds,
    initialPageParam: undefined as ExternalMapCursor | undefined, queryFn: ({ pageParam, signal }) => getExternalMapPostPage(pageParam, signal, fetchBounds!, filter),
    getNextPageParam: page => page.next.length ? page.next : undefined, placeholderData: previous => previous,
    staleTime: 5 * 60_000, refetchOnWindowFocus: false, retry: (_count,error) => error instanceof MapRateLimitError, retryDelay: (_count,error) => error instanceof MapRateLimitError ? error.retryAfter : 0 });
  const query = useInfiniteQuery({
    queryKey: ['map-posts', fetchBounds, filter], enabled: !!fetchBounds,
    initialPageParam: undefined as FeedCursor | undefined,
    queryFn: ({ pageParam, signal }) => getMapPosts(fetchBounds!, pageParam, signal, filter),
    getNextPageParam: last => last.length === 200 ? { createdAt: last.at(-1)!.createdAt, id: last.at(-1)!.id } : undefined,
    placeholderData: previous => previous,
    staleTime: 30_000, gcTime: 60_000, refetchOnWindowFocus: false, retry: false,
  });
  const posts = useMemo(() => [...new Map([
    ...(query.data?.pages.flat() ?? []),
    ...(externalQuery.data?.pages.flatMap(page => page.pins).filter(pin=>pin.source==='flickr') ?? []),
  ].map(post => [post.id, post])).values()], [query.data, externalQuery.data]);
  useEffect(() => { if(query.hasNextPage && !query.isFetching && !query.isError) void query.fetchNextPage(); }, [query.hasNextPage,query.isFetching,query.isError,query.fetchNextPage]);
  useEffect(() => { if(!externalQuery.hasNextPage || externalQuery.isFetching || externalQuery.isError)return; const timer=setTimeout(()=>void externalQuery.fetchNextPage(),4000);return()=>clearTimeout(timer); }, [externalQuery.hasNextPage,externalQuery.isFetching,externalQuery.isError,externalQuery.fetchNextPage]);

  return (
    <div data-lime-maps className="lime-maps-page">
      <LimeMap posts={posts} onLoadPost={loadPost} onBounds={setBounds} onPin={setCompose} onPost={setSelected} />
      <div className="lime-maps-toolbar">
        <button className="lime-maps-menu lime-maps-tool" aria-label="メニューを開く" onClick={() => window.dispatchEvent(new Event('lime-mobile-menu-open'))}><Menu size={20}/></button>
        <button className="lime-maps-sidebar-toggle lime-maps-tool" aria-label={sidebarClosed?'サイドバーを開く':'サイドバーを閉じる'} onClick={()=>{const closed=!sidebarClosed;setSidebarClosed(closed);window.dispatchEvent(new CustomEvent('lime-maps-sidebar-toggle',{detail:closed}));}}>{sidebarClosed?<PanelLeftOpen size={20}/>:<PanelLeftClose size={20}/>}</button>
        <span className="lime-maps-brand">LimeMaps</span>
        <label className="lime-maps-search"><Search size={18}/><input aria-label="ポスト・ハッシュタグを検索" placeholder="ポスト・ハッシュタグを検索" maxLength={100} value={search} onChange={event=>setSearch(event.target.value)}/>{search && <button aria-label="検索をクリア" onClick={()=>setSearch('')}><X size={16}/></button>}</label>
      </div>
      {selected && (
        <aside className="lime-map-post-detail" aria-label="選択したポスト">
          <button className="lime-map-detail-close" aria-label="ポストを閉じる" onClick={()=>setSelected(null)}><X size={18}/></button>
          <div data-lime-map-selected-post><PostCard post={selected}/></div>
        </aside>
      )}
      <PostOverlay isOpen={!!compose} mapLocation={compose ?? undefined} onClose={() => setCompose(null)} />
    </div>
  );
}
