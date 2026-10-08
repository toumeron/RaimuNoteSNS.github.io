import {useSearchParams} from 'react-router-dom';
import {SearchTabIndicator} from '@/components/search/SearchTabIndicator';
import {useTopics} from '@/hooks/useTopics';
export const TOPIC_TABS=[['followed','フォロー済み'],['recommended','おすすめ'],['dismissed','興味なし']] as const;
export function TopicTabs() {
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
