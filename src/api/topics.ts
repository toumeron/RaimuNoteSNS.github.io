import { clearRecommendationReserve, uniqueRecommendationPosts, type RecommendationAction, recommendationIdentity, rankTopicPosts, recommendationFingerprint, type RecommendationFeedback, scoreRecommendation, type RecommendationPreferences, isTopicId, type TopicId, type TopicPreferences, TOPICS, trendSearchVolume, type ExploreTrend } from "@/lib/recommendations";
import { supabase } from "@/lib/supabase";
import { type PostWithAuthor } from "@/types/index";
import { getBalancedRecommendationPage } from "@/api/balanced-recommendations";
import { type RecommendationCursor, getRecommendationPreferences } from "@/api/recommendations";
import { searchXPage } from "@/lib/fxTwitter";
import { searchPosts } from "@/api/posts";
import { fetchBlueskyTopicPosts, discoverBlueskyTopicFeeds, fetchBlueskyTopicFeed } from "@/lib/bluesky";
import { fetchMisskeyTopicPosts } from "@/lib/misskey";
import { normalizeTimelineBlueskyPost } from "@/lib/utils";
import { applyCachedRecommendationVisuals } from "@/lib/recommendationVisual";
import { EMPTY_ANIME_HISTORY, type AnimeHistoryState, type AnimeImportItem, type AnimeWork, type AnimeEpisode } from "../../supabase/functions/_shared/animeHistory";

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

// topic-feed
type Position={native:number;nativeDone:boolean;blue:string|null;blueDone:boolean;misskey:string|null;misskeyDone:boolean;twitter?:string|null;twitterDone?:boolean};
type TopicCursor={topic:TopicId;round:number;now:number;positions:Position[];seen:string[];preferences?:RecommendationPreferences;empty:number;feeds?:string[];feedPositions?:Record<string,{cursor:string|null;done:boolean}>};
function createTopicCursor(topic:TopicId):TopicCursor {return {topic,round:0,now:Date.now(),positions:TOPICS.find(t=>t.id===topic)!.queries.map(()=>({native:0,nativeDone:false,blue:null,blueDone:false,misskey:null,misskeyDone:false,twitter:null,twitterDone:false})),seen:[],empty:0};}
async function loadTopicPage(previous:TopicCursor,viewer:string|null,signal?:AbortSignal) {
 if(signal?.aborted)throw signal.reason;
 const cursor={...previous,positions:previous.positions.map(position=>({...position})),seen:[...previous.seen],feedPositions:Object.fromEntries(Object.entries(previous.feedPositions??{}).map(([id,state])=>[id,{...state}]))};
 const preferences=cursor.preferences??await getRecommendationPreferences(viewer,undefined,signal);cursor.preferences=preferences;
 const terms=TOPICS.find(topic=>topic.id===cursor.topic)!.queries;
 const index=cursor.round++%terms.length,term=terms[index],state=cursor.positions[index];
 const jobs:Promise<PostWithAuthor[]>[]=[];
 // One query per service and page keeps the candidate budget bounded.
 if(!state.nativeDone)jobs.push(searchPosts(term,state.native,12,signal).then(rows=>{state.native++;state.nativeDone=rows.length<12;return rows;}));
 if(!state.blueDone)jobs.push(fetchBlueskyTopicPosts({query:term,cursor:state.blue,limit:12,signal}).then(page=>{state.blueDone=!page.cursor||page.cursor===state.blue;state.blue=page.cursor??null;return page.posts.map(normalizeTimelineBlueskyPost);}));
 if(!state.twitterDone)jobs.push(searchXPage(term,{cursor:state.twitter,feed:'top',preferAlternative:true,limit:6,signal}).then(page=>{state.twitterDone=!page.cursor||page.cursor===state.twitter;state.twitter=page.cursor??null;return page.posts.map(normalizeTimelineBlueskyPost);}));
 if(!state.misskeyDone)jobs.push(fetchMisskeyTopicPosts({query:term,cursor:state.misskey,limit:12,signal}).then(page=>{state.misskeyDone=!page.cursor||page.cursor===state.misskey;state.misskey=page.cursor;return page.posts.map(normalizeTimelineBlueskyPost);}));
 jobs.push((async()=>{
  cursor.feeds??=await discoverBlueskyTopicFeeds(cursor.topic,signal);
  const available=cursor.feeds.filter(feed=>!cursor.feedPositions[feed]?.done);
  const feed=available.length?available[(cursor.round-1)%available.length]:undefined;if(!feed)return [];
  const position=cursor.feedPositions[feed]??={cursor:null,done:false};
  const page=await fetchBlueskyTopicFeed({topic:cursor.topic,feed,cursor:position.cursor,limit:12,signal});
  position.done=!page.cursor||page.cursor===position.cursor;position.cursor=page.cursor??null;
  return page.posts.map(normalizeTimelineBlueskyPost);
 })());
 const results=await Promise.allSettled(jobs);if(signal?.aborted)throw signal.reason;
 const succeeded=results.filter((result):result is PromiseFulfilledResult<PostWithAuthor[]>=>result.status==='fulfilled');
 const failed=results.find((result):result is PromiseRejectedResult=>result.status==='rejected');
 if(failed&&!succeeded.some(result=>result.value.length))throw failed.reason;
 const posts=rankTopicPosts(applyCachedRecommendationVisuals(succeeded.flatMap(result=>result.value)).filter(post=>!cursor.seen.includes(recommendationIdentity(post))&&!(recommendationFingerprint(post)&&cursor.seen.includes(recommendationFingerprint(post)!))),cursor.topic,preferences,cursor.now);
 cursor.seen.push(...posts.flatMap(post=>[recommendationIdentity(post),...(recommendationFingerprint(post)?[recommendationFingerprint(post)!]:[])]));
 cursor.empty=posts.length?0:cursor.empty+1;
 const more=cursor.feeds===undefined||cursor.feeds.some(feed=>!cursor.feedPositions[feed]?.done)||cursor.positions.some(position=>!position.nativeDone||!position.blueDone||!position.misskeyDone||!position.twitterDone);
 return {posts,preferences,next:more?cursor:undefined,automaticPaused:cursor.empty>=4,pendingAnalysis:false};
}

async function getTopicPage(previous:TopicCursor,viewer:string|null,signal?:AbortSignal) {
 const controller=new AbortController();
 const abort=()=>controller.abort(signal?.reason);
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>controller.abort(new DOMException('Topic read timed out','TimeoutError')),8000);
 try{return await loadTopicPage(previous,viewer,controller.signal);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

// trends
async function getTrendRanking(): Promise<ExploreTrend[]> {
  const { data, error } = await supabase.functions.invoke('get-trends', {
    method: 'POST', body: { explore: true },
  });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('トレンドの取得に失敗しました');
  const seen = new Set<string>();
  return data.filter((item): item is ExploreTrend => {
    if (typeof item?.title !== 'string' || typeof item?.traffic !== 'string' || seen.has(item.title)) return false;
    seen.add(item.title);
    return true;
  }).sort((a, b) => trendSearchVolume(b.traffic) - trendSearchVolume(a.traffic))
    .map((item, index) => ({...item, rank: index + 1}));
}

export { getTopicPreferences };
export { updateTopicPreferences };
export { topicsKey };
export { rankingFeatures };
export { learnedRecommendationScores };
export { recordLearnedRecommendation };
export { recordLearnedAction };
export { getRecommendationContinuation };
export { createTopicCursor };
export { getTopicPage };
export type { TopicCursor };
export { getTrendRanking };


// watchHistory
export {ANIME_SOURCES,animeHttps,animeArtworkUrl,parseAnimeImport,importWorkTitle,normalizeAnimeTitle,fetchAnimeArtwork,fetchAnimeYouTubeId,animeYouTubeUrl} from "../../supabase/functions/_shared/animeHistory";
export type {AnimeHistoryEntry,AnimeHistoryState,AnimeImportItem,AnimeWork,AnimeEpisode} from "../../supabase/functions/_shared/animeHistory";
export type AnimeImportResolution={item:AnimeImportItem;work:AnimeWork|null;episode:AnimeEpisode|null;candidates:AnimeWork[];ambiguous:boolean};
export const animeHistoryKey=(owner:string)=>['anime-history',owner] as const;
export const ANIME_HISTORY_CHANGED='lime-anime-history-changed';
async function request<T>(owner:string,path:string,body:unknown,signal?:AbortSignal):Promise<T>{
 const {data:{session}}=await supabase.auth.getSession();
 if(!session||session.user.id!==owner)throw new Error('視聴履歴の更新には本人のログインが必要です');
 const response=await fetch(path==='functions/v1/anime-history'&&import.meta.env.DEV?`${import.meta.env.BASE_URL}__lime-anime-history`:`${import.meta.env.VITE_SUPABASE_URL}/${path}`,{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,apikey:import.meta.env.VITE_SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify(body),signal});
 const data=await response.json().catch(()=>null);
 if(!response.ok){if(['PGRST202','42883'].includes(data?.code))throw new Error('');throw new Error(data?.error||data?.message||'視聴履歴を読み込めませんでした');}
 return data as T;
}
const edge=<T>(owner:string,body:unknown,signal?:AbortSignal)=>request<T>(owner,'functions/v1/anime-history',body,signal);
export async function getAnimeHistory(username:string,signal?:AbortSignal):Promise<AnimeHistoryState>{
 const anon=import.meta.env.VITE_SUPABASE_ANON_KEY;
 const {data:{session}}=await supabase.auth.getSession();
 const response=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/get_anime_history`,{method:'POST',headers:{apikey:anon,Authorization:`Bearer ${session?.access_token??anon}`,'Content-Type':'application/json'},body:JSON.stringify({target_username:username}),signal});
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw new Error(['PGRST202','42883'].includes(data?.code)?'':data?.message||'視聴履歴を読み込めませんでした');
 return data??EMPTY_ANIME_HISTORY;
}
export async function changeAnimeHistory(owner:string,operation:'delete'|'delete_work'|'auto',options:{record_id?:string;enabled?:boolean}):Promise<AnimeHistoryState>{return request(owner,'rest/v1/rpc/update_anime_history',{operation,...options});}
export const searchAnimeWorks=(owner:string,query:string,signal?:AbortSignal)=>edge<{works:AnimeWork[]}>(owner,{op:'search',query},signal);
export const getAnimeEpisodes=(owner:string,workId:number,page:number,signal?:AbortSignal)=>edge<{episodes:AnimeEpisode[];nextPage:number|null}>(owner,{op:'episodes',workId,page},signal);
export const saveAnimeViewing=(owner:string,workId:number,episodeId:number|null,watchedAt:string|null,importItem?:AnimeImportItem)=>edge<{state:AnimeHistoryState}>(owner,{op:'save',workId,episodeId,watchedAt,...(importItem?{importItem}:{})});
export const resolveAnimeImport=(owner:string,items:AnimeImportItem[],signal?:AbortSignal)=>edge<{rows:AnimeImportResolution[]}>(owner,{op:'resolve',items},signal);
export const saveAnimeImport=(owner:string,rows:AnimeImportResolution[])=>edge<{state:AnimeHistoryState}>(owner,{op:'import',items:rows.map(row=>({workId:row.work!.id,episodeId:row.episode?.id??null,item:row.item}))});
export const scanAnimePosts=(owner:string,before?:string,signal?:AbortSignal)=>edge<{state:AnimeHistoryState;scanned:number;nextBefore:string|null}>(owner,{op:'scan',before},signal);
/** Post success must not depend on catalog availability. Catch-up is available on the history page. */
export async function recordAnimePost(owner:string,postId:string):Promise<void>{
 try{const result=await edge<{state:AnimeHistoryState}>(owner,{op:'detect',postId});window.dispatchEvent(new CustomEvent(ANIME_HISTORY_CHANGED,{detail:{owner,state:result.state}}));}
 catch{/* The history page reports catalog/configuration errors and can retry without republishing the post. */}
}
export function groupAnimeHistory(entries:import("../../supabase/functions/_shared/animeHistory").AnimeHistoryEntry[]){
 const groups=new Map<number,{work:AnimeWork;entries:import("../../supabase/functions/_shared/animeHistory").AnimeHistoryEntry[]}>();
 for(const entry of entries){const group=groups.get(entry.work.id);if(group)group.entries.push(entry);else groups.set(entry.work.id,{work:entry.work,entries:[entry]});}
 return [...groups.values()];
}
