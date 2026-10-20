import { useMemo, type ReactNode, useLayoutEffect, useRef, useState, useId, useEffect } from "react";
import { Loader2, MoreHorizontal, History, Share, ArrowLeft, ListPlus, Search, Share2, ArrowDown, ArrowUp } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage, ProviderVerificationBadge, PrivateAccountBadge } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/button";
import { useHiddenTrends, type SearchExploreTab, SEARCH_EXPLORE_TABS, useSearchExploreTab, useNewsStory } from "@/hooks/useTopics";
import { latestNewsPerSource, type SearchNewsItem, type NewsSources } from "@/api/search-news";
import { type User } from "@/types/index";
import { prepareExploreTrends, rankPersonalTrends, type ExploreTrend } from "@/lib/topics";
import { type RecommendationPreferences } from "@/lib/recommendations";

import { useSearchParams, useNavigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useUnreadNotifications, useSavedAccountUnreadTotal } from "@/hooks/useOSNotification";
import { useSharedDisplay } from "@/lib/externalAccounts";
import { useTopics, useList } from "@/hooks/useTopics";
import { ContentLink, Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { getMarketQuote, formatMarketPrice, MARKET_RANGES, type MarketAsset, type MarketRange, type MarketQuote } from "@/api/search-news";
import { isBlueskyProfileId } from "@/lib/bluesky";
import { displayUsername } from "@/lib/utils";
import { FollowButton } from "@/components/profile/ProfileHeader";
import { getCurrentUserId } from "@/lib/currentUser";

// UserCard
interface UserCardProps {
  user: User;
  explore?: boolean;
  result?:boolean;
}

function getInitials(name?: string) {
  const s = (name ?? "").trim();
  if (!s) return "U";
  return s.slice(0, 1).toUpperCase();
}

function UserCard({ user, explore = false, result=false }: UserCardProps) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    getCurrentUserId()
      .then((id) => {
        if (mounted) setCurrentUserId(id);
      })
      .catch(() => {
        if (mounted) setCurrentUserId(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const initials = useMemo(() => getInitials(user.displayName), [user.displayName]);

  if(result)return <div data-lime-search-account className="grid w-full grid-cols-[44px_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3.5 transition-colors hover:bg-muted/30">
    <Link to={`/u/${encodeURIComponent(user.username)}`} className="row-span-2"><Avatar userId={user.id} className="h-11 w-11"><AvatarImage src={user.avatarUrl} alt={user.displayName}/><AvatarFallback>{initials}</AvatarFallback></Avatar></Link>
    <Link to={`/u/${encodeURIComponent(user.username)}`} className="min-w-0 self-center">
      <div className="flex min-w-0 items-center gap-1 text-[15px] font-bold leading-5"><span className="truncate hover:underline">{user.displayName}</span>{user.isPrivate&&<PrivateAccountBadge/>}<ProviderVerificationBadge verification={user.providerVerification} className="h-[18px] w-[18px] shrink-0"/>{user.isOfficial&&<img src={`${import.meta.env.BASE_URL}verified.png`} alt="認証済み" className="h-[18px] w-[18px] shrink-0"/>}</div>
      <div className="truncate text-[15px] leading-5 text-muted-foreground">@{displayUsername(user.username)}</div>
    </Link>
    {currentUserId!==user.id&&<div className="col-start-3 row-start-1 self-center [&_button]:min-w-[88px] [&_button]:rounded-full [&_button]:px-4 [&_button]:font-bold"><FollowButton userId={user.id} externalProfile={isBlueskyProfileId(user.id)?user:undefined}/></div>}
    {user.bio&&<p className="col-span-2 col-start-2 mt-1 whitespace-pre-wrap break-words text-[15px] leading-5 text-foreground">{user.bio.split(/(https?:\/\/[^\s]+)/g).map((part,index)=>/^https?:\/\//.test(part)?<ContentLink key={index} href={part} className="text-primary hover:underline">{part.replace(/^https?:\/\//,'')}</ContentLink>:part)}</p>}
  </div>;

  return (
    <div className={`flex items-start justify-between px-4 hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-colors bg-transparent w-full ${explore ? 'py-4' : 'py-3 border-b border-border/40'}`}>
      <Link to={`/u/${user.username}`} className="flex gap-3 min-w-0 flex-1">
        <Avatar userId={user.id} className={`${explore ? 'h-12 w-12' : 'h-10 w-10'} shrink-0`}>
          <AvatarImage src={user.avatarUrl} alt={user.displayName} />
          <AvatarFallback className="bg-muted text-[12px] font-bold">
            {initials}
          </AvatarFallback>
        </Avatar>

        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-1 min-w-0">
            <span className="font-bold text-foreground truncate text-[15px] hover:underline decoration-1">
              {user.displayName}
            </span>

            {user.isPrivate && <PrivateAccountBadge/>}<ProviderVerificationBadge verification={user.providerVerification} className="h-[18px] w-[18px] shrink-0 object-contain"/>{user.isOfficial && (
              <img
                src="/RaimuNoteSNS.github.io/verified.png"
                alt="認証済み"
                className="h-[18px] w-[18px] shrink-0 object-contain"
              />
            )}
          </div>

          <span className="text-muted-foreground/80 text-[14px] leading-none">
            @{displayUsername(user.username)}
          </span>

          {user.bio && (
            <p className={`text-[14.5px] text-foreground/90 mt-1 leading-snug ${explore ? 'whitespace-pre-wrap break-words' : 'line-clamp-2'}`}>
              {user.bio}
            </p>
          )}
        </div>
      </Link>

      {currentUserId !== user.id && (
        <div className="shrink-0 ml-3 pt-1">
          <FollowButton userId={user.id} externalProfile={isBlueskyProfileId(user.id)?user:undefined} />
        </div>
      )}
    </div>
  );
}

// SearchExploreContent
function SearchExploreContent({tab, preferences, viewerId, news, sources, trends, users, newsLoading, trendsLoading, usersLoading, onSearch, onNews}: {
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
        <div className="mt-2 flex min-h-6 items-center gap-2 text-sm text-muted-foreground">
          {!!sources[item.id]?.authors.length && <span data-lime-news-source-avatars className="flex shrink-0 -space-x-2">{sources[item.id].authors.map(author => <Avatar key={author.id} className="h-6 w-6 border-2 border-background"><AvatarImage src={author.avatarUrl} alt={author.displayName} /><AvatarFallback className="text-[10px]">{author.displayName.slice(0, 1)}</AvatarFallback></Avatar>)}</span>}
          <span className="min-w-0 truncate">{item.category || 'ニュース'}{sources[item.id]?.postsCount > 0 && <> · {sources[item.id].postsCount.toLocaleString()}件のポスト</>}</span>
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

// SearchPostRow
/** Keep the separator on the full row; inset only its mobile post content. */
function SearchPostRow({children}:{children:ReactNode}){
 return <div data-lime-search-result-row className="relative min-w-0 border-b border-border/60 bg-transparent max-sm:px-4 sm:transition-colors sm:hover:bg-black/[0.01] sm:dark:hover:bg-white/[0.02]">{children}</div>;
}

// SearchExploreTabs
function SearchExploreTabs() {
  const [active, change] = useSearchExploreTab();
  return <div data-lime-search-explore-tabs role="tablist" aria-label="話題を検索" className="relative flex w-full overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    {SEARCH_EXPLORE_TABS.map(tab => <button key={tab.value} type="button" role="tab" aria-selected={active === tab.value} aria-controls="search-explore-content" onClick={() => change(tab.value)} className={`relative flex h-12 flex-1 shrink-0 items-center justify-center whitespace-nowrap px-3 text-sm transition-colors hover:bg-muted/40 ${active === tab.value ? 'font-bold text-foreground' : 'font-medium text-muted-foreground'}`}>
      <span data-lime-tab-label className="relative flex h-full items-center">{tab.label}</span>
    </button>)}
    <SearchTabIndicator active={active} />
  </div>;
}

/** One underline follows the selected label instead of remounting on each tab. */
function SearchTabIndicator({ active }: { active: string }) {
  const marker = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const root = marker.current?.parentElement;
    if (!root) return;
    const measure = () => {
      const tab = root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      const label = tab?.querySelector<HTMLElement>('[data-lime-tab-label]') || tab;
      if (!label) return;
      const box = label.getBoundingClientRect(), parent = root.getBoundingClientRect();
      if (box.width) setPosition({ left: box.left - parent.left + root.scrollLeft, width: box.width });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    root.querySelectorAll('[data-lime-tab-label]').forEach(label => observer.observe(label));
    document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [active]);
  return <span ref={marker} aria-hidden="true" data-lime-search-tab-indicator className="lime-search-tab-indicator pointer-events-none absolute bottom-0 left-0 h-1 rounded-full bg-primary" style={{ width: position?.width || 0, transform: `translateX(${position?.left || 0}px)` }} />;
}

// NotificationTabs
function NotificationTabs(){
 const [params,setParams]=useSearchParams();const active=params.get('tab')==='mention'?'mention':'all';
 const select=(value:string)=>{const next=new URLSearchParams(params);if(value==='all')next.delete('tab');else next.set('tab',value);setParams(next,{replace:true,preventScrollReset:true});};
 return <div data-lime-notification-tabs role="tablist" aria-label="通知の種類" className="relative grid h-14 w-full grid-cols-2">
  {([['all','すべて'],['mention','メンション']] as const).map(([value,label])=><button type="button" key={value} role="tab" aria-selected={active===value} aria-controls="notification-list" id={`notification-tab-${value}`} tabIndex={active===value?0:-1} onClick={()=>select(value)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'all':event.key==='End'?'mention':active==='all'?'mention':'all';select(next);document.getElementById(`notification-tab-${next}`)?.focus();}}} className={`text-sm transition-colors duration-200 hover:bg-muted/30 ${active===value?'font-bold text-foreground':'text-muted-foreground'}`}><span data-lime-tab-label>{label}</span></button>)}
  <SearchTabIndicator active={active}/>
 </div>;
}

function UnreadBadge({ userId, floating = true }: {userId?: string; floating?: boolean}) {
  const {user} = useAuth();
  const sharing = useSharedDisplay() && !userId;
  const own = useUnreadNotifications(userId ?? user?.id);
  const total = useSavedAccountUnreadTotal(sharing);
  const count = sharing ? total : own.data ?? 0;
  if (!count || (!sharing && own.isError)) return null;
  return <span data-lime-unread-count={count} aria-label={`未読の通知${count}件`} style={{fontFamily:'system-ui, sans-serif',fontSize:13,fontWeight:400,lineHeight:1,height:19,minWidth:19,border:'1px solid hsl(var(--background))',padding:'0 2px',...(floating?{position:'absolute',right:2,top:1,transform:'translate(50%, -50%)'}: {})}} className="pointer-events-none flex shrink-0 items-center justify-center rounded-full bg-primary text-white">
    {count > 99 ? '99+' : count}
  </span>;
}

// TopicTabs
const TOPIC_TABS=[['followed','フォロー済み'],['recommended','おすすめ'],['dismissed','興味なし']] as const;
function TopicTabs() {
 const [params,setParams]=useSearchParams();const active=TOPIC_TABS.find(([value])=>value===params.get('tab'))?.[0]??'followed';
 const {data}=useTopics();
 if(!data || (!data.followed.length && active==='followed'))return null;
 const select=(value:string)=>{const next=new URLSearchParams(params);if(value==='followed')next.delete('tab');else next.set('tab',value);setParams(next,{replace:true,preventScrollReset:true});};
 return <div role="tablist" aria-label="トピックの種類" className="relative grid h-14 w-full grid-cols-3">
 {TOPIC_TABS.map(([value,label],index)=><button type="button" key={value} id={`topic-tab-${value}`} role="tab" aria-selected={active===value} aria-controls="topic-content" tabIndex={active===value?0:-1} onClick={()=>select(value)} onKeyDown={event=>{
  if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3;select(TOPIC_TABS[next][0]);document.getElementById(`topic-tab-${TOPIC_TABS[next][0]}`)?.focus();}
 }} className={`text-sm transition-colors hover:bg-muted/30 ${active===value?'font-bold text-foreground':'text-muted-foreground'}`}><span data-lime-tab-label>{label}</span></button>)}
 <SearchTabIndicator active={active}/></div>;
}

// NewsHeaderActions
function NewsHeaderActions() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: story } = useNewsStory(params.get('story'));
  const share = async () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('history');
    if (story) url.searchParams.set('story', story.id);
    try {
      if (navigator.share) await navigator.share({ title: story?.title ?? 'ニュース', url: url.href });
      else { await navigator.clipboard.writeText(url.href); toast.success('リンクをコピーしました'); }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) toast.error('共有できませんでした');
    }
  };
  return <div className="ml-auto flex items-center gap-1" data-lime-news-header-actions>
    <Button variant="ghost" size="icon" className="rounded-full hover:bg-muted/40" aria-label="ニュースを共有" onClick={() => void share()}><Share className="h-5 w-5" /></Button>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="rounded-full hover:bg-muted/40" aria-label="ニュースのメニュー"><MoreHorizontal className="h-5 w-5" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[600]" data-lime-news-menu>
        <DropdownMenuItem className="focus:bg-muted focus:text-foreground" onSelect={() => { const next = new URLSearchParams(params); next.delete('history'); if (story) next.set('story', story.id); navigate(`/news/history?${next}`); }}><History className="mr-2 h-4 w-4" />トレンド履歴</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

// ListHeaderActions
function ListHeaderActions(){
 const navigate=useNavigate(),location=useLocation(),[params,setParams]=useSearchParams();const id=location.pathname.split('/')[2];const list=useList(id);const {user}=useAuth();
 const action=(key:string)=>{const next=new URLSearchParams(params);next.set(key,'1');setParams(next);};
 const share=async()=>{try{const url=window.location.href.split('?')[0];if(navigator.share)await navigator.share({title:list.data?.name??'リスト',url});else{await navigator.clipboard.writeText(url);toast.success('リンクをコピーしました');}}catch(error){if(!(error instanceof Error&&error.name==='AbortError'))toast.error('共有できませんでした');}};
 return <><button type="button" aria-label="戻る" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" onClick={()=>id?navigate('/lists'):navigate(-1)}><ArrowLeft className="h-5 w-5"/></button>{id?<h1 className="min-w-0 flex-1 truncate text-xl font-bold">{list.data?.name??'リスト'}</h1>:<label className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-border px-3 py-2"><Search className="h-4 w-4 shrink-0 text-muted-foreground"/><input aria-label="リストを検索" placeholder="リストを検索" value={params.get('q')??''} onChange={event=>{const next=new URLSearchParams(params);event.target.value?next.set('q',event.target.value):next.delete('q');setParams(next,{replace:true});}} className="min-w-0 w-full flex-1 bg-transparent text-base outline-none sm:text-sm"/></label>}
 {!id&&user&&<button type="button" aria-label="新しいリストを作成" className="flex h-9 w-9 items-center justify-center" onClick={()=>action('create')}><ListPlus className="h-5 w-5"/></button>}{id&&<><button type="button" aria-label="リストを共有" className="flex h-9 w-9 items-center justify-center" onClick={()=>void share()}><Share2 className="h-5 w-5"/></button><DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="リストのメニュー" className="flex h-9 w-9 items-center justify-center"><MoreHorizontal className="h-5 w-5"/></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem className="focus:bg-muted/40 focus:text-foreground" onSelect={()=>action('members')}>メンバーを表示</DropdownMenuItem>{list.data?.owner_id===user?.id&&<><DropdownMenuItem className="focus:bg-muted/40 focus:text-foreground" onSelect={()=>action('edit')}>リストを編集</DropdownMenuItem><DropdownMenuItem className="text-destructive focus:bg-muted/40 focus:text-destructive" onSelect={()=>action('delete')}>リストを削除</DropdownMenuItem></>}</DropdownMenuContent></DropdownMenu></>}
 </>;
}

// StockMarketCard
function useQuote(asset:MarketAsset,range:MarketRange='1D'){
 return useQuery({queryKey:['market-quote',asset.symbol,range],queryFn:({signal})=>getMarketQuote(asset.symbol,range,signal),staleTime:60000,gcTime:15*60000,retry:false,refetchOnWindowFocus:false});
}
function StockSuggestion({asset}:{asset:MarketAsset}){
 const {data}=useQuote(asset);
 return <><span className="lime-stock-suggestion-name"><strong>{asset.name}</strong><span>{asset.symbol} · {asset.exchange}</span></span><span className="lime-stock-suggestion-price">{data?<><strong>{formatMarketPrice(data.price,data.currency)}</strong><span className={data.change!==null&&data.change<0?'lime-stock-down':'lime-stock-up'}>{data.changePercent!==null?`${data.changePercent>=0?'+':''}${data.changePercent.toFixed(2)}%`:'—'}</span></>:<span aria-label="株価を読み込み中">—</span>}</span></>;
}
function StockChart({quote,onSelect}:{quote:MarketQuote;onSelect:(index:number|null)=>void}){
 const gradient=useId().replace(/:/g,''),[selected,setSelected]=useState<number|null>(null);
 const points=quote.points;
 if(!points.length)return <div className="lime-stock-chart-empty">チャートデータはありません</div>;
 const width=720,height=240,volumeTop=216,plotBottom=198;
 const values=points.map(point=>point.price),low=Math.min(...values,quote.previousClose??Infinity),high=Math.max(...values,quote.previousClose??-Infinity),span=high-low||Math.max(high*.01,1);
 const x=(index:number)=>points.length===1?width/2:index/(points.length-1)*width;
 const y=(price:number)=>12+(high-price)/span*(plotBottom-24);
 const line=(rows:typeof points,offset=0)=>rows.map((point,index)=>`${index?'L':'M'}${x(index+offset).toFixed(2)},${y(point.price).toFixed(2)}`).join(' ');
 const firstExtended=points.findIndex(point=>point.extended),regular=firstExtended<0?points:points.slice(0,firstExtended),extended=firstExtended<0?[]:points.slice(Math.max(0,firstExtended-1));
 const regularPath=line(regular),volume=Math.max(...points.map(point=>point.volume),1),color=(quote.change??0)<0?'#f43f5e':'#00ba8a';
 const select=(index:number|null)=>{setSelected(index);onSelect(index);};
 return <svg className="lime-stock-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${quote.name} ${quote.range} 株価チャート。安値 ${formatMarketPrice(Math.min(...values),quote.currency)}、高値 ${formatMarketPrice(Math.max(...values),quote.currency)}`} onPointerMove={event=>{const bounds=event.currentTarget.getBoundingClientRect();select(Math.max(0,Math.min(points.length-1,Math.round((event.clientX-bounds.left)/bounds.width*(points.length-1)))));}} onPointerLeave={()=>select(null)} onPointerUp={event=>{if(event.pointerType==='touch')select(null);}}>
  <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".32"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
  {quote.previousClose!==null&&<line x1="0" x2={width} y1={y(quote.previousClose)} y2={y(quote.previousClose)} className="lime-stock-reference"/>}
  {regular.length>0&&<><path d={`${regularPath} L${x(regular.length-1)},${plotBottom} L${x(0)},${plotBottom} Z`} fill={`url(#${gradient})`}/><path d={regularPath} fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round"/></>}
  {extended.length>0&&<path d={line(extended,Math.max(0,firstExtended-1))} fill="none" stroke="currentColor" opacity=".45" strokeWidth="2.4" strokeLinejoin="round"/>}
  {points.map((point,index)=><rect key={`${point.time}-${index}`} x={x(index)} y={height-point.volume/volume*(height-volumeTop)} width={Math.max(.8,width/points.length*.65)} height={point.volume/volume*(height-volumeTop)} fill="currentColor" opacity=".18"/>)}
  {selected!==null&&points[selected]&&<><line x1={x(selected)} x2={x(selected)} y1="0" y2={height} className="lime-stock-reference"/><circle cx={x(selected)} cy={y(points[selected].price)} r="4" fill={points[selected].extended?'currentColor':color}/></>}
 </svg>;
}
function StockMarketCard({asset}:{asset:MarketAsset}){
 const [range,setRange]=useState<MarketRange>('1D'),[selected,setSelected]=useState<number|null>(null);
 const {data,isPending,isError,refetch}=useQuote(asset,range),point=selected!==null?data?.points[selected]:undefined;
 const change=point&&data?.previousClose!==null?point.price-data!.previousClose!:data?.change,percent=point&&data?.previousClose?change!/data.previousClose*100:data?.changePercent;
 const price=point?.price??data?.price;
 return <section className="lime-stock-card" aria-label={`${asset.name}の株価`} data-lime-stock-card>
  <div className="lime-stock-heading"><div><h2>{asset.name}</h2><p>{asset.symbol} · {asset.exchange}{data?.currency?` · ${data.currency}`:''}</p></div></div>
  <div className="lime-stock-price" aria-live="polite">{price!==undefined&&data?formatMarketPrice(price,data.currency):'—'}</div>
  {data&&change!=null&&percent!=null&&<p className={`lime-stock-change ${change<0?'lime-stock-down':'lime-stock-up'}`}>{change<0?<ArrowDown/>:<ArrowUp/>}{formatMarketPrice(Math.abs(change),data.currency)}（{percent>=0?'+':''}{percent.toFixed(2)}%）</p>}
  <div className="lime-stock-secondary">{point?new Date(point.time*1000).toLocaleString('ja-JP'):data?.extended?`時間外 ${formatMarketPrice(data.extended.price,data.currency)}`:'\u00a0'}</div>
  {isPending?<div className="lime-stock-chart-empty" role="status" aria-label="株価を読み込み中"><div className="lime-stock-loading"/></div>:isError?<div className="lime-stock-chart-empty"><span>株価を取得できませんでした</span><button type="button" onClick={()=>void refetch()}>再読み込み</button></div>:data?<StockChart key={range} quote={data} onSelect={setSelected}/>:null}
  <div className="lime-stock-ranges" role="group" aria-label="チャートの期間">{(Object.keys(MARKET_RANGES) as MarketRange[]).map(value=><button type="button" key={value} aria-pressed={range===value} onClick={()=>{setSelected(null);setRange(value);}}>{value}</button>)}</div>
  <p className="lime-stock-attribution">
   <span></span>
  </p>
 </section>;
}

export { SearchExploreContent };
export { SearchPostRow };
export { SearchExploreTabs };
export { SearchTabIndicator };
export { NotificationTabs };
export { UnreadBadge };
export { TopicTabs };
export { TOPIC_TABS };
export { NewsHeaderActions };
export { ListHeaderActions };
export { StockSuggestion };
export { StockMarketCard };
export { UserCard };
