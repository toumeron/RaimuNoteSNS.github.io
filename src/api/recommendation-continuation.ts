import {getBalancedRecommendationPage} from './balanced-recommendations';
import type {RecommendationCursor} from './recommendations';
import {uniqueRecommendationPosts} from '@/lib/recommendationPaging';

/** Build a bounded reserve of verified cards instead of warming a single sparse response. */
export async function getRecommendationContinuation(cursor:RecommendationCursor,viewer:string|null,signal?:AbortSignal,onReady?:(page:Awaited<ReturnType<typeof getBalancedRecommendationPage>>)=>void,options?:{target?:number}){
 const target=Math.max(2,Math.min(20,options?.target??20)),maxReads=Math.min(10,Math.max(4,Math.ceil(target/2)));
 let page=await getBalancedRecommendationPage(cursor,viewer,signal,{pageSize:target});
 let posts=page.posts;
 onReady?.({...page,posts});
 for(let reads=1;reads<maxReads&&posts.length<target&&page.next&&!page.automaticPaused&&!page.pendingAnalysis;reads++){
  if(signal?.aborted)throw signal.reason;
  page=await getBalancedRecommendationPage(page.next,viewer,signal,{pageSize:Math.max(2,target-posts.length)});
  posts=uniqueRecommendationPosts([...posts,...page.posts]);
  onReady?.({...page,posts});
 }
 return {...page,posts};
}
