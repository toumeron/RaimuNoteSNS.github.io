import type {RecommendationAction} from "@/lib/recommendationSignals";
import { supabase } from '@/lib/supabase';
import { scoreRecommendation, type RecommendationPreferences } from '@/lib/recommendations';
import { recommendationIdentity } from "@/lib/recommendationSignals";
import type { PostWithAuthor } from '@/types';
type Exposure = { qid:string;id:string;features:number[];viewer:string;at:number };
const exposures=new Map<string,Exposure>();
let unavailableUntil=0;
export function rankingFeatures(post:PostWithAuthor,preferences:RecommendationPreferences,viewer:string,now=Date.now()):number[] {
 const s=scoreRecommendation(post,preferences,viewer,{now});
 const source=post.source;
 return [s.interest,s.recentInterest,s.author,s.follow,s.freshness,s.quality,s.seenPenalty,s.spamPenalty,s.selfPenalty,s.total,post.imageUrls?.length?1:0,source!=='bluesky'&&source!=='misskey'?1:0,source==='bluesky'?1:0,source==='misskey'?1:0,Math.min(1,(post.content?.length??0)/1000)].map(n=>Math.max(-1000,Math.min(1000,Number.isFinite(n)?n:0)));
}
/** Ranking failure never blocks the existing recommendation feed. */
export async function learnedRecommendationScores(posts:PostWithAuthor[],preferences:RecommendationPreferences,viewer:string|null,signal?:AbortSignal):Promise<Record<string,number>> {
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
export function recordLearnedRecommendation(id:string,viewer:string|null,label:0|2) {
 recordLearnedAction(id,viewer,label===2?'like':'impression');
}
export function recordLearnedAction(id:string,viewer:string|null,action:RecommendationAction,active=true) {
 if(!viewer)return;
 const event=exposures.get(`${viewer}:${id}`);if(!event||Date.now()-event.at>30*60*1000)return;
 void supabase.rpc('record_recommendation_training',{p_event:{qid:event.qid,id:event.id,features:event.features,viewer,action,active}}).then(()=>{},()=>{});
}

window.addEventListener('lime:recommendation-engagement',event=>{
 const detail=(event as CustomEvent).detail;
 if(typeof detail?.id==='string'&&typeof detail?.viewer==='string'&&['impression','like','repost','bookmark','not_interested'].includes(detail.action)&&typeof detail.active==='boolean')recordLearnedAction(detail.id,detail.viewer,detail.action,detail.active);
});
