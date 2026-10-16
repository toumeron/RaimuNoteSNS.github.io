import {supabase} from '@/lib/supabase';
import {searchXPage,xFeed} from '@/lib/fxTwitter';
import {TOPICS} from '@/lib/topics';
import {normalizeTimelineBlueskyPost} from '@/lib/timelinePaging';
import {recommendationMatchesFollowedTopics} from '@/lib/recommendationSignals';
import {recommendationIsDismissed} from '@/lib/recommendations';
import {getRecommendationPreferences} from './recommendations';
import type {PostWithAuthor} from '@/types';
type Position={cursor:string|null;done:boolean};
export type TwitterVideoCursor={authors:Record<string,Position>;topics:Record<string,Position>;round:number;popular?:Position;seen?:string[];preferences:Awaited<ReturnType<typeof getRecommendationPreferences>>};
/** Read metadata only; the lightbox downloads media for the active slide. */
export async function getTwitterVideoPage(viewerId:string,previous?:TwitterVideoCursor,signal?:AbortSignal):Promise<{posts:PostWithAuthor[];nextCursor:TwitterVideoCursor|null}>{
 let cursor:TwitterVideoCursor;
 if(previous)cursor={...previous,authors:structuredClone(previous.authors),topics:structuredClone(previous.topics),popular:{...(previous.popular??{cursor:null,done:false})},seen:[...(previous.seen??[])]};
 else{
  const [preferences,follows]=await Promise.all([getRecommendationPreferences(viewerId,()=>{},signal).catch(error=>{if(signal?.aborted)throw error;return {authors:{},terms:{}} as Awaited<ReturnType<typeof getRecommendationPreferences>>;}),supabase.from('follows').select('external_profile,external_handle').eq('follower_id',viewerId).eq('approved',true).in('external_provider',['x','twitter']).abortSignal(signal!)]);
  if(follows.error)throw follows.error;
  const actorFor=(id:string,handle?:string)=>handle?`${handle.replace(/^@/,'').replace(/@(?:twitter|x)\.com$/i,'')}@twitter.com`:id;
  const actors=(follows.data??[]).flatMap(row=>{
   const id=row.external_profile?.id,handle=row.external_handle||row.external_profile?.username||preferences.authorHandles?.[id];
   return handle||id?[actorFor(id,handle)]:[];
  });
  actors.push(...Object.entries(preferences.authors).filter(([id,weight])=>weight>0&&(id.startsWith('x-user:')||/@(?:twitter|x)\.com$/i.test(id))).map(([id])=>actorFor(id,preferences.authorHandles?.[id])));
  const terms=(preferences.followedTopics??[]).filter(topic=>!preferences.dismissedTopics?.includes(topic)).flatMap(topic=>TOPICS.find(row=>row.id===topic)?.queries.slice(0,1)??[]);
  cursor={authors:Object.fromEntries([...new Set(actors)].map(actor=>[actor,{cursor:null,done:false}])),topics:Object.fromEntries([...new Set(terms)].map(term=>[term,{cursor:null,done:false}])),round:0,popular:{cursor:null,done:false},seen:[],preferences};
 }
 const jobs:Promise<PostWithAuthor[]>[]=[];
 const choose=(positions:Record<string,Position>)=>{const entries=Object.entries(positions).filter(([,position])=>!position.done);return entries.length?entries[cursor.round%entries.length]:undefined;};
 const active=Object.entries(cursor.authors).filter(([,state])=>!state.done);
 const authors=Array.from({length:Math.min(2,active.length)},(_,i)=>active[(cursor.round+i)%active.length]);
 const topic=choose(cursor.topics);cursor.round+=Math.max(1,authors.length);
 for(const author of authors)jobs.push((async()=>{const [actor,state]=author,page=await xFeed({actor,cursor:state.cursor,filter:'posts_with_media',limit:20,signal});state.done=!page.cursor||page.cursor===state.cursor;state.cursor=page.cursor;return page.posts.map(normalizeTimelineBlueskyPost);})());
 if(topic)jobs.push((async()=>{const [term,state]=topic,page=await searchXPage(`${term} filter:videos`,{cursor:state.cursor,feed:'media',preferAlternative:true,limit:2,signal});state.done=!page.cursor||page.cursor===state.cursor;state.cursor=page.cursor;return page.posts.map(normalizeTimelineBlueskyPost).filter(post=>recommendationMatchesFollowedTopics(post,cursor.preferences.followedTopics??[]));})());
 const results=await Promise.allSettled(jobs);if(signal?.aborted)throw signal.reason;
 const seen=new Set(cursor.seen??[]);
 let posts=[...new Map(results.flatMap(result=>result.status==='fulfilled'?result.value:[]).filter(post=>post.externalVideo&&!seen.has(post.id)&&!recommendationIsDismissed(post,cursor.preferences)).map(post=>[post.id,post])).values()];
 if(!posts.length&&!cursor.popular?.done){
  const state=cursor.popular??{cursor:null,done:false};cursor.popular=state;
  const page=await searchXPage('filter:videos',{cursor:state.cursor,feed:'top',preferAlternative:true,limit:6,signal});
  if(signal?.aborted)throw signal.reason;
  state.done=!page.cursor||page.cursor===state.cursor;state.cursor=page.cursor;
  posts=[...new Map(page.posts.map(normalizeTimelineBlueskyPost).filter(post=>post.externalVideo&&!seen.has(post.id)&&!recommendationIsDismissed(post,cursor.preferences)).map(post=>[post.id,post])).values()];
 }
 if(!posts.length&&results.length&&results.every(result=>result.status==='rejected'))throw (results[0] as PromiseRejectedResult).reason;
 cursor.seen=[...seen,...posts.map(post=>post.id)];
 return {posts,nextCursor:[...Object.values(cursor.authors),...Object.values(cursor.topics),cursor.popular??{cursor:null,done:false}].some(state=>!state.done)?cursor:null};
}
