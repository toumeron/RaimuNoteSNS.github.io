import {supabase} from '@/lib/supabase';
import {searchXPage,xFeed} from '@/lib/fxTwitter';
import {TOPICS} from '@/lib/topics';
import {normalizeTimelineBlueskyPost} from '@/lib/timelinePaging';
import {recommendationMatchesFollowedTopics} from '@/lib/recommendationSignals';
import {recommendationIsDismissed} from '@/lib/recommendations';
import {getRecommendationPreferences} from './recommendations';
import type {PostWithAuthor} from '@/types';
type Position={cursor:string|null;done:boolean};
export type TwitterVideoCursor={authors:Record<string,Position>;topics:Record<string,Position>;round:number;preferences:Awaited<ReturnType<typeof getRecommendationPreferences>>};
/** Read metadata only; the lightbox downloads media for the active slide. */
export async function getTwitterVideoPage(viewerId:string,previous?:TwitterVideoCursor,signal?:AbortSignal):Promise<{posts:PostWithAuthor[];nextCursor:TwitterVideoCursor|null}>{
 let cursor:TwitterVideoCursor;
 if(previous)cursor={...previous,authors:structuredClone(previous.authors),topics:structuredClone(previous.topics)};
 else{
  const [preferences,follows]=await Promise.all([getRecommendationPreferences(viewerId,()=>{},signal),supabase.from('follows').select('external_profile,external_handle').eq('follower_id',viewerId).eq('approved',true).eq('external_provider','x').abortSignal(signal!)]);
  if(follows.error)throw follows.error;
  const actors=(follows.data??[]).flatMap(row=>row.external_profile?.id?[row.external_profile.id]:row.external_handle?[`${row.external_handle.replace(/@(?:twitter|x)\.com$/i,'')}@twitter.com`]:[]);
  const terms=(preferences.followedTopics??[]).filter(topic=>!preferences.dismissedTopics?.includes(topic)).flatMap(topic=>TOPICS.find(row=>row.id===topic)?.queries.slice(0,1)??[]);
  cursor={authors:Object.fromEntries([...new Set(actors)].map(actor=>[actor,{cursor:null,done:false}])),topics:Object.fromEntries([...new Set(terms)].map(term=>[term,{cursor:null,done:false}])),round:0,preferences};
 }
 const jobs:Promise<PostWithAuthor[]>[]=[];
 const choose=(positions:Record<string,Position>)=>{const entries=Object.entries(positions).filter(([,position])=>!position.done);return entries.length?entries[cursor.round%entries.length]:undefined;};
 const author=choose(cursor.authors),topic=choose(cursor.topics);cursor.round++;
 if(author)jobs.push((async()=>{const [actor,state]=author,page=await xFeed({actor,cursor:state.cursor,filter:'posts_with_media',limit:8,signal});state.done=!page.cursor||page.cursor===state.cursor;state.cursor=page.cursor;return page.posts.map(normalizeTimelineBlueskyPost);})());
 if(topic)jobs.push((async()=>{const [term,state]=topic,page=await searchXPage(`${term} filter:videos`,{cursor:state.cursor,feed:'media',preferAlternative:true,limit:2,signal});state.done=!page.cursor||page.cursor===state.cursor;state.cursor=page.cursor;return page.posts.map(normalizeTimelineBlueskyPost).filter(post=>recommendationMatchesFollowedTopics(post,cursor.preferences.followedTopics??[]));})());
 const results=await Promise.allSettled(jobs);if(signal?.aborted)throw signal.reason;
 if(results.length&&results.every(result=>result.status==='rejected'))throw (results[0] as PromiseRejectedResult).reason;
 const posts=[...new Map(results.flatMap(result=>result.status==='fulfilled'?result.value:[]).filter(post=>post.externalVideo&&!recommendationIsDismissed(post,cursor.preferences)).map(post=>[post.id,post])).values()];
 return {posts,nextCursor:[...Object.values(cursor.authors),...Object.values(cursor.topics)].some(state=>!state.done)?cursor:null};
}
