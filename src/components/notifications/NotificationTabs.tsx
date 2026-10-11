import { useSearchParams } from "react-router-dom";
import { SearchTabIndicator } from "@/components/search/SearchExploreTabs";
import { useAuth } from "@/hooks/useAuth";
import { useUnreadNotifications, useSavedAccountUnreadTotal } from "@/hooks/useUnreadNotifications";
import { useSharedDisplay } from "@/lib/sharedAccountDisplay";

export function NotificationTabs(){
 const [params,setParams]=useSearchParams();const active=params.get('tab')==='mention'?'mention':'all';
 const select=(value:string)=>{const next=new URLSearchParams(params);if(value==='all')next.delete('tab');else next.set('tab',value);setParams(next,{replace:true,preventScrollReset:true});};
 return <div data-lime-notification-tabs role="tablist" aria-label="通知の種類" className="relative grid h-14 w-full grid-cols-2">
  {([['all','すべて'],['mention','メンション']] as const).map(([value,label])=><button type="button" key={value} role="tab" aria-selected={active===value} aria-controls="notification-list" id={`notification-tab-${value}`} tabIndex={active===value?0:-1} onClick={()=>select(value)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'all':event.key==='End'?'mention':active==='all'?'mention':'all';select(next);document.getElementById(`notification-tab-${next}`)?.focus();}}} className={`text-sm transition-colors duration-200 hover:bg-muted/30 ${active===value?'font-bold text-foreground':'text-muted-foreground'}`}><span data-lime-tab-label>{label}</span></button>)}
  <SearchTabIndicator active={active}/>
 </div>;
}

export function UnreadBadge({ userId, floating = true }: {userId?: string; floating?: boolean}) {
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
