import { useInfiniteQuery,useQueryClient } from '@tanstack/react-query';
import { useRecommendationImpressions } from './useRecommendationImpressions';
import { useAuth } from './useAuth';
import { createRecommendationCursor, getRecommendationPage,getRecommendationPreferences } from '@/api/recommendations';
import { getConfiguredExternalHandles } from '@/lib/bluesky';
import {recommendationIsDismissed,recordRecommendationDelivery,selectRecommendationLikeSamples} from '@/lib/recommendations';
import {dismissRecommendation,createRecommendationFeedback} from '@/api/recommendation-feedback';
import {useEffect,useCallback,useRef,useState} from 'react';
export function useRecommendedFeed(enabled:boolean) {
  const {user,loading}=useAuth();
  const handles=getConfiguredExternalHandles();
  const queryClient=useQueryClient();
  const queryKey=['feed','recommended','scoring-v26-healthy-reads-and-history-resume',user?.id ?? null,handles];
  useRecommendationImpressions(enabled && !loading,user?.id ?? null);
  type Cursor=ReturnType<typeof createRecommendationCursor>;
  type Page=Awaited<ReturnType<typeof getRecommendationPage>>;
  const initialScanLimit=useRef(8);
  const [historyRevision,setHistoryRevision]=useState(0);
  const warmPage=useRef<{cursor:Cursor;controller:AbortController;promise:Promise<Page>;settled:boolean}|null>(null);
  const clearWarmPage=()=>{warmPage.current?.controller.abort();warmPage.current=null;};
  const query=useInfiniteQuery({
    queryKey,
    initialPageParam:createRecommendationCursor(handles),
    queryFn:async({pageParam,signal})=>{
      const warm=warmPage.current;
      const matches=warm&&!warm.controller.signal.aborted&&(warm.cursor===pageParam||pageParam.pageKey!==undefined&&warm.cursor.pageKey===pageParam.pageKey);
      if(warm&&!matches)clearWarmPage();
      if(signal.aborted)throw signal.reason;
      const cancel=()=>warm?.controller.abort(signal.reason);
      if(matches)signal.addEventListener('abort',cancel,{once:true});
      try{
        const loaded=await (matches?warm.promise:getRecommendationPage(pageParam,user?.id??null,signal));
        if(signal.aborted)throw signal.reason;
        // A warmed page does not mark posts delivered until it is consumed.
        // Fresh feedback remains authoritative after background history hydration.
        const latest=queryClient.getQueryData<{pages:Page[]}>(queryKey)?.pages.at(-1)?.preferences;
        const preferences=pageParam.preferences?(latest??pageParam.preferences):loaded.preferences;
        const foundNewCreator=Object.entries(preferences.authors).some(([author,weight])=>weight>0&&!(loaded.preferences.authors[author]>0));
        const keep=(post:import('@/types').PostWithAuthor)=>!recommendationIsDismissed(post,preferences)&&!preferences.likedPostIds?.includes(post.id);
        // A response started before history hydration must not overwrite the
        // richer profile or terminate newly discovered creator sources.
        const next=loaded.next??(foundNewCreator?{...createRecommendationCursor(handles),lime:{page:0,done:true},trending:{cursor:null,done:true}}:undefined);
        const page=matches||preferences!==loaded.preferences?{...loaded,preferences,posts:loaded.posts.filter(keep),automaticPaused:foundNewCreator?false:loaded.automaticPaused,next:next?{...next,preferences,stalledPages:foundNewCreator?0:next.stalledPages,remaining:next.remaining.filter(keep)}:undefined}:loaded;
        recordRecommendationDelivery(page.posts,user?.id??null);return page;
      }finally{signal.removeEventListener('abort',cancel);if(matches&&warmPage.current===warm)warmPage.current=null;}
    },
    getNextPageParam:page=>page.pendingAnalysis?undefined:page.next,
    enabled:enabled && !loading,
    retry:false,
    staleTime:60000,
    refetchOnWindowFocus:false,
    refetchOnMount:false,
    gcTime:60000,
  });
  const foregroundRead=useRef(query.isFetching);foregroundRead.current=query.isFetching;
  const screenEmpty=useRef(true);screenEmpty.current=!query.data?.pages.some(page=>page.posts.length>0);
  const evidenceJob=useRef<AbortController|null>(null);
  const completedHistory=useRef(false);
  useEffect(()=>{initialScanLimit.current=8;completedHistory.current=false;return()=>{evidenceJob.current?.abort();evidenceJob.current=null;};},[enabled,user?.id,JSON.stringify(handles)]);
  useEffect(()=>{
    if(!enabled||loading||!query.data||query.isFetching&&!screenEmpty.current||completedHistory.current||evidenceJob.current)return;
    const controller=new AbortController();evidenceJob.current=controller;completedHistory.current=true;
    // An on-device CLIP inference heap exceeds iOS PWA's practical memory
    // budget. Use saved image evidence; never start/download that model here.
    let timer:number;
    const hydrate=()=>{if(controller.signal.aborted)return;if(foregroundRead.current&&!screenEmpty.current||warmPage.current&&!warmPage.current.settled){timer=window.setTimeout(hydrate,200);return;}void getRecommendationPreferences(user?.id??null,undefined,controller.signal).then(preferences=>{
      if(controller.signal.aborted)return;completedHistory.current=true;
      let resume=false;
      queryClient.setQueryData<NonNullable<typeof query.data>>(queryKey,data=>{
        if(!data)return data;
        const last=data.pages.at(-1);
        const foundNewCreator=Object.entries(preferences.authors).some(([author,weight])=>weight>0&&!(last?.preferences.authors[author]>0));
        const pages=data.pages.map(page=>{
          const merged={...preferences,authors:{...page.preferences.authors,...preferences.authors},likedPostIds:[...new Set([...(preferences.likedPostIds??[]),...(page.preferences.likedPostIds??[])])],likedSamples:selectRecommendationLikeSamples([...(preferences.likedSamples??[]),...(page.preferences.likedSamples??[])]),feedback:[...(page.preferences.feedback??[]),...(preferences.feedback??[])].filter((row,index,rows)=>rows.findIndex(old=>old.id===row.id)===index)};
          const keep=(post:import('@/types').PostWithAuthor)=>!recommendationIsDismissed(post,merged);
          // History hydration removes rejected work without reordering cards.
          return {...page,preferences:merged,posts:page.posts.filter(keep),next:page.next?{...page.next,preferences:merged,remaining:page.next.remaining.filter(keep)}:undefined};
        });
        resume=foundNewCreator&&pages.reduce((sum,page)=>sum+page.posts.length,0)<6;
        if(resume&&pages.length){
          initialScanLimit.current=pages.length+8;
          const index=pages.length-1,page=pages[index];
          const next=page.next??{...createRecommendationCursor(handles),lime:{page:0,done:true},trending:{cursor:null,done:true}};
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
  useEffect(()=>{
   // Fill only the first screen; scrolling owns subsequent small pages.
   // This is a bounded continuation of the open timeline, not polling.
   if(enabled&&!loading&&!automaticPaused&&count<6&&query.hasNextPage&&!query.isFetching&&!query.isError&&!query.isFetchNextPageError&&(query.data?.pages.length??0)<initialScanLimit.current)void query.fetchNextPage({cancelRefetch:false});
  },[enabled,loading,automaticPaused,count,query.hasNextPage,query.isFetching,query.isError,query.isFetchNextPageError,query.data?.pages.length,historyRevision]);
  useEffect(()=>{
    if(!enabled||loading||query.isFetching||query.isError||automaticPaused)return;
    const last=query.data?.pages.at(-1),cursor=last?.next;
    if(!cursor||count<6||warmPage.current)return;
    // Prepare only ONE small continuation while the reader sees existing cards.
    // Consuming that same promise cannot launch another copy or a large batch.
    const timer=window.setTimeout(()=>{
      if(warmPage.current)return;
      const controller=new AbortController();
      const job={cursor,controller,promise:null as unknown as Promise<Page>,settled:false};
      job.promise=getRecommendationPage(cursor,user?.id??null,controller.signal).finally(()=>{job.settled=true;});
      // Prefetch failures are handled by the ordinary visible page read.
      void job.promise.catch(()=>{if(warmPage.current===job)warmPage.current=null;});
      warmPage.current=job;
    },350);
    return()=>window.clearTimeout(timer);
  },[enabled,loading,query.isFetching,query.isError,automaticPaused,count,query.data?.pages.at(-1)?.requestKey]);
  useEffect(()=>()=>clearWarmPage(),[enabled,user?.id,JSON.stringify(handles)]);
  const dismiss=useCallback(async(post:import('@/types').PostWithAuthor)=>{
   clearWarmPage();
   await queryClient.cancelQueries({queryKey});
   const previous=queryClient.getQueryData(queryKey);
   const feedback=createRecommendationFeedback(post);
   queryClient.setQueryData<NonNullable<typeof query.data>>(queryKey,current=>current?{...current,pages:current.pages.map(page=>{
    const preferences={...page.preferences,feedback:[feedback,...(page.preferences.feedback??[]).filter(row=>row.id!==feedback.id)].slice(0,200)};
    const remove=(row:typeof post)=>!recommendationIsDismissed(row,preferences);
    return {...page,posts:page.posts.filter(remove),preferences,next:page.next?{...page.next,preferences,remaining:page.next.remaining.filter(remove)}:undefined};
   })}:current);
   try{await dismissRecommendation(post);}
   catch(error){await queryClient.cancelQueries({queryKey});queryClient.setQueryData(queryKey,previous);throw error;}
   void queryClient.invalidateQueries({queryKey:['recommendation-preferences',user?.id??null]});
  },[queryClient,user?.id,JSON.stringify(handles)]);
  const isFilling=enabled&&!loading&&!automaticPaused&&count<6&&!!query.hasNextPage&&!query.isError&&!query.isFetchNextPageError&&(query.data?.pages.length??0)<initialScanLimit.current;
  return {...query,automaticPaused,isFilling,dismiss};
}
