import { clearRecommendationReserve, uniqueRecommendationPosts } from "@/lib/topicRecommendations";
import { type RecommendationFeedback, scoreRecommendation, type RecommendationPreferences } from "@/lib/recommendations";
import { supabase } from "@/lib/supabase";
import { isTopicId, type TopicId, type TopicPreferences } from "@/lib/topics";
import { type RecommendationAction, recommendationIdentity } from "@/lib/recommendationSignals";
import { type PostWithAuthor } from "@/types/index";
import { getBalancedRecommendationPage } from "@/api/balanced-recommendations";
import { type RecommendationCursor } from "@/api/recommendations";

// topics
const topicsKey=(userId:string|null|undefined)=>['topic-preferences',userId] as const;
async function getTopicPreferences(userId:string,signal?:AbortSignal):Promise<TopicPreferences & {recommendationFeedback:RecommendationFeedback[]}> {
 const request=supabase.from('profile_private_settings').select('followed_topics,dismissed_topics,recommendation_feedback').eq('user_id',userId);
 const {data,error}=await (signal?request.abortSignal(signal):request).maybeSingle();
 if(error)throw error;
 return {followed:(data?.followed_topics??[]).filter(isTopicId),dismissed:(data?.dismissed_topics??[]).filter(isTopicId),recommendationFeedback:Array.isArray(data?.recommendation_feedback)?data.recommendation_feedback:[]};
}
async function updateTopicPreferences(ids:TopicId[],status:'follow'|'dismiss'|'clear'):Promise<void> {
 const {error}=await supabase.rpc('update_topic_preferences',{topic_ids:ids,disposition:status});
 if(error)throw error;clearRecommendationReserve();
}

// learned-recommendations
type Exposure = { qid:string;id:string;features:number[];viewer:string;at:number };
const exposures=new Map<string,Exposure>();
let unavailableUntil=0;
function rankingFeatures(post:PostWithAuthor,preferences:RecommendationPreferences,viewer:string,now=Date.now()):number[] {
 const s=scoreRecommendation(post,preferences,viewer,{now});
 const source=post.source;
 return [s.interest,s.recentInterest,s.author,s.follow,s.freshness,s.quality,s.seenPenalty,s.spamPenalty,s.selfPenalty,s.total,post.imageUrls?.length?1:0,source!=='bluesky'&&source!=='misskey'?1:0,source==='bluesky'?1:0,source==='misskey'?1:0,Math.min(1,(post.content?.length??0)/1000)].map(n=>Math.max(-1000,Math.min(1000,Number.isFinite(n)?n:0)));
}
/** Ranking failure never blocks the existing recommendation feed. */
async function learnedRecommendationScores(posts:PostWithAuthor[],preferences:RecommendationPreferences,viewer:string|null,signal?:AbortSignal):Promise<Record<string,number>> {
 if(import.meta.env.VITE_RECOMMENDATION_RANKER_ENABLED!=='true'||!viewer||!posts.length||Date.now()<unavailableUntil)return {};
 const now=Date.now(),qid=crypto.randomUUID();
 const candidates=posts.slice(0,80).map(post=>({id:recommendationIdentity(post),features:rankingFeatures(post,preferences,viewer,now)}));
 const controller=new AbortController();
 const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 const timer=setTimeout(abort,1500);
 try {
  const cancelled=new Promise<never>((_,reject)=>{const fail=()=>reject(new DOMException('Cancelled','AbortError'));if(controller.signal.aborted)fail();else controller.signal.addEventListener('abort',fail,{once:true});});
  const session=await Promise.race([supabase.auth.getSession(),cancelled]);
  if(!session.data.session||session.data.session.user.id!==viewer)return {};
  const url=`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/recommendation-ranker`;
  const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${session.data.session.access_token}`,apikey:import.meta.env.VITE_SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({action:'rank',candidates}),signal:controller.signal});
  if(!response.ok)throw new Error('ranker unavailable');
  const result=await response.json();
  for(const candidate of candidates)exposures.set(`${viewer}:${candidate.id}`,{...candidate,qid,viewer,at:now});
  for(const [key,value] of exposures)if(now-value.at>30*60*1000)exposures.delete(key);
  while(exposures.size>500)exposures.delete(exposures.keys().next().value!);
  return Object.fromEntries(candidates.filter(candidate=>Number.isFinite(result.scores?.[candidate.id])).map(candidate=>[candidate.id,result.scores[candidate.id]]));
 } catch {if(!signal?.aborted)unavailableUntil=Date.now()+5*60*1000;return {};}
 finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
function recordLearnedRecommendation(id:string,viewer:string|null,label:0|2) {
 recordLearnedAction(id,viewer,label===2?'like':'impression');
}
function recordLearnedAction(id:string,viewer:string|null,action:RecommendationAction,active=true) {
 if(!viewer)return;
 const event=exposures.get(`${viewer}:${id}`);if(!event||Date.now()-event.at>30*60*1000)return;
 void supabase.rpc('record_recommendation_training',{p_event:{qid:event.qid,id:event.id,features:event.features,viewer,action,active}}).then(()=>{},()=>{});
}

window.addEventListener('lime:recommendation-engagement',event=>{
 const detail=(event as CustomEvent).detail;
 if(typeof detail?.id==='string'&&typeof detail?.viewer==='string'&&['impression','like','repost','bookmark','not_interested'].includes(detail.action)&&typeof detail.active==='boolean')recordLearnedAction(detail.id,detail.viewer,detail.action,detail.active);
});

// recommendation-continuation
/** Build a bounded reserve of verified cards instead of warming a single sparse response. */
async function getRecommendationContinuation(cursor:RecommendationCursor,viewer:string|null,signal?:AbortSignal,onReady?:(page:Awaited<ReturnType<typeof getBalancedRecommendationPage>>)=>void,options?:{target?:number}){
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

export { getTopicPreferences };
export { updateTopicPreferences };
export { topicsKey };
export { rankingFeatures };
export { learnedRecommendationScores };
export { recordLearnedRecommendation };
export { recordLearnedAction };
export { getRecommendationContinuation };
