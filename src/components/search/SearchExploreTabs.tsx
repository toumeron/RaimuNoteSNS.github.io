import { SEARCH_EXPLORE_TABS, useSearchExploreTab, useNewsStory } from "@/hooks/useTrends";
import { useLayoutEffect, useRef, useState } from "react";
import "@/components/search/stock-market.css";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useUnreadNotifications, useSavedAccountUnreadTotal } from "@/hooks/useUnreadNotifications";
import { useSharedDisplay } from "@/lib/sharedAccountDisplay";
import { useTopics } from "@/hooks/useTopics";
import { History, MoreHorizontal, Share, ArrowLeft, ListPlus, Search, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useList } from "@/hooks/useLists";

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

export { SearchExploreTabs };
export { SearchTabIndicator };
export { NotificationTabs };
export { UnreadBadge };
export { TopicTabs };
export { TOPIC_TABS };
export { NewsHeaderActions };
export { ListHeaderActions };
