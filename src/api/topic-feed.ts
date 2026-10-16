import {searchXPage} from '@/lib/fxTwitter';
import {TOPICS,type TopicId} from '@/lib/topics';
import {searchPosts} from './posts';
import {fetchBlueskyTopicPosts,discoverBlueskyTopicFeeds,fetchBlueskyTopicFeed} from '@/lib/bluesky';
import {fetchMisskeyTopicPosts} from '@/lib/misskey';
import {normalizeTimelineBlueskyPost} from '@/lib/timelinePaging';
import {applyCachedRecommendationVisuals} from '@/lib/recommendationVisual';
import {rankTopicPosts} from '@/lib/topicRecommendations';
import {recommendationIdentity,recommendationFingerprint} from "@/lib/recommendationSignals";
import {getRecommendationPreferences} from './recommendations';
import type {RecommendationPreferences} from '@/lib/recommendations';
import type {PostWithAuthor} from '@/types';
type Position={native:number;nativeDone:boolean;blue:string|null;blueDone:boolean;misskey:string|null;misskeyDone:boolean;twitter?:string|null;twitterDone?:boolean};
export type TopicCursor={topic:TopicId;round:number;now:number;positions:Position[];seen:string[];preferences?:RecommendationPreferences;empty:number;feeds?:string[];feedPositions?:Record<string,{cursor:string|null;done:boolean}>};
export function createTopicCursor(topic:TopicId):TopicCursor {return {topic,round:0,now:Date.now(),positions:TOPICS.find(t=>t.id===topic)!.queries.map(()=>({native:0,nativeDone:false,blue:null,blueDone:false,misskey:null,misskeyDone:false,twitter:null,twitterDone:false})),seen:[],empty:0};}
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

export async function getTopicPage(previous:TopicCursor,viewer:string|null,signal?:AbortSignal) {
 const controller=new AbortController();
 const abort=()=>controller.abort(signal?.reason);
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>controller.abort(new DOMException('Topic read timed out','TimeoutError')),8000);
 try{return await loadTopicPage(previous,viewer,controller.signal);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
