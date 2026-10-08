import {useSearchParams} from 'react-router-dom';
import {SearchTabIndicator} from '@/components/search/SearchTabIndicator';
export function NotificationTabs(){
 const [params,setParams]=useSearchParams();const active=params.get('tab')==='mention'?'mention':'all';
 const select=(value:string)=>{const next=new URLSearchParams(params);if(value==='all')next.delete('tab');else next.set('tab',value);setParams(next,{replace:true,preventScrollReset:true});};
 return <div data-lime-notification-tabs role="tablist" aria-label="通知の種類" className="relative grid h-14 w-full grid-cols-2">
  {([['all','すべて'],['mention','メンション']] as const).map(([value,label])=><button type="button" key={value} role="tab" aria-selected={active===value} aria-controls="notification-list" id={`notification-tab-${value}`} tabIndex={active===value?0:-1} onClick={()=>select(value)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'all':event.key==='End'?'mention':active==='all'?'mention':'all';select(next);document.getElementById(`notification-tab-${next}`)?.focus();}}} className={`text-sm transition-colors duration-200 hover:bg-muted/30 ${active===value?'font-bold text-foreground':'text-muted-foreground'}`}><span data-lime-tab-label>{label}</span></button>)}
  <SearchTabIndicator active={active}/>
 </div>;
}
