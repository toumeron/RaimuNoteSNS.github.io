import {useListCatalog} from '@/hooks/useLists';
import { useSyncExternalStore } from 'react';
import {TOPICS,isTopicId,type TopicId} from './topics';
export type FeedTabValue = 'all'|'following'|'recommended'|'trending'|`topic:${TopicId}`|`list:${string}`;
export const TIMELINE_TABS: {value:FeedTabValue;label:string}[] = [
  {value:'all',label:'最新'},{value:'following',label:'フォロー中'},{value:'recommended',label:'おすすめ'},{value:'trending',label:'トレンド'},
];
export const TOPIC_TIMELINE_TABS = TOPICS.map(topic=>({value:`topic:${topic.id}` as FeedTabValue,label:topic.name}));
export const AVAILABLE_TIMELINE_TABS=[...TIMELINE_TABS,...TOPIC_TIMELINE_TABS];
export function feedTabTopic(value:string):TopicId|undefined { const id=value.startsWith('topic:')?value.slice(6):undefined;return isTopicId(id)?id:undefined; }
export function isFeedTabValue(value:unknown):value is FeedTabValue {return typeof value==='string'&&(AVAILABLE_TIMELINE_TABS.some(tab=>tab.value===value)||/^list:[0-9a-f-]{36}$/i.test(value));}
const EVENT='lime-timeline-tabs-changed';
const key=(owner?:string)=>`lime_timeline_tabs:${owner??'guest'}:v1`;
export function normalizeTimelineTabs(input:unknown):FeedTabValue[] {
  const result=Array.isArray(input)?[...new Set(input.filter((id):id is FeedTabValue=>isFeedTabValue(id)))]:[];
  return result.length?result:TIMELINE_TABS.map(t=>t.value);
}
export function saveTimelineTabs(owner:string|undefined, ids:FeedTabValue[]) {
  localStorage.setItem(key(owner),JSON.stringify(normalizeTimelineTabs(ids)));
  window.dispatchEvent(new Event(EVENT));
}
export function useAvailableTimelineTabs(owner?:string){const lists=useListCatalog(owner);return [...AVAILABLE_TIMELINE_TABS,...(lists.data??[]).map(list=>({value:`list:${list.id}` as FeedTabValue,label:list.name}))];}
export function useTimelineTabs(owner?:string) {
  const available=useAvailableTimelineTabs(owner);
  const raw=useSyncExternalStore(listener=>{
    const storage=(e:StorageEvent)=>{if(e.key===key(owner)||e.key===null)listener();};
    window.addEventListener(EVENT,listener);window.addEventListener('storage',storage);
    return()=>{window.removeEventListener(EVENT,listener);window.removeEventListener('storage',storage);};
  },()=>{try{return localStorage.getItem(key(owner));}catch{return null;}},()=>null);
  let value:unknown;try{value=JSON.parse(raw??'null');}catch{value=null;}
  return normalizeTimelineTabs(value).map(id=>available.find(t=>t.value===id)??{value:id,label:'リスト'});
}
