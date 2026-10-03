import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowLeft, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { getBookmarkPage } from '@/api/bookmarks';
import { PostCardSkeleton } from '@/components/feed/PostCardSkeleton';
import { PostCard } from '@/components/feed/PostCard';
import { RepostedReplyCard } from '@/components/post/RepostedReplyCard';

export default function Bookmarks() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  useEffect(() => { const timer = window.setTimeout(() => setSearchTerm(search.trim().toLocaleLowerCase()), 200); return () => window.clearTimeout(timer); }, [search]);
  const query = useInfiniteQuery({ queryKey: ['bookmarks', 'pages', user?.id], queryFn: ({ pageParam }) => getBookmarkPage(user!.id, pageParam), initialPageParam: 0, getNextPageParam: page => page.next, enabled: !!user });
  // Search every saved page, including bookmarks beyond the initially loaded page.
  useEffect(() => { if (searchTerm && query.hasNextPage && !query.isFetching && !query.isFetchNextPageError) void query.fetchNextPage(); }, [searchTerm, query.hasNextPage, query.isFetching, query.isFetchNextPageError, query.fetchNextPage]);
  const posts = [...new Map((query.data?.pages.flatMap(page => page.posts) ?? []).map(post => [post.id, post])).values()].filter(post => !searchTerm || [post.content, post.author.displayName, post.author.username].some(text => text?.toLocaleLowerCase().includes(searchTerm)));
  const unavailable = query.data?.pages.some(page => page.unavailable > 0);
  const searching = !!searchTerm && (query.isFetching || query.hasNextPage);
  return <section data-lime-bookmarks-page className="w-full">
    <header data-lime-bookmarks-header className="sticky top-0 z-[60] border-b border-border bg-background/95 backdrop-blur-md">
      <div className="flex h-14 items-center gap-4 px-3">
        <button type="button" aria-label={searchOpen ? 'ブックマークの検索を閉じる' : '戻る'} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-muted" onClick={() => { if (searchOpen) { setSearchOpen(false); setSearch(''); } else if (window.history.state?.idx > 0) navigate(-1); else navigate('/'); }}><ArrowLeft className="h-5 w-5" /></button>
        {searchOpen ? <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border border-border px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary"><Search className="h-4 w-4 shrink-0 text-muted-foreground" /><input autoFocus aria-label="ブックマークを検索" placeholder="ブックマークを検索" value={search} onChange={event => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label> : <><h1 className="min-w-0 flex-1 text-xl font-bold">ブックマーク</h1><button type="button" aria-label="ブックマークを検索" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted" onClick={() => setSearchOpen(true)}><Search className="h-5 w-5" /></button></>}
      </div>
    </header>
    {query.isPending && <div className="px-4 sm:px-0"><PostCardSkeleton /><PostCardSkeleton /></div>}
    {query.isError && <div className="px-4 py-10 text-center"><p className="text-sm text-muted-foreground">ブックマークの取得に失敗しました。</p><button type="button" className="mt-3 text-sm font-bold text-primary" onClick={() => query.refetch()}>再試行</button></div>}
    {!query.isPending && !query.isError && posts.length === 0 && !searching && <p className="px-4 py-10 text-center text-sm text-muted-foreground">{searchTerm ? '一致するブックマークがありません。' : 'ブックマークしたポストがありません。'}</p>}
    {searching && <p role="status" className="px-4 py-3 text-center text-sm text-muted-foreground">ブックマークを検索中...</p>}
    {posts.map(post => post.replyId ? <RepostedReplyCard key={post.id} post={post} /> : <PostCard key={post.id} post={post} />)}
    {unavailable && <p className="px-4 py-4 text-center text-xs text-muted-foreground">削除済み、または現在閲覧できない投稿は表示されません。</p>}
    {query.hasNextPage && <div className="py-5 text-center"><button type="button" disabled={query.isFetchingNextPage} className="text-sm font-bold text-primary disabled:opacity-50" onClick={() => query.fetchNextPage()}>{query.isFetchingNextPage ? '読み込み中...' : 'さらに読み込む'}</button></div>}
  </section>;
}
