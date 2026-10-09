import './news-history.css';
import { useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { formatRelative } from '@/lib/format';
import { getNewsHistory, getNewsRelatedPosts } from '@/api/search-news';
import { useNewsStory } from '@/hooks/useNewsStory';
import { useAuth } from '@/hooks/useAuth';
import { PostCard } from '@/components/feed/PostCard';
import { Button } from '@/components/ui/button';
import { SearchTabIndicator } from '@/components/search/SearchTabIndicator';

export default function NewsPage() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const showHistory = useLocation().pathname === '/news/history';
  const storyQuery = useNewsStory(params.get('story'), !showHistory);
  const story = storyQuery.data;
  const tab = params.get('tab') === 'latest' ? 'latest' : 'top';
  const related = useQuery({
    queryKey: ['news-related-posts', story?.id, user?.id],
    queryFn: () => getNewsRelatedPosts(story!),
    enabled: !!story && !showHistory,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
  const history = useInfiniteQuery({
    queryKey: ['news-history'],
    queryFn: ({ pageParam }) => getNewsHistory(pageParam),
    enabled: showHistory,
    initialPageParam: 0,
    getNextPageParam: (last, pages) => last.length === 20 ? pages.length * 20 : undefined,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
  const posts = useMemo(() => [...(related.data ?? [])].sort((a, b) => tab === 'latest'
    ? Date.parse(b.createdAt) - Date.parse(a.createdAt)
    : (b.likesCount + (b.repostsCount ?? 0) + b.commentsCount) - (a.likesCount + (a.repostsCount ?? 0) + a.commentsCount) || Date.parse(b.createdAt) - Date.parse(a.createdAt)), [related.data, tab]);
  const source = story?.source === 'bluesky' ? 'Bluesky' : 'LimeNote';


  if (!showHistory && params.get('history') === '1') {
    const next = new URLSearchParams(params); next.delete('history');
    return <Navigate replace to={`/news/history?${next}`} />;
  }
  if (showHistory) return <div data-lime-news-history className="news-history-enter min-h-screen pb-20">
          {history.isPending ? <div className="flex justify-center p-8" role="status" aria-label="トレンド履歴を読み込み中"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            : history.isError ? <p className="p-8 text-center text-muted-foreground">履歴を読み込めませんでした。</p>
            : history.data?.pages.flat().length ? history.data.pages.flat().map(item => <Link key={item.id} to={`/news?story=${encodeURIComponent(item.id)}`} className="block border-b border-border px-5 py-4 hover:bg-muted/40">
              <time dateTime={item.created_at} className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString('ja-JP')}</time>
              <h2 className="mt-1 font-bold leading-6">{item.title}</h2>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.content}</p>
            </Link>) : <p className="p-8 text-center text-muted-foreground">履歴はありません。</p>}
          {history.hasNextPage && <Button variant="ghost" className="w-full" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>さらに読み込む</Button>}

  </div>;

  return <div className="news-detail pb-20" data-lime-news-detail>
    {storyQuery.isPending ? <div className="flex justify-center py-12" role="status" aria-label="ニュースを読み込み中"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      : storyQuery.isError ? <p className="p-8 text-center text-muted-foreground">ニュースを読み込めませんでした。</p>
      : !story ? <p className="p-8 text-center text-muted-foreground">ニュースがありません。</p>
      : <>
        <article className="news-detail-article">
          <h1 className="text-2xl font-bold leading-snug sm:text-3xl">{story.title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">最終更新: <time dateTime={story.updated_at ?? story.created_at}>{formatRelative(story.updated_at ?? story.created_at)}</time></p>
          <p className="mt-4 whitespace-pre-wrap break-words text-base leading-7">{story.content}</p>
          <p className="mt-5 text-sm leading-6 text-muted-foreground">このストーリーは、{source}のポストの要約であり、時間の経過とともに新しくなります。AIは間違えることがあるため、アウトプットが事実かどうかを確認してください</p>
        </article>
        <div className="relative flex border-y border-border" role="tablist" aria-label="ニュースの関連ポスト">
          {(['top', 'latest'] as const).map(value => <button key={value} id={`news-tab-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls="news-posts" className={`flex h-14 flex-1 justify-center text-sm transition-colors hover:bg-muted/40 ${tab === value ? 'font-bold text-foreground' : 'text-muted-foreground'}`} onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.set('tab', value); return next; }, { replace: true })}>
            <span data-lime-tab-label className="flex h-full items-center">{value === 'top' ? 'トップ' : '最新'}</span>
          </button>)}
          <SearchTabIndicator active={tab} />
        </div>
        <div id="news-posts" role="tabpanel" aria-labelledby={`news-tab-${tab}`} className="news-detail-posts">
          {related.isPending ? <div className="flex justify-center py-10" role="status" aria-label="関連ポストを読み込み中"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            : related.isError ? <p className="p-8 text-center text-muted-foreground">関連ポストを読み込めませんでした。</p>
            : posts.length ? posts.map(post => <div className="news-detail-post" key={post.id} data-news-post={post.id}><PostCard post={post} /></div>)
            : <p className="p-8 text-center text-muted-foreground">表示できる関連ポストはありません。</p>}
        </div>
      </>}

  </div>;
}
