import { preserveRecommendationHistory } from "@/lib/topicRecommendations";
import { useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { refreshRecommendationVisualPage, type getRecommendationPage } from "@/api/recommendations";
import { type PostWithAuthor } from "@/types/index";

// useRecommendationImages
type Page=Awaited<ReturnType<typeof getRecommendationPage>>;
type Feed={pages:Page[];pageParams:unknown[]};
/** A serial, bounded pixel-analysis job runs after first paint, never in the page request. */
function useRecommendationImages(enabled:boolean,viewer:string|null,key:QueryKey,feed:Feed|undefined,busy:boolean){
 const [completed,setCompleted]=useState(0);
 const client=useQueryClient(),job=useRef<AbortController|null>(null),attempted=useRef(new Set<string>()),count=useRef(0);
 useEffect(()=>{attempted.current.clear();count.current=0;return()=>{job.current?.abort();job.current=null;};},[enabled,viewer]);
 const revision=feed?.pages.flatMap(page=>page.posts.map(post=>post.id)).join('|');
 useEffect(()=>{
  const prefs=feed?.pages.at(-1)?.preferences,limit=16+Math.max(0,(feed?.pages.length??1)-1)*4;
  if(!enabled||busy||!prefs?.followedTopics?.length||job.current||count.current>=limit||typeof Worker==='undefined')return;
  const pending=(posts:PostWithAuthor[])=>posts.filter(post=>post.imageUrls.length&&!post.recommendationVisual&&!attempted.current.has(post.imageUrls[0]));
  // Learn actual liked pixels as well as candidate pixels. One worker, four images maximum per job.
  const candidates=pending(feed!.pages.flatMap(page=>page.posts)),pools=new Map<string,PostWithAuthor[]>();
  for(const post of candidates){const source=post.source??'lime',pool=pools.get(source)??[];pool.push(post);pools.set(source,pool);}
  const selected=[...pools.values()].flatMap(pool=>pool.slice(0,1));
  if(selected.length<2)selected.push(...candidates.filter(post=>!selected.includes(post)).slice(0,2-selected.length));
  const rejected=pending((prefs.feedback??[]).filter(row=>row.imageUrls?.length&&!row.vector).map(row=>({id:row.id,userId:row.userId,content:'',imageUrls:row.imageUrls!,createdAt:row.createdAt,author:{id:row.userId,username:''}} as PostWithAuthor))).slice(0,1);
  const rows=[...pending(prefs.likedSamples??[]).slice(0,rejected.length?1:2),...rejected,...selected.slice(0,2)].slice(0,limit-count.current);
  if(!rows.length)return;
  const controller=new AbortController();job.current=controller;
  const timer=window.setTimeout(()=>{
   rows.forEach(post=>attempted.current.add(post.imageUrls[0]));count.current+=rows.length;
   void import('@/lib/recommendationVisualInference').then(async({enrichRecommendationVisuals,releaseRecommendationVisualWorker})=>{
    try{await enrichRecommendationVisuals(rows,prefs.followedTopics!,controller.signal,checked=>{
     if(controller.signal.aborted||!checked.recommendationVisual)return;
     client.setQueryData<Feed>(key,data=>{
      if(!data)return data;
      const shown:PostWithAuthor[]=[];
      const pages=data.pages.map(page=>{
       const updated={...page,...refreshRecommendationVisualPage(page,viewer,checked,false)};
       shown.push(...updated.posts);
       return {...updated,next:updated.next?preserveRecommendationHistory(updated.next,shown):undefined};
      });
      return {...data,pages};
     });
    },rows.length);}finally{releaseRecommendationVisualWorker();}
   }).catch(()=>{}).finally(()=>{if(job.current===controller){job.current=null;if(!controller.signal.aborted)setCompleted(value=>value+1);}});
  },1200);
  // A new page may arrive while analysis runs. Do not abort completed work or start a second worker.
  return()=>{window.clearTimeout(timer);if(!attempted.current.has(rows[0].imageUrls[0])){controller.abort();if(job.current===controller)job.current=null;}};
 },[enabled,viewer,revision,busy,completed,feed?.pages.length,feed?.pages.at(-1)?.preferences.likedSamples?.length]);
}

// useTimelineContinuation
/** Keep paging a visible bottom without overlapping reads. Empty source bursts
 * are paused by the feed and require one new gesture to try again. */
function useTimelineContinuation({enabled,inView,hasNextPage,isFetching,isFetchNextPageError,automaticPaused,scrollIntent,pageCount,fetchNextPage}:{
 enabled:boolean;inView:boolean;hasNextPage:boolean;isFetching:boolean;isFetchNextPageError:boolean;
 automaticPaused:boolean;scrollIntent:number;pageCount:number;fetchNextPage:(options:{cancelRefetch:boolean})=>Promise<unknown>;
}) {
 const consumedIntent=useRef(0);
 useEffect(()=>{
  if(!enabled||!inView||!hasNextPage||isFetching)return;
  if((automaticPaused||isFetchNextPageError)&&scrollIntent<=consumedIntent.current)return;
  consumedIntent.current=scrollIntent;
  void fetchNextPage({cancelRefetch:false});
 // A warmed page may resolve before React publishes isFetching=true.
 // Its page count still advances, so the visible bottom must be rechecked.
 },[enabled,inView,hasNextPage,isFetching,isFetchNextPageError,automaticPaused,scrollIntent,pageCount,fetchNextPage]);
}

export { useRecommendationImages };
export { useTimelineContinuation };
