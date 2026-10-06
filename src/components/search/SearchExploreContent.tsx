import { useMemo } from 'react';
import { Loader2, MoreHorizontal } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import UserCard from './UserCard';
import { useHiddenTrends } from '@/hooks/useHiddenTrends';
import type { SearchExploreTab } from '@/hooks/useSearchExploreTab';
import { latestNewsPerSource, type SearchNewsItem, type NewsSources } from '@/api/search-news';
import type { User } from '@/types';

import { prepareExploreTrends, rankPersonalTrends, type ExploreTrend } from '@/lib/search-trends';
import type { RecommendationPreferences } from '@/lib/recommendations';

export function SearchExploreContent({tab, preferences, viewerId, news, sources, trends, users, newsLoading, trendsLoading, usersLoading, onSearch, onNews}: {
  tab: SearchExploreTab; preferences: RecommendationPreferences; viewerId: string | null; news: SearchNewsItem[]; sources: Record<string, NewsSources>; trends: ExploreTrend[]; users: User[];
  newsLoading: boolean; trendsLoading: boolean; usersLoading: boolean; onSearch: (title: string) => void; onNews: (id: string) => void;
}) {
  const [hidden, hideTrend] = useHiddenTrends(viewerId);
  const preparedTrends = useMemo(() => prepareExploreTrends(trends, news), [trends, news]);
  const rankedTrends = useMemo(() => rankPersonalTrends(preparedTrends, preferences), [preparedTrends, preferences]);
  const visibleNews = latestNewsPerSource(news);
  const category = tab === 'sports' ? 'スポーツ' : tab === 'entertainment' ? 'エンターテインメント' : null;
  const visibleTrends = (tab === 'explore' ? rankedTrends : preparedTrends).filter(item => !hidden.has(item.title) && (!category || item.category === category || item.categories?.includes(category))).slice(0, 20);
  const showNews = tab === 'explore';
  return <div id="search-explore-content" data-lime-search-explore-content role="tabpanel">
    {showNews && <section data-lime-search-today-news className="border-b border-border">
      <h2 className="px-4 pb-2 pt-4 text-xl font-extrabold">本日のニュース</h2>
      {newsLoading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div> : visibleNews.length ? visibleNews.map(item => <button key={item.id} type="button" onClick={() => onNews(item.id)} className="block w-full px-4 py-4 text-left transition-colors hover:bg-muted/40">
        <h3 className="text-base font-bold leading-snug sm:text-lg">{item.title}</h3>
        <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          {!!sources[item.id]?.authors.length && <span data-lime-news-source-avatars className="flex shrink-0 -space-x-2">{sources[item.id].authors.map(author => <Avatar key={author.id} className="h-6 w-6 border-2 border-background"><AvatarImage src={author.avatarUrl} alt={author.displayName} /><AvatarFallback className="text-[10px]">{author.displayName.slice(0, 1)}</AvatarFallback></Avatar>)}</span>}
          <span>{item.category || 'ニュース'}{sources[item.id]?.postsCount > 0 && <> · {sources[item.id].postsCount.toLocaleString()}件のポスト</>}</span>
        </div>
      </button>) : <p className="px-4 py-6 text-sm text-muted-foreground">現在、表示できるニュースはありません</p>}
    </section>}
    <section aria-label="トレンド">
      {trendsLoading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div> : visibleTrends.length ? visibleTrends.map(trend => <div key={trend.title} data-lime-search-trend-title={trend.title} data-lime-trend-rank={trend.rank} className="flex items-start gap-3 px-4 py-4 transition-colors hover:bg-muted/40">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSearch(trend.title)}><span className="block text-sm text-muted-foreground">{tab === 'trends' && <>{trend.rank ?? preparedTrends.indexOf(trend) + 1} · </>}{trend.category ? `${trend.category} · トレンド` : '日本のトレンド'}</span><span className="mt-0.5 block text-base font-bold">{trend.title}</span></button>
        <DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label={`${trend.title}のメニュー`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"><MoreHorizontal className="h-5 w-5" /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => hideTrend(trend.title)}>興味がない</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      </div>) : <p className="px-4 py-8 text-sm text-muted-foreground">{category ? `現在、${category}のトレンドはありません` : '現在、トレンドを取得できません'}</p>}
    </section>
    {tab === 'explore' && <section data-lime-search-recommended-users>
      <h2 className="px-4 pb-2 pt-4 text-xl font-extrabold">おすすめユーザー</h2>
      {usersLoading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div> : users.length ? users.map(user => <UserCard key={user.id} user={user} explore />) : <p className="px-4 py-6 text-sm text-muted-foreground">現在、おすすめユーザーを表示できません</p>}
    </section>}
  </div>;
}
