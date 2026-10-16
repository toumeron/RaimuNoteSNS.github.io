import {topicsKey} from '@/api/topics';
import type {TopicPreferences} from '@/lib/topics';
import type {RecommendationFeedback} from '@/lib/recommendations';
import {readRecommendationReserve,saveRecommendationReserve,clearRecommendationReserve} from '@/lib/recommendationReserve';
import {getBalancedRecommendationPage} from '@/api/balanced-recommendations';
import {getRecommendationContinuation} from '@/api/recommendation-continuation';
import {preserveRecommendationHistory,uniqueRecommendationPosts} from '@/lib/recommendationPaging';
import {recordRecommendationEngagement} from "@/lib/recommendationSignals";
import { useInfiniteQuery,useQueryClient } from '@tanstack/react-query';
import { useRecommendationImpressions } from './useRecommendationImpressions';
import { useAuth } from './useAuth';
import { createRecommendationCursor,getRecommendationPreferences } from '@/api/recommendations';
import { getConfiguredExternalHandles } from '@/lib/bluesky';
import {recommendationIsDismissed,recordRecommendationDelivery,selectRecommendationLikeSamples,readRecommendationLikedIds} from '@/lib/recommendations';
import {dismissRecommendation,createRecommendationFeedback} from '@/api/recommendation-feedback';
import {useEffect,useCallback,useRef,useState,useMemo} from 'react';
export function useRecommendedFeed(enabled:boolean) {
  const {user,loading}=useAuth();
  const handlesValue=getConfiguredExternalHandles();
  const handles=useMemo(()=>handlesValue,[JSON.stringify(handlesValue)]);
  const initialCursor=useMemo(()=>createRecommendationCursor(handles),[user?.id,handles]);
  const reserveScope=JSON.stringify([user?.id??null,handles]);
  const restoredReserve=useMemo(()=>({page:user?readRecommendationReserve(reserveScope):undefined}),[reserveScope]);
  const queryClient=useQueryClient();
  const queryKey=['feed','recommended','scoring-v51-catalog-batch20',user?.id ?? null,handles];
  useRecommendationImpressions(enabled && !loading,user?.id ?? null);
  type Cursor=ReturnType<typeof createRecommendationCursor>;
  type Page=Awaited<ReturnType<typeof getBalancedRecommendationPage>>;
  const initialScanLimit=useRef(8);
  const [historyRevision,setHistoryRevision]=useState(0);
  const warmPage=useRef<{cursor:Cursor;controller:AbortController;promise:Promise<Page>;settled:boolean;ready?:Page}|null>(null);
  const clearWarmPage=()=>{warmPage.current?.controller.abort();warmPage.current=null;};
  const query=useInfiniteQuery({
    queryKey,
    initialPageParam:initialCursor,
    queryFn:async({pageParam,signal})=>{
      const warm=warmPage.current;
      const matches=warm&&!warm.controller.signal.aborted&&(warm.cursor===pageParam||pageParam.pageKey!==undefined&&warm.cursor.pageKey===pageParam.pageKey);
      if(warm&&!matches)clearWarmPage();
      if(signal.aborted)throw signal.reason;
      const cancel=()=>warm?.controller.abort(signal.reason);
      if(matches)signal.addEventListener('abort',cancel,{once:true});
      try{
        // Do not hold ready cards behind the next network/image-analysis pass.
        // Aborting that unfinished pass leaves its input cursor safe to resume.
        const ready=matches?warm.ready:undefined;
        const deliverReady=!!ready&&ready.posts.length>0;
        if(deliverReady&&!warm!.settled)warm!.controller.abort();
        const restored=!pageParam.pageKey&&!pageParam.history.length?restoredReserve.page:undefined;
        restoredReserve.page=undefined;
        const loaded=restored??(deliverReady?ready!:await (matches?warm.promise:getBalancedRecommendationPage(pageParam,user?.id??null,signal,{pageSize:20})));
        clearRecommendationReserve();
        if(signal.aborted)throw signal.reason;
        // A warmed page does not mark posts delivered until it is consumed.
        // Fresh feedback remains authoritative after background history hydration.
        const latest=queryClient.getQueryData<{pages:Page[]}>(queryKey)?.pages.at(-1)?.preferences;
        const topicPreferences=queryClient.getQueryData<TopicPreferences&{recommendationFeedback?:RecommendationFeedback[]}>(topicsKey(user?.id));
        const preferences={...(pageParam.preferences?(latest??pageParam.preferences):loaded.preferences),...(topicPreferences?{followedTopics:topicPreferences.followed,dismissedTopics:topicPreferences.dismissed,feedback:topicPreferences.recommendationFeedback}:{}),visualOnly:true};
        const locallyLiked=new Set(readRecommendationLikedIds(user?.id??null));
        const foundNewCreator=Object.entries(preferences.authors).some(([author,weight])=>weight>0&&!(loaded.preferences.authors[author]>0));
        const keep=(post:import('@/types').PostWithAuthor)=>!recommendationIsDismissed(post,preferences)&&!preferences.likedPostIds?.includes(post.id)&&!locallyLiked.has(post.id);
        // A response started before history hydration must not overwrite the
        // richer profile or terminate newly discovered creator sources.
        const next=loaded.next??(foundNewCreator?{...createRecommendationCursor(handles),lime:{page:0,done:true},trending:{cursor:null,done:true}}:undefined);
        const page=matches||preferences!==loaded.preferences?{...loaded,preferences,posts:loaded.posts.filter(keep),automaticPaused:foundNewCreator?false:loaded.automaticPaused,next:next?{...next,preferences,stalledPages:foundNewCreator?0:next.stalledPages,remaining:next.remaining.filter(keep)}:undefined}:loaded;
        const cachedPages=queryClient.getQueryData<{pages:Page[]}>(queryKey)?.pages;
        const shown=cachedPages?.flatMap(page=>page.posts)??[];
        // Refreshing must not replace an accepted visible page with a transient
        // empty scan (for example while the image model is still starting).
        if(!page.posts.length&&!pageParam.pageKey&&!pageParam.history.length&&cachedPages?.[0]?.posts.length){
          const previous=cachedPages[0];
          return {...previous,preferences,posts:previous.posts.filter(keep),next:page.next??previous.next};
        }
        const posts=(pageParam.pageKey!==undefined||pageParam.seen.length>0||pageParam.history.length>0)?uniqueRecommendationPosts(page.posts,shown):uniqueRecommendationPosts(page.posts);
        // Empty filtered pages can still advance a healthy source. The API
        // pauses only unchanged source positions; never stop merely at page 3.
        const result={...page,posts,next:page.next?preserveRecommendationHistory(page.next,[...shown,...posts]):undefined};
        recordRecommendationDelivery(posts,user?.id??null);return result;
      }finally{signal.removeEventListener('abort',cancel);if(matches&&warmPage.current===warm)warmPage.current=null;}
    },
    getNextPageParam:page=>page.pendingAnalysis?undefined:page.next,
    enabled:enabled && !loading,
    retry:false,
    staleTime:60000,
    refetchOnWindowFocus:false,
    refetchOnMount:false,
    gcTime:300000,
  });

  useEffect(()=>{
    if(enabled||loading||!user||query.data||warmPage.current)return;
    const controller=new AbortController();
    const cached=restoredReserve.page;
    const job={cursor:initialCursor,controller,promise:null as unknown as Promise<Page>,settled:false,ready:undefined as Page|undefined};
    job.promise=(cached?Promise.resolve(cached):getRecommendationContinuation(initialCursor,user.id,controller.signal,page=>{job.ready=page;saveRecommendationReserve(reserveScope,page);})).then(page=>{job.ready=page;return page;}).finally(()=>{job.settled=true;});
    warmPage.current=job;void job.promise.catch(()=>{if(warmPage.current===job)warmPage.current=null;});
  },[enabled,loading,user?.id,initialCursor,query.data]);
  const foregroundRead=useRef(query.isFetching);foregroundRead.current=query.isFetching;
  const screenEmpty=useRef(true);screenEmpty.current=!query.data?.pages.some(page=>page.posts.length>0);
  const evidenceJob=useRef<AbortController|null>(null);
  const completedHistory=useRef(false);
  useEffect(()=>{initialScanLimit.current=8;completedHistory.current=false;return()=>{evidenceJob.current?.abort();evidenceJob.current=null;};},[enabled,user?.id,JSON.stringify(handles)]);
  useEffect(()=>{
    if(!enabled||loading||!query.data||query.isFetching&&!screenEmpty.current||completedHistory.current||evidenceJob.current)return;
    const controller=new AbortController();evidenceJob.current=controller;completedHistory.current=true;
    // Saved interests hydrate separately from the bounded pixel-analysis worker,
    // so neither history nor model loading holds the first page.
    let timer:number;
    const hydrate=()=>{if(controller.signal.aborted)return;if(foregroundRead.current&&!screenEmpty.current||warmPage.current&&!warmPage.current.settled){timer=window.setTimeout(hydrate,200);return;}void getRecommendationPreferences(user?.id??null,undefined,controller.signal).then(preferences=>{
      if(controller.signal.aborted)return;completedHistory.current=true;
      let resume=false;
      queryClient.setQueryData<NonNullable<typeof query.data>>(queryKey,data=>{
        if(!data)return data;
        const last=data.pages.at(-1);
        const foundNewCreator=Object.entries(preferences.authors).some(([author,weight])=>weight>0&&!(last?.preferences.authors[author]>0));
        const pages=data.pages.map(page=>{
          const merged={...preferences,visualOnly:true,authors:{...page.preferences.authors,...preferences.authors},likedPostIds:[...new Set([...(preferences.likedPostIds??[]),...(page.preferences.likedPostIds??[])])],likedSamples:selectRecommendationLikeSamples([...(preferences.likedSamples??[]),...(page.preferences.likedSamples??[])]),feedback:[...(page.preferences.feedback??[]),...(preferences.feedback??[])].filter((row,index,rows)=>rows.findIndex(old=>old.id===row.id)===index)};
          const keep=(post:import('@/types').PostWithAuthor)=>!recommendationIsDismissed(post,merged);
          // History hydration removes rejected work without reordering cards.
          return {...page,preferences:merged,posts:page.posts.filter(keep),next:page.next?{...page.next,preferences:merged,remaining:page.next.remaining.filter(keep)}:undefined};
        });
        resume=foundNewCreator&&pages.reduce((sum,page)=>sum+page.posts.length,0)<6;
        if(resume&&pages.length){
          initialScanLimit.current=pages.length+8;
          const index=pages.length-1,page=pages[index];
          const next=preserveRecommendationHistory(page.next??{...createRecommendationCursor(handles),lime:{page:0,done:true},trending:{cursor:null,done:true}},data.pages.flatMap(page=>page.posts));
          pages[index]={...page,automaticPaused:false,next:{...next,stalledPages:0,preferences:page.preferences}};
        }
        return {...data,pages};
      });
      if(resume)setHistoryRevision(revision=>revision+1);
    }).catch(()=>{}).finally(()=>{if(evidenceJob.current===controller)evidenceJob.current=null;});};
    timer=window.setTimeout(hydrate,1200);
    controller.signal.addEventListener('abort',()=>window.clearTimeout(timer),{once:true});
  },[enabled,loading,user?.id,query.isFetching,query.data?.pages.at(-1)?.requestKey]);
  const automaticPaused=!!query.data?.pages.at(-1)?.automaticPaused;
  const count=query.data?.pages.reduce((sum,page)=>sum+page.posts.length,0)??0;
  const scanBudget=count>0?Math.max(initialScanLimit.current,24):initialScanLimit.current;
  useEffect(()=>{
   // Fill the first 20-card batch; scrolling consumes the prepared reserve.
   // This is a bounded continuation of the open timeline, not polling.
   if(enabled&&!loading&&!automaticPaused&&count<20&&query.hasNextPage&&!query.isFetching&&!query.isError&&!query.isFetchNextPageError&&(query.data?.pages.length??0)<scanBudget)void query.fetchNextPage({cancelRefetch:false});
  },[enabled,loading,automaticPaused,count,query.hasNextPage,query.isFetching,query.isError,query.isFetchNextPageError,query.data?.pages.length,historyRevision]);
  useEffect(()=>{
    if(!enabled||loading||query.isFetching||query.isError||automaticPaused)return;
    const last=query.data?.pages.at(-1),cursor=last?.next;
    if(!cursor||!count||warmPage.current)return;
    // Keep a reserve of usable cards, not just one potentially sparse response.
    // A single shared job is reused if scrolling catches up with preparation.
    const timer=window.setTimeout(()=>{
      if(warmPage.current||queryClient.getQueryState(queryKey)?.fetchStatus==='fetching')return;
      const controller=new AbortController();
      const job={cursor,controller,promise:null as unknown as Promise<Page>,settled:false,ready:undefined as Page|undefined};
      job.promise=getRecommendationContinuation(cursor,user?.id??null,controller.signal,page=>{job.ready=page;saveRecommendationReserve(reserveScope,page);}).finally(()=>{job.settled=true;});
      // Prefetch failures are handled by the ordinary visible page read.
      void job.promise.catch(()=>{if(warmPage.current===job)warmPage.current=null;});
      warmPage.current=job;
    },0);
    return()=>window.clearTimeout(timer);
  },[enabled,loading,query.isFetching,query.isError,automaticPaused,count,query.data?.pages.at(-1)?.requestKey]);
  useEffect(()=>()=>clearWarmPage(),[user?.id,JSON.stringify(handles)]);
  const dismiss=useCallback(async(post:import('@/types').PostWithAuthor)=>{
   clearWarmPage();clearRecommendationReserve();restoredReserve.page=undefined;
   await queryClient.cancelQueries({queryKey});
   const previous=queryClient.getQueryData(queryKey);
   const feedback=createRecommendationFeedback(post);
   queryClient.setQueryData<NonNullable<typeof query.data>>(queryKey,current=>current?{...current,pages:current.pages.map(page=>{
    const preferences={...page.preferences,feedback:[feedback,...(page.preferences.feedback??[]).filter(row=>row.id!==feedback.id)].slice(0,200)};
    const remove=(row:typeof post)=>!recommendationIsDismissed(row,preferences);
    return {...page,posts:page.posts.filter(remove),preferences,next:page.next?{...page.next,preferences,remaining:page.next.remaining.filter(remove)}:undefined};
   })}:current);
   try{await dismissRecommendation(post);recordRecommendationEngagement(post,user?.id??null,'not_interested');}
   catch(error){await queryClient.cancelQueries({queryKey});queryClient.setQueryData(queryKey,previous);throw error;}
   void queryClient.invalidateQueries({queryKey:['recommendation-preferences',user?.id??null]});
  },[queryClient,user?.id,JSON.stringify(handles)]);
  const isFilling=enabled&&!loading&&!automaticPaused&&count<20&&!!query.hasNextPage&&!query.isError&&!query.isFetchNextPageError&&(query.data?.pages.length??0)<scanBudget;
  return {...query,visualError:query.data?.pages.at(-1)?.visualError,twitterError:query.data?.pages.at(-1)?.twitterError,retryTwitter:()=>query.fetchNextPage({cancelRefetch:false}),automaticPaused,isFilling,dismiss};
}
