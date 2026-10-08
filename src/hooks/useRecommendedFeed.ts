import { useInfiniteQuery,useQueryClient } from '@tanstack/react-query';
import { useRecommendationImpressions } from './useRecommendationImpressions';
import { useAuth } from './useAuth';
import { createRecommendationCursor, getRecommendationPage,getRecommendationPreferences } from '@/api/recommendations';
import { getConfiguredExternalHandles } from '@/lib/bluesky';
import {recommendationIsDismissed,recordRecommendationDelivery,selectRecommendationLikeSamples} from '@/lib/recommendations';
import {dismissRecommendation,createRecommendationFeedback} from '@/api/recommendation-feedback';
import {useEffect,useCallback,useRef} from 'react';
export function useRecommendedFeed(enabled:boolean) {
  const {user,loading}=useAuth();
  const handles=getConfiguredExternalHandles();
  const queryClient=useQueryClient();
  const queryKey=['feed','recommended','scoring-v20-history',user?.id ?? null,handles];
  useRecommendationImpressions(enabled && !loading,user?.id ?? null);
  const query=useInfiniteQuery({
    queryKey,
    initialPageParam:createRecommendationCursor(handles),
    queryFn:async({pageParam,signal})=>{const page=await getRecommendationPage(pageParam,user?.id??null,signal);if(!signal.aborted)recordRecommendationDelivery(page.posts,user?.id??null);return page;},
    getNextPageParam:page=>page.pendingAnalysis?undefined:page.next,
    enabled:enabled && !loading,
    retry:false,
    staleTime:60000,
    refetchOnWindowFocus:false,
    gcTime:60000,
  });
  const evidenceJob=useRef<AbortController|null>(null);
  const completedHistory=useRef(false);
  useEffect(()=>{completedHistory.current=false;return()=>{evidenceJob.current?.abort();evidenceJob.current=null;};},[enabled,user?.id,JSON.stringify(handles)]);
  useEffect(()=>{
    if(!enabled||loading||!query.data||completedHistory.current||evidenceJob.current)return;
    const controller=new AbortController();evidenceJob.current=controller;
    // An on-device CLIP inference heap exceeds iOS PWA's practical memory
    // budget. Use saved image evidence; never start/download that model here.
    const timer=window.setTimeout(()=>{void getRecommendationPreferences(user?.id??null).then(preferences=>{
      if(controller.signal.aborted)return;completedHistory.current=true;
      queryClient.setQueryData<NonNullable<typeof query.data>>(queryKey,data=>data?{...data,pages:data.pages.map(page=>{
        const merged={...preferences,authors:{...page.preferences.authors,...preferences.authors},likedPostIds:[...new Set([...(preferences.likedPostIds??[]),...(page.preferences.likedPostIds??[])])],likedSamples:selectRecommendationLikeSamples([...(preferences.likedSamples??[]),...(page.preferences.likedSamples??[])]),feedback:[...(page.preferences.feedback??[]),...(preferences.feedback??[])].filter((row,index,rows)=>rows.findIndex(old=>old.id===row.id)===index)};
        const keep=(post:import('@/types').PostWithAuthor)=>!recommendationIsDismissed(post,merged);
        // History hydration may remove rejected work but never inject/reorder
        // cards or consume another cursor behind the reader's scroll position.
        return {...page,preferences:merged,posts:page.posts.filter(keep),next:page.next?{...page.next,preferences:merged,remaining:page.next.remaining.filter(keep)}:undefined};
      })}:data);
    }).catch(()=>{}).finally(()=>{if(evidenceJob.current===controller)evidenceJob.current=null;});},500);
    controller.signal.addEventListener('abort',()=>window.clearTimeout(timer),{once:true});
  },[enabled,loading,user?.id,query.data?.pages.at(-1)?.requestKey]);
  const count=query.data?.pages.reduce((sum,page)=>sum+page.posts.length,0)??0;
  useEffect(()=>{
   // Fill a usable first page even when filtering leaves only a few works.
   // This is a bounded continuation of the open timeline, not polling.
   if(enabled&&!loading&&count<20&&query.hasNextPage&&!query.isFetching&&!query.isError&&!query.isFetchNextPageError&&(query.data?.pages.length??0)<8)void query.fetchNextPage();
  },[enabled,loading,count,query.hasNextPage,query.isFetching,query.isError,query.isFetchNextPageError,query.data?.pages.length]);
  const dismiss=useCallback(async(post:import('@/types').PostWithAuthor)=>{
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
  return {...query,dismiss};
}
