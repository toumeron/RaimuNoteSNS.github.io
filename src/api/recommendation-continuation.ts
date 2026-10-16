import {getBalancedRecommendationPage} from './balanced-recommendations';
import type {RecommendationCursor} from './recommendations';
import {uniqueRecommendationPosts} from '@/lib/recommendationPaging';

/** Build a bounded reserve of verified cards instead of warming a single sparse response. */
export async function getRecommendationContinuation(cursor:RecommendationCursor,viewer:string|null,signal?:AbortSignal,onReady?:(page:Awaited<ReturnType<typeof getBalancedRecommendationPage>>)=>void){
 let page=await getBalancedRecommendationPage(cursor,viewer,signal);
 let posts=page.posts;
 onReady?.({...page,posts});
 for(let reads=1;reads<4&&posts.length<6&&page.next&&!page.automaticPaused&&!page.pendingAnalysis&&!page.twitterError&&!page.visualError;reads++){
  if(signal?.aborted)throw signal.reason;
  page=await getBalancedRecommendationPage(page.next,viewer,signal);
  posts=uniqueRecommendationPosts([...posts,...page.posts]);
  onReady?.({...page,posts});
 }
 return {...page,posts};
}
