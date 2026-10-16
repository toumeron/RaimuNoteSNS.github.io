import {searchXPage} from '@/lib/fxTwitter';
import {TOPICS,type TopicPreferences} from '@/lib/topics';
import {isTimelinePost,normalizeTimelineBlueskyPost} from '@/lib/timelinePaging';
import type {PostWithAuthor} from '@/types';

export const TREND_MIN_LIKES=1000;
type Position={query:string;cursor:string|null;done:boolean};
export type TwitterTrendCursor={round:number;positions:Position[];seen:string[];fallbackPositions?:Position[];fallbackRound?:number;remaining?:PostWithAuthor[]};
function shuffle<T>(rows:T[]):T[]{
 const result=[...rows];for(let i=result.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;
}
export function createTwitterTrendCursor(preferences:TopicPreferences):TwitterTrendCursor{
 const available=TOPICS.filter(topic=>!preferences.dismissed.includes(topic.id));
 const position=(topic:typeof TOPICS[number]):Position=>({query:`(${topic.queries.join(' ')})`,cursor:null,done:false});
 return {round:0,positions:available.filter(topic=>preferences.followed.includes(topic.id)).map(position),
  fallbackPositions:shuffle(available.filter(topic=>!preferences.followed.includes(topic.id)).map(position)),fallbackRound:0,remaining:[],seen:[]};
}
/** Use topic searches in popular order and verify actual likes locally. When
 * topic candidates run short, rotate independent popular-topic searches.
 * No recommendation scores, interest inference or image model are involved. */
export async function getTwitterTrendPage(previous:TwitterTrendCursor,signal?:AbortSignal):Promise<{posts:PostWithAuthor[];next?:TwitterTrendCursor}>{
 if(signal?.aborted)throw signal.reason;
 const state:TwitterTrendCursor={...previous,positions:previous.positions.map(position=>({...position})),fallbackPositions:(previous.fallbackPositions??[]).map(position=>({...position})),remaining:[...(previous.remaining??[])],seen:[...previous.seen]};
 const controller=new AbortController(),abort=()=>controller.abort(signal?.reason??new DOMException('Aborted','AbortError'));
 signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>controller.abort(new DOMException('Trend fetch deadline','TimeoutError')),8000);
 const cancelled=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true}));
 const seen=new Set(state.seen),candidateIds=new Set<string>();
 const eligible=(post:PostWithAuthor)=>post.source==='x'&&Number.isFinite(post.likesCount)&&post.likesCount>=TREND_MIN_LIKES&&!post.externalRepostedBy&&!post.profileRepostedBy&&isTimelinePost(post)&&!seen.has(post.id);
 const unique=(rows:PostWithAuthor[])=>rows.filter(post=>{if(!eligible(post)||candidateIds.has(post.id))return false;candidateIds.add(post.id);return true;});
 const byLikes=(a:PostWithAuthor,b:PostWithAuthor)=>b.likesCount-a.likesCount||Date.parse(b.createdAt)-Date.parse(a.createdAt);
 let successfulReads=0,lastError:unknown;
 const read=async(fallback:boolean)=>{
  const positions=fallback?state.fallbackPositions!:state.positions,active=positions.filter(position=>!position.done),round=fallback?state.fallbackRound??0:state.round;
  const selected=Array.from({length:Math.min(3,active.length)},(_,i)=>active[(round+i)%active.length]);
  if(fallback)state.fallbackRound=round+selected.length;else state.round+=selected.length;
  const results=await Promise.race([Promise.allSettled(selected.map(async position=>{
   const page=await searchXPage(position.query,{cursor:position.cursor,feed:'top',preferAlternative:true,limit:20,signal:controller.signal});
   position.done=!page.cursor||page.cursor===position.cursor;position.cursor=page.cursor;
   return page.posts.map(normalizeTimelineBlueskyPost);
  })),cancelled]);
  if(signal?.aborted)throw signal.reason;
  results.forEach((result,index)=>{if(result.status==='rejected'){selected[index].done=true;lastError=result.reason;}else successfulReads++;});
  return unique(results.flatMap(result=>result.status==='fulfilled'?result.value:[])).sort(byLikes);
 };
 try{
  const posts=unique(state.remaining!);state.remaining=[];
  if(posts.length<20)posts.push(...await read(false));
  // A sparse topic page must not produce an empty screen while other public
  // popular sources have candidates. Sample from the highest-like candidates.
  if(posts.length<20){
   const popular=await read(true),space=20-posts.length;
   posts.push(...shuffle(popular.slice(0,space)),...popular.slice(space));
  }
  if(!posts.length&&!successfulReads&&lastError)throw lastError;
  state.remaining=posts.slice(20);
  const delivered=posts.slice(0,20);delivered.forEach(post=>seen.add(post.id));state.seen=[...seen].slice(-10000);
  return {posts:delivered,next:state.remaining.length||[...state.positions,...state.fallbackPositions!].some(position=>!position.done)?state:undefined};
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
}
