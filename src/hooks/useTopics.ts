import {useTimelineSourceUpdates} from './useTimelineSourceUpdates';
import { useMutation, useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { getTopicPreferences, topicsKey, updateTopicPreferences, createTopicCursor, getTopicPage, getTrendRanking } from "@/api/topics";
import { type TopicId } from "@/lib/topics";
import { useEffect, useCallback, useMemo, useSyncExternalStore, useState } from "react";
import { createRecommendationFeedback, dismissRecommendation } from "@/api/recommendations";
import { recommendationIsDismissed } from "@/lib/recommendations";
import { type PostWithAuthor } from "@/types/index";
import { getList, getLists, getListCatalog, listsKey } from "@/api/users";
import { getListNativePosts, getHighlightedPosts } from "@/api/posts";
import { fetchBlueskyAuthorFeed } from "@/lib/bluesky";
import { createTimelineCursor, loadTimelinePage } from "@/lib/timelinePaging";
import { profileHighlightsKey } from "@/api/comments";
import { getLatestSearchNews, getNewsStory } from "@/api/search-news";
import { observePostElements } from "@/hooks/useViewportWidth";

// useTopics
function useTopics() {
 const {user}=useAuth(),client=useQueryClient();
 const query=useQuery({queryKey:topicsKey(user?.id),queryFn:()=>getTopicPreferences(user!.id),enabled:!!user,staleTime:0});
 const mutation=useMutation({mutationFn:({ids,status}:{ids:TopicId[];status:'follow'|'dismiss'|'clear'})=>updateTopicPreferences(ids,status),onSuccess:async()=>{
   await Promise.all([client.invalidateQueries({queryKey:topicsKey(user?.id)}),client.invalidateQueries({queryKey:['feed','recommended']}),client.invalidateQueries({queryKey:['recommendation-preferences',user?.id??null]})]);
 }});
 return {...query,mutation};
}

// useTopicFeed
function useTopicFeed(topic?:TopicId) {
 const {user,loading}=useAuth(),client=useQueryClient();
 const queryKey=['feed','topic',user?.id??null,topic??null,'twitter-v1'];
 const query=useInfiniteQuery({queryKey,enabled:!!topic&&!loading,initialPageParam:topic?createTopicCursor(topic):undefined,
  queryFn:({pageParam,signal})=>getTopicPage(pageParam!,user?.id??null,signal),getNextPageParam:page=>page.next,
  retry:false,gcTime:60000,staleTime:60000,refetchOnWindowFocus:false,refetchOnMount:false});
 const count=query.data?.pages.reduce((sum,page)=>sum+page.posts.length,0)??0;
 const automaticPaused=!!query.data?.pages.at(-1)?.automaticPaused;
 const isFilling=!!topic&&!automaticPaused&&count<6&&!!query.hasNextPage&&!query.isError&&!query.isFetchNextPageError&&(query.data?.pages.length??0)<4;
 useEffect(()=>{if(isFilling&&!query.isFetching)void query.fetchNextPage({cancelRefetch:false});},[isFilling,query.isFetching,query.data?.pages.length]);
 const dismiss=useCallback(async(post:PostWithAuthor)=>{
  await dismissRecommendation(post);
  const feedback=createRecommendationFeedback(post);
  client.setQueryData<typeof query.data>(queryKey,data=>data?{...data,pages:data.pages.map(page=>{
   const preferences={...page.preferences,feedback:[feedback,...(page.preferences.feedback??[])]};
   return {...page,preferences,posts:page.posts.filter(row=>!recommendationIsDismissed(row,preferences)),next:page.next?{...page.next,preferences}:undefined};
  })}:data);
 },[client,user?.id,topic]);
 return {...query,automaticPaused,isFilling,dismiss};
}

// useLists
const uuid=/^[0-9a-f-]{36}$/i;
function useListCatalog(owner?:string){return useQuery({queryKey:['list-catalog',owner??null],queryFn:()=>getListCatalog(owner!),enabled:!!owner,staleTime:60000,refetchOnWindowFocus:false});}
function useLists(owner?:string){return useQuery({queryKey:listsKey(owner),queryFn:()=>getLists(owner),enabled:!!owner,staleTime:60000,refetchOnWindowFocus:false});}
function useList(id?:string){const {user}=useAuth();return useQuery({queryKey:['user-list',user?.id??null,id],queryFn:()=>getList(id!),enabled:!!id,staleTime:60000,refetchOnWindowFocus:false});}
function useListFeed(id?:string){
 const {user}=useAuth();const list=useList(id);const members=list.data?.members??[];
 const native=members.filter(member=>uuid.test(member.id)).map(member=>member.id);
 const external=members.filter(member=>!uuid.test(member.id)).map(member=>member.id.startsWith('misskey-user:')?member.username:member.id);
 const queryKey=['feed','list',user?.id??null,id,list.data?.updated_at,'timeline-v2'];
 const query=useInfiniteQuery({queryKey,enabled:!!id&&!!list.data,
 initialPageParam:createTimelineCursor(external),queryFn:({pageParam,signal})=>loadTimelinePage(pageParam,{lime:(page,limit,before)=>getListNativePosts(native,page,limit,before,signal),bluesky:(actor,cursor,limit)=>fetchBlueskyAuthorFeed({actor,cursor,limit,signal})}),getNextPageParam:page=>page.next,staleTime:60000,refetchOnWindowFocus:false,retry:false});
 useTimelineSourceUpdates(queryKey,query.data,query.isFetching,!!id);
 return {...query,isLoading:list.isLoading||query.isLoading,isError:list.isError||query.isError,error:list.error??query.error,refetch:async()=>{await list.refetch();return query.refetch();}};
}
function useInvalidateLists(){const client=useQueryClient();return async()=>{await Promise.all([client.invalidateQueries({queryKey:['list-catalog']}),client.invalidateQueries({queryKey:['user-lists']}),client.invalidateQueries({queryKey:['user-list']}),client.invalidateQueries({queryKey:['feed','list']})]);};}

// useProfileHighlights
const LIMIT = 10;

// The first page also determines whether the profile should show the tab.
// Include the viewer so cached private posts cannot cross account boundaries.
const useProfileHighlights = (userId: string | undefined, viewerId: string | undefined) =>
  useInfiniteQuery({
    queryKey: [...profileHighlightsKey(userId ?? ''), viewerId ?? null],
    queryFn: ({ pageParam }) => getHighlightedPosts(userId!, pageParam, LIMIT),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => lastPage.length < LIMIT ? undefined : allPages.length,
    enabled: !!userId,
  });

// useTrends
// Both views observe one snapshot, including refreshes and requests in flight.
function useTrends() {
  return useQuery({
    queryKey: ['trend-ranking'], queryFn: getTrendRanking,
    staleTime: 5 * 60 * 1000, retry: 1,
  });
}

const eventName = 'lime-hidden-trends-changed';
const memory = new Map<string, string>();
function read(key: string): string {
  if (memory.has(key)) return memory.get(key)!;
  try { return localStorage.getItem(key) ?? '[]'; } catch { return '[]'; }
}
function subscribe(callback: () => void) {
  const storageChanged = (event: StorageEvent) => {
    if (event.key === null) memory.clear();
    else if (event.key.startsWith('lime_hidden_trends:')) memory.delete(event.key);
    else return;
    callback();
  };
  window.addEventListener(eventName, callback);
  window.addEventListener('storage', storageChanged);
  return () => {
    window.removeEventListener(eventName, callback);
    window.removeEventListener('storage', storageChanged);
  };
}
function useHiddenTrends(viewerId: string | null) {
  const key = `lime_hidden_trends:${viewerId ?? 'guest'}`;
  const snapshot = useSyncExternalStore(subscribe, useCallback(() => read(key), [key]), () => '[]');
  const hidden = useMemo(() => {
    try {
      const value = JSON.parse(snapshot);
      return new Set<string>(Array.isArray(value) ? value.filter(item => typeof item === 'string') : []);
    } catch { return new Set<string>(); }
  }, [snapshot]);
  const hide = useCallback((title: string) => {
    const value = JSON.stringify([...new Set([...hidden, title])].slice(-200));
    memory.set(key, value);
    try { localStorage.setItem(key, value); } catch { /* Keep both views synchronized without storage. */ }
    window.dispatchEvent(new Event(eventName));
  }, [key, hidden]);
  return [hidden, hide] as const;
}

// useSearchNews
function useSearchNews(viewerId:string|null) {
  return useQuery({
    queryKey:['search-news',viewerId],
    queryFn:getLatestSearchNews,
    staleTime:60000,
    gcTime:300000,
    refetchOnWindowFocus:false,
  });
}

function useNewsStory(storyId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['news-story', storyId],
    enabled,
    queryFn: () => getNewsStory(storyId),
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
}

// useSearchExploreTab
const SEARCH_EXPLORE_TABS = [
  {value: 'explore', label: '話題を検索'},
  {value: 'trends', label: 'トレンド'},
  {value: 'sports', label: 'スポーツ'},
  {value: 'entertainment', label: 'エンターテインメント'},
] as const;
type SearchExploreTab = typeof SEARCH_EXPLORE_TABS[number]['value'];
const useSearchExploreTabEventName = 'lime-search-explore-tab-changed';
const storageKey = 'lime_search_explore_tab';
function readTab(): SearchExploreTab {
  let stored: string | null = null;
  try { stored = localStorage.getItem(storageKey); } catch { /* Storage can be unavailable in private browsing. */ }
  return SEARCH_EXPLORE_TABS.find(tab => tab.value === stored)?.value ?? 'explore';
}
function useSearchExploreTab() {
  const [tab, setTab] = useState<SearchExploreTab>(readTab);
  useEffect(() => {
    const update = (event: Event) => { const value = (event as CustomEvent<SearchExploreTab>).detail; setTab(SEARCH_EXPLORE_TABS.some(tab => tab.value === value) ? value : readTab()); };
    window.addEventListener(useSearchExploreTabEventName, update);
    return () => window.removeEventListener(useSearchExploreTabEventName, update);
  }, []);
  const changeTab = useCallback((value: SearchExploreTab) => {
    try { localStorage.setItem(storageKey, value); } catch { /* Keep tabs usable without storage. */ }
    setTab(value);
    window.dispatchEvent(new CustomEvent(useSearchExploreTabEventName, {detail: value}));
  }, []);
  return [tab, changeTab] as const;
}

// useTrendViews
// trendViews
// Keep actual views across refreshes, independently for each local account.
const useTrendViewsMemory=new Map<string,Set<string>>();
const serialized=new Map<string,string|null>();
const key=(viewerId:string|null)=>`lime_trend_views:${viewerId??'guest'}`;
function readTrendViews(viewerId:string|null):Set<string>{
 const scope=key(viewerId),views=new Set(useTrendViewsMemory.get(scope));
 try{
  const raw=localStorage.getItem(scope);
  if(!serialized.has(scope)||serialized.get(scope)!==raw){
   const stored:unknown=JSON.parse(raw??'[]');
   if(Array.isArray(stored))for(const id of stored)if(typeof id==='string')views.add(id);
   serialized.set(scope,raw);
  }
 }catch{/* Keep browsing if storage is unavailable. */}
 useTrendViewsMemory.set(scope,views);return new Set(views);
}
function recordTrendView(id:string,viewerId:string|null):void{
 recordTrendDeliveries([id],viewerId);
}
/** Suppress already delivered cards even after a fast scroll or a refresh. */
function recordTrendDeliveries(ids:Iterable<string>,viewerId:string|null):void{
 const views=readTrendViews(viewerId),before=views.size;for(const id of ids)views.add(id);
 if(views.size===before)return;
 useTrendViewsMemory.set(key(viewerId),views);
 try{const raw=JSON.stringify([...views]);localStorage.setItem(key(viewerId),raw);serialized.set(key(viewerId),raw);}catch{/* Retain session history if storage is full. */}
}

// useTrendViews
/** Count actual visible impressions, not virtualized rows or quick scrolls. */
function useTrendViews(enabled:boolean,viewerId:string|null) {
  useEffect(()=>{
    if(!enabled || typeof IntersectionObserver==='undefined') return;
    const observed=new Map<Element,string|null>();
    const recorded=new Set<string>();
    const timers=new Map<Element,ReturnType<typeof setTimeout>>();
    const clear=(element:Element)=>{const timer=timers.get(element);if(timer) clearTimeout(timer);timers.delete(element);};
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries) {
        const id=entry.target.getAttribute('data-lime-trend-post');
        const visible=entry.isIntersecting && entry.intersectionRect.height>=Math.min(240,entry.boundingClientRect.height*.4);
        if(!visible || document.hidden) {clear(entry.target);continue;}
        if(!id || recorded.has(id) || timers.has(entry.target)) continue;
        timers.set(entry.target,setTimeout(()=>{
          timers.delete(entry.target);
          if(document.hidden || !entry.target.isConnected || entry.target.getAttribute('data-lime-trend-post')!==id) return;
          recorded.add(id);recordTrendView(id,viewerId);
        },1500));
      }
    },{threshold:[0,.05,.1,.15,.2,.4,.6,.8,1]});
    const stopTracking=observePostElements('data-lime-trend-post',element=>{
      const id=element.getAttribute('data-lime-trend-post');
      if(observed.has(element)&&observed.get(element)===id)return;
      clear(element);observer.unobserve(element);observed.set(element,id);observer.observe(element);
    },element=>{observer.unobserve(element);observed.delete(element);clear(element);});
    const visibility=()=>{
      if(document.hidden) for(const element of timers.keys()) clear(element);
      else {observer.disconnect();document.querySelectorAll('[data-lime-trend-post]').forEach(element=>observer.observe(element));}
    };
    document.addEventListener('visibilitychange',visibility);
    return ()=>{
      observer.disconnect();stopTracking();
      document.removeEventListener('visibilitychange',visibility);
      for(const element of timers.keys()) clear(element);
    };
  },[enabled,viewerId]);
}

export { useTopics };
export { useTopicFeed };
export { useListCatalog };
export { useLists };
export { useList };
export { useListFeed };
export { useInvalidateLists };
export { useProfileHighlights };
export { useTrends };
export { useHiddenTrends };
export { useSearchNews };
export { useNewsStory };
export { useSearchExploreTab };
export { SEARCH_EXPLORE_TABS };
export type { SearchExploreTab };
export { useTrendViews };
export { readTrendViews };
export { recordTrendView };
export { recordTrendDeliveries };
