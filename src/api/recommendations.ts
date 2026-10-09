import { supabase } from '@/lib/supabase';
import { getFeed, getPostsByUser, searchPosts } from './posts';
import {discoverBlueskyTopicFeeds,fetchBlueskyTopicFeed,fetchBlueskyAuthorFeed, fetchBlueskyLikedPosts,fetchBlueskyTopicPosts, fetchTrendingJapaneseBlueskyPosts } from '@/lib/bluesky';
import {recommendationOriginLanguages,topicAuthorCandidates} from '@/lib/recommendationSignals';
import {recommendationIdentity,recommendationFingerprint} from '@/lib/recommendationIdentity';
import {recommendationIsEligible} from '@/lib/recommendationEligibility';
import {isDeclaredGeneratedArt} from '@/lib/artRecommendations';
import {applyCachedRecommendationVisuals,visualSimilarity} from '@/lib/recommendationVisual';
import type {TopicId} from '@/lib/topics';
import { normalizeTimelineBlueskyPost } from '@/lib/timelinePaging';
import { addRecommendationInterest, rejectedRecommendationTopics,isRecommendationAuthorRejected,rankRecommendations, recommendationQueries, readRecommendationLikes,selectRecommendationLikeSamples,readRecommendationImpressions,recommendationIsDismissed,selectRecommendationPage, type RecommendationPreferences } from '@/lib/recommendations';
import type { PostWithAuthor } from '@/types';
import type { FeedCursor } from './posts';
import {getTopicPreferences} from './topics';
import {fetchMisskeyTopicPosts} from '@/lib/misskey';

// Read additional saved likes only during history hydration, never on the
// critical first-page path. Joined payloads are retained only while building
// the compact preference profile, not in timeline pages.
export async function readRecommendationLikeHistory(viewerId:string,extended:boolean,signal?:AbortSignal) {
  const rows:any[]=[];
  const pageSize=200,max=extended?1000:200;
  for(let offset=0;offset<max;offset+=pageSize){
    if(signal?.aborted)throw signal.reason;
    const request=supabase.from('likes').select('created_at,post_snapshot,posts:post_id(id,user_id,content,image_urls,created_at)').eq('user_id',viewerId).order('created_at',{ascending:false}).order('like_key',{ascending:true}).range(offset,offset+pageSize-1);
    const result=await (signal?request.abortSignal(signal):request);
    if(result.error){if(!rows.length)return result;break;}
    const page=result.data??[];rows.push(...page);
    if(page.length<pageSize)break;
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  return {data:rows,error:null};
}

export async function getRecommendationPreferences(viewerId:string|null,onTopics?:(preferences:RecommendationPreferences)=>void,signal?:AbortSignal):Promise<RecommendationPreferences> {
 const controller=new AbortController();
 const abort=()=>controller.abort(signal?.reason??new DOMException('Aborted','AbortError'));
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>controller.abort(new DOMException('Preference read timed out','TimeoutError')),5000);
 const cancelled=new Promise<never>((_,reject)=>{if(controller.signal.aborted)reject(controller.signal.reason);else controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true});});
 try{return await Promise.race([loadRecommendationPreferences(viewerId,onTopics,controller.signal),cancelled]);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
}
async function loadRecommendationPreferences(viewerId:string|null,onTopics:((preferences:RecommendationPreferences)=>void)|undefined,signal:AbortSignal):Promise<RecommendationPreferences> {
  const preferences:RecommendationPreferences={authors:{},terms:{},followedAuthors:[],likedPostIds:[]};
  const learnedLikes=new Set<string>();
  if(viewerId) {
    // Topic follows are explicit intent; publish them before optional history.
    const topicRead=getTopicPreferences(viewerId,signal).then(topics=>{preferences.followedTopics=topics.followed;preferences.dismissedTopics=topics.dismissed;preferences.feedback=topics.recommendationFeedback;onTopics?.(preferences);});
    const partial:PromiseSettledResult<any>[]=[];
    const historyJobs=[
      supabase.from('follows').select('followee_id,external_profile,external_provider,external_handle').eq('follower_id',viewerId).abortSignal(signal),
      readRecommendationLikeHistory(viewerId,!onTopics,signal),
      !onTopics?supabase.from('reposts').select('created_at,posts:post_id(id,user_id,content,image_urls,created_at)').eq('user_id',viewerId).order('created_at',{ascending:false}).limit(100).abortSignal(signal):Promise.resolve({data:[],error:null}),
      !onTopics?supabase.from('external_reposts').select('created_at,post_snapshot').eq('user_id',viewerId).order('created_at',{ascending:false}).limit(100).abortSignal(signal):Promise.resolve({data:[],error:null}),
      !onTopics?supabase.from('comments').select('created_at,content,post:post_id(user_id,content)').eq('user_id',viewerId).order('created_at',{ascending:false}).limit(50).abortSignal(signal):Promise.resolve({data:[],error:null}),
      !onTopics?fetchBlueskyLikedPosts(signal).then(posts=>({data:posts.map(post=>({post_snapshot:normalizeTimelineBlueskyPost(post)})),error:null})):Promise.resolve({data:[],error:null}),
    ];
    const historyRead=Promise.allSettled(historyJobs.map((job,index)=>Promise.resolve(job).then(value=>{partial[index]={status:'fulfilled',value};return value;},reason=>{partial[index]={status:'rejected',reason};throw reason;})));
    await topicRead;
    let historyTimer:ReturnType<typeof setTimeout>|undefined;
    const results=onTopics?await Promise.race([historyRead,new Promise<PromiseSettledResult<any>[]>(resolve=>{historyTimer=setTimeout(()=>resolve([...partial]),900);})]):await historyRead;
    if(historyTimer)clearTimeout(historyTimer);
    for(const [index,result] of results.entries()){
      if(!result||result.status!=='fulfilled' || result.value.error) continue;
      let processed=0;
      for(const row of result.value.data ?? []) {
        if(++processed%50===0){await new Promise(resolve=>setTimeout(resolve,0));if(signal.aborted)throw signal.reason;}
        if ('followee_id' in row && row.followee_id) { preferences.followedAuthors!.push(row.followee_id); preferences.authors[row.followee_id]=(preferences.authors[row.followee_id] ?? 0)+3; }
        else if(row.external_provider){const actor=row.external_profile?.id;if(actor){const id=actor.replace(/^bsky:/,'');preferences.followedAuthors!.push(id);preferences.authors[id]=(preferences.authors[id]??0)+3;}}
        else if ('post' in row) {
          const source=Array.isArray(row.post)?row.post[0]:row.post;
          if(source) addRecommendationInterest(preferences,source,1.5,row.created_at);
          addRecommendationInterest(preferences,{content:row.content},.5,row.created_at);
        } else {
          const interest = row.post_snapshot??('posts' in row ? (Array.isArray(row.posts) ? row.posts[0] : row.posts) : undefined);
          if((index===1||index===5) && interest?.id){
            const identity=recommendationIdentity(interest);if(learnedLikes.has(identity))continue;learnedLikes.add(identity);
            preferences.likedPostIds!.push(interest.id);
            if(interest.image_urls?.length||interest.imageUrls?.length){preferences.likedSamples??=[];preferences.likedSamples.push(index===5||row.post_snapshot?{...interest,engagedAt:row.created_at}:{id:interest.id,userId:interest.user_id,content:interest.content??'',likesCount:0,commentsCount:0,repostsCount:0,likedByMe:true,repostedByMe:false,imageUrls:interest.image_urls,createdAt:interest.created_at,engagedAt:row.created_at,author:{id:interest.user_id,username:''}} as PostWithAuthor&{engagedAt?:string});}
          }
          if (interest) addRecommendationInterest(preferences, interest, (index===1||index===5)?2:4, row.created_at);
        }
      }
    }

  }
  const likes=readRecommendationLikes(viewerId);
  preferences.likedSamples=selectRecommendationLikeSamples(applyCachedRecommendationVisuals([...likes.filter(post=>post.imageUrls?.length),...(preferences.likedSamples??[])]));
  for(const post of preferences.likedSamples)if(post.recommendationVisual&&!preferences.visualInterests?.some(vector=>visualSimilarity(vector,post.recommendationVisual!.vector)>.999)){preferences.visualInterests??=[];preferences.visualInterests.push(post.recommendationVisual.vector);}
  for(const post of likes)if(!learnedLikes.has(recommendationIdentity(post)))addRecommendationInterest(preferences,post,2,post.engagedAt ?? new Date(Date.now()-30*86400000).toISOString());
  return preferences;
}
export type RecommendationCursor={
  pageKey?:number;
  lime:{page:number;before?:FeedCursor;done:boolean};
  trending:{cursor:string|null;done:boolean};
  authors:Record<string,{cursor:string|null;done:boolean;media?:boolean}>;
  topics:Record<string,{limePage:number;limeDone:boolean;blueCursor:string|null;blueDone:boolean;misskeyCursor?:string|null;misskeyDone?:boolean}>;
  nativeAuthors:Record<string,{page:number;done:boolean}>;
  topicDiscovery?:Partial<Record<TopicId,{feedRound?:number;feeds:string[]|null;positions:Record<string,{cursor:string|null;done:boolean}>;done:boolean}>>;
  discoveryRound?:number;
  authorRound?:number;
  needsCreators?:boolean;
  stalledPages?:number;
  topicAuthors?:Record<string,TopicId[]>;
  topicAuthorLanguages?:Record<string,string[]>;
  history:PostWithAuthor[];
  pendingVisual?:PostWithAuthor[];
  remaining:PostWithAuthor[];seen:string[];preferences?:RecommendationPreferences;
};
export function createRecommendationCursor(handles:string[]):RecommendationCursor {
  return {lime:{page:0,done:false},trending:{cursor:null,done:false},authors:Object.fromEntries(handles.slice(0,4).map(actor=>[actor,{cursor:null,done:false}])),topics:{},nativeAuthors:{},history:[],remaining:[],seen:[]};
}
const RECOMMENDATION_SOURCE_SIZE=8;
const RECOMMENDATION_PAGE_SIZE=8;
async function loadRecommendationPage(previous:RecommendationCursor,viewerId:string|null,signal?:AbortSignal,publish?:(cursor:RecommendationCursor)=>void,ready?:(cursor:RecommendationCursor)=>void) {
  const cursor=copyRecommendationCursor(previous);
  publish?.(cursor);
  const preferences=cursor.preferences ?? await getRecommendationPreferences(viewerId,early=>{cursor.preferences={...early};},signal);
  cursor.topicDiscovery=Object.fromEntries(Object.entries(previous.topicDiscovery??{}).map(([id,state])=>[id,{...state,feeds:state.feeds?[...state.feeds]:null,positions:Object.fromEntries(Object.entries(state.positions).map(([feed,pos])=>[feed,{...pos}]))}]));
  cursor.topicAuthors={...(previous.topicAuthors??{})};
  cursor.topicAuthorLanguages={...(previous.topicAuthorLanguages??{})};
  cursor.preferences=preferences;
  const favoriteBlueskyAuthors = Object.entries(preferences.authors)
    .filter(([id,weight]) => weight>0&&(id.startsWith('did:') || id.startsWith('misskey-user:'))&&!isRecommendationAuthorRejected(id,preferences))
    .sort((a,b) => b[1]-a[1]).slice(0,12);
  for (const [actor] of favoriteBlueskyAuthors) {
    if (!cursor.authors[actor]) cursor.authors[actor]={cursor:null,done:false};
  }
  for (const term of recommendationQueries(preferences)) {
    if (!cursor.topics[term]) cursor.topics[term]={limePage:0,limeDone:false,blueCursor:null,blueDone:false,misskeyCursor:null,misskeyDone:false};
  }
  const favoriteNativeAuthors=Object.entries(preferences.authors).filter(([id])=>/^[0-9a-f-]{36}$/i.test(id) && id!==viewerId).sort((a,b)=>b[1]-a[1]).slice(0,2);
  for (const [author] of favoriteNativeAuthors) if(!cursor.nativeAuthors[author]) cursor.nativeAuthors[author]={page:0,done:false};
  if(cursor.remaining.length<RECOMMENDATION_PAGE_SIZE||cursor.needsCreators) {
    cursor.needsCreators=false;
    const jobs:{priority?:number;load:()=>Promise<PostWithAuthor[]>}[]=[];
    if(!cursor.lime.done) jobs.push({priority:1,load:async()=>{
      const rows=await getFeed(cursor.lime.page,RECOMMENDATION_SOURCE_SIZE,cursor.lime.before,signal);
      cursor.lime.page++;cursor.lime.done=rows.length<RECOMMENDATION_SOURCE_SIZE;
      const last=rows[rows.length-1];if(last) cursor.lime.before={createdAt:last.createdAt,id:last.id};
      return rows;
    }});
    if(preferences.followedTopics?.length)cursor.trending.done=true;
    if(!cursor.trending.done) jobs.push({load:async()=>{
      const page=await fetchTrendingJapaneseBlueskyPosts({cursor:cursor.trending.cursor,limit:RECOMMENDATION_SOURCE_SIZE,queryLimit:1,signal});
      cursor.trending.done=!page.cursor || page.cursor===cursor.trending.cursor;cursor.trending.cursor=page.cursor ?? null;
      return page.posts.map(normalizeTimelineBlueskyPost);
    }});
    // Keep high-interest authors, but leave fetch slots for topic feeds that
    // can contribute related creators within the same first-page deadline.
    for(const [actor,state] of Object.entries(cursor.authors))if(isRecommendationAuthorRejected(actor,preferences))state.done=true;
    const authorSlots=Object.entries(cursor.authors);
    const authorRound=cursor.authorRound??0;
    const selectedAuthors:typeof authorSlots=[];
    let scannedAuthors=0;
    while(selectedAuthors.length<3&&scannedAuthors<authorSlots.length){
      const entry=authorSlots[(authorRound+scannedAuthors++)%authorSlots.length];
      if(!entry[1].done)selectedAuthors.push(entry);
    }
    cursor.authorRound=authorRound+scannedAuthors;
    for(const [actor,state] of selectedAuthors) {
      jobs.push({priority:3,load:async()=>{
        const page=await fetchBlueskyAuthorFeed({actor,cursor:state.cursor,limit:RECOMMENDATION_SOURCE_SIZE,filter:state.media||preferences.followedTopics?.some(topic=>topic==='art'||topic==='digital-illustration')?'posts_with_media':undefined,signal});
        state.done=!page.cursor || page.cursor===state.cursor;state.cursor=page.cursor ?? null;
        return page.posts.map(normalizeTimelineBlueskyPost).map(post=>cursor.topicAuthors![actor]?{...post,recommendationAuthorTopics:cursor.topicAuthors![actor],recommendationLanguages:cursor.topicAuthorLanguages![actor]}:post);
      }});
    }
    const rejectedTopics=new Set(rejectedRecommendationTopics(preferences));
    for(const topic of rejectedTopics){
      const state=cursor.topicDiscovery![topic]??={feeds:[],positions:{},done:true};state.done=true;
    }
    const unfinished=(preferences.followedTopics??[]).filter(topic=>!rejectedTopics.has(topic)&&!cursor.topicDiscovery![topic]?.done);
    const round=cursor.discoveryRound??0;
    const selected=unfinished.length?Array.from({length:Math.min(2,unfinished.length)},(_,index)=>unfinished[(round+index)%unfinished.length]):[];
    cursor.discoveryRound=round+selected.length;
    for(const topic of selected)jobs.push({priority:2,load:async()=>{
      const state=cursor.topicDiscovery![topic]??={feeds:null,positions:{},done:false};
      state.feeds??=await discoverBlueskyTopicFeeds(topic,signal);
      const posts:PostWithAuthor[]=[];let failed:unknown;let successes=0;
      const unfinishedFeeds=state.feeds.filter(feed=>!state.positions[feed]?.done);
      const feedRound=state.feedRound??0;
      const selectedFeeds=unfinishedFeeds.length?[unfinishedFeeds[feedRound%unfinishedFeeds.length]]:[];
      state.feedRound=feedRound+selectedFeeds.length;
      await Promise.all(selectedFeeds.map(async feed=>{
        const position=state.positions[feed]??={cursor:null,done:false};if(position.done)return;
        try{const page=await fetchBlueskyTopicFeed({topic,feed,cursor:position.cursor,limit:RECOMMENDATION_SOURCE_SIZE,signal});
          position.done=!page.cursor||page.cursor===position.cursor;position.cursor=page.cursor;successes++;
          if(!signal?.aborted)cursor.remaining.push(...page.posts.map(normalizeTimelineBlueskyPost));
        }catch(error){if(signal?.aborted)throw error;failed=error;}
      }));
      state.done=state.feeds.every(feed=>state.positions[feed]?.done);
      if(failed&&!successes)throw failed;
      return [];
    }});
    for (const [term,state] of Object.entries(cursor.topics)) {
      // Personalized feeds and creators are stronger evidence than broad text
      // searches, whose public endpoint is rejecting these requests.
      if(preferences.followedTopics?.length&&preferences.followedTopics.every(topic=>rejectedTopics.has(topic))){state.limeDone=true;state.blueDone=true;state.misskeyDone=true;continue;}
      const discoveryPending=(preferences.followedTopics??[]).some(topic=>cursor.topicDiscovery?.[topic]?.feeds==null);
      const hasRelatedSource=Object.values(cursor.topicDiscovery??{}).some(row=>!!row.feeds?.length);
      if(preferences.followedTopics?.length&&hasRelatedSource)state.blueDone=true;
      if(!state.limeDone) jobs.push({load:async()=>{
        const rows=await searchPosts(term,state.limePage,RECOMMENDATION_SOURCE_SIZE,signal);
        state.limePage++;state.limeDone=rows.length<RECOMMENDATION_SOURCE_SIZE;return rows;
      }});
      if(!state.blueDone&&!discoveryPending) jobs.push({load:async()=>{
        const page=await fetchBlueskyTopicPosts({query:term,cursor:state.blueCursor,limit:RECOMMENDATION_SOURCE_SIZE,signal});
        state.blueDone=!page.cursor || page.cursor===state.blueCursor;state.blueCursor=page.cursor ?? null;
        return page.posts.map(normalizeTimelineBlueskyPost);
      }});
      if(!state.misskeyDone) jobs.push({load:async()=>{
        const page=await fetchMisskeyTopicPosts({query:term,cursor:state.misskeyCursor,limit:RECOMMENDATION_SOURCE_SIZE,signal});
        state.misskeyDone=!page.cursor || page.cursor===state.misskeyCursor;state.misskeyCursor=page.cursor;
        return page.posts.map(normalizeTimelineBlueskyPost);
      }});
    }
    for(const [author,state] of Object.entries(cursor.nativeAuthors)) if(!state.done) jobs.push({load:async()=>{
      const rows=await getPostsByUser(author,state.page,RECOMMENDATION_SOURCE_SIZE,signal);state.page++;state.done=rows.length<RECOMMENDATION_SOURCE_SIZE;return rows;
    }});
    const results:PromiseSettledResult<PostWithAuthor[]>[]=new Array(jobs.length);
    jobs.sort((a,b)=>(b.priority??0)-(a.priority??0));
    // Spend the same small budget on initial and subsequent pages. Reserve
    // a slot for another source so familiar creators cannot starve topics.
    const primary=jobs.filter(job=>job.priority===3).slice(0,2);
    const others=jobs.filter(job=>!primary.includes(job)&&job.priority!==3);
    const topics=others.filter(job=>job.priority===2).slice(0,1);
    const batch=[...primary,...topics,...others.filter(job=>job.priority!==2).slice(0,4-primary.length-topics.length)];
    let nextJob=0;
    await Promise.all(Array.from({length:Math.min(4,batch.length)},async()=>{
      while(nextJob<batch.length) {
        if(signal?.aborted)throw signal.reason;
        const index=nextJob++;
        try {const rows=await batch[index].load();if(signal?.aborted)return;results[index]={status:'fulfilled',value:rows};cursor.remaining.push(...rows);if(ready&&cursor.remaining.length)ready(cursor);}
        catch(reason) {results[index]={status:'rejected',reason};}
      }
    }));
    const successful=results.filter(result=>result?.status==='fulfilled');
    const failed=results.find((result):result is PromiseRejectedResult=>result?.status==='rejected');
    if(failed && !cursor.remaining.length && successful.every(result=>result.status==='fulfilled' && !result.value.length)) throw failed.reason;
    // Retain failed source cursors for retry; never discard the other service.
    const consumed=new Set(cursor.seen),views=readRecommendationImpressions(viewerId);
    cursor.remaining=cursor.remaining.filter(post=>!consumed.has(recommendationIdentity(post))&&!views[recommendationIdentity(post)]&&!(recommendationFingerprint(post)&&(consumed.has(recommendationFingerprint(post)!)||views[recommendationFingerprint(post)!])));
    cursor.remaining=applyCachedRecommendationVisuals(cursor.remaining);
    if((preferences.followedTopics?.length??0)>0 && Object.keys(cursor.topicAuthors).length<4){
      const eligible=cursor.remaining.filter(post=>recommendationIsEligible(post,preferences.followedTopics));
      const candidates=(preferences.followedTopics!.includes('art')||preferences.followedTopics!.includes('digital-illustration'))&&!preferences.followedTopics!.includes('ai')?eligible.filter(post=>!isDeclaredGeneratedArt(post)):eligible;
      const creators=topicAuthorCandidates(candidates,preferences.followedTopics!).filter(({actor})=>!cursor.authors[actor]&&!isRecommendationAuthorRejected(actor,preferences));
      for(const {actor,topics} of creators){
        cursor.topicAuthors![actor]=topics;
        cursor.topicAuthorLanguages![actor]=[...new Set(candidates.filter(post=>post.userId===actor).flatMap(recommendationOriginLanguages))];
        cursor.authors[actor]={cursor:null,done:false,media:true};
      }
    }
  }
  if(signal?.aborted) throw new DOMException('Aborted','AbortError');
  return finishRecommendationPage(cursor,preferences,viewerId);
}

function finishRecommendationPage(cursor:RecommendationCursor,preferences:RecommendationPreferences,viewerId:string|null,pageSize=RECOMMENDATION_PAGE_SIZE) {
  cursor.remaining=applyCachedRecommendationVisuals([...cursor.remaining,...(cursor.pendingVisual??[])]);
  cursor.pendingVisual=[];
  const waiting=new Set(cursor.pendingVisual.map(post=>post.id));
  cursor.remaining=cursor.remaining.filter(post=>!waiting.has(post.id));
  const seen=new Set(cursor.seen);
  const ranked=rankRecommendations(cursor.remaining.filter(post=>!seen.has(recommendationIdentity(post))&&!(recommendationFingerprint(post)&&seen.has(recommendationFingerprint(post)!))),preferences,viewerId,Date.now(),cursor.history,40);
  const selection=selectRecommendationPage(ranked,preferences,cursor.history,pageSize);
  const posts=selection.posts;cursor.remaining=selection.remaining;cursor.needsCreators=selection.blocked;cursor.seen.push(...posts.flatMap(post=>[recommendationIdentity(post),...(recommendationFingerprint(post)?[recommendationFingerprint(post)!]:[])]));cursor.seen=cursor.seen.slice(-1000);cursor.history=[...cursor.history,...posts].slice(-20);
  const sourcesAvailable=!!cursor.pendingVisual.length || !cursor.lime.done || !cursor.trending.done || Object.values(cursor.authors).some(state=>!state.done) || (preferences.followedTopics??[]).some(topic=>!cursor.topicDiscovery![topic]?.done) || Object.values(cursor.topics).some(state=>!state.limeDone || !state.blueDone || !state.misskeyDone) || Object.values(cursor.nativeAuthors).some(state=>!state.done);
  const more=sourcesAvailable||(cursor.remaining.length>0&&!selection.blocked);
  return {posts,next:more?cursor:undefined,preferences,pendingAnalysis:!!cursor.pendingVisual.length,requestKey:undefined as number|undefined};
}

/** Preserve visible order while removing media rejected by newly learned evidence. */
export function refreshRecommendationVisualPage(page:ReturnType<typeof finishRecommendationPage>,viewerId:string|null,checked?:PostWithAuthor,emit=true) {
 const initial=page.next??createRecommendationCursor([]);
 if(!page.next){
  initial.preferences=page.preferences;initial.lime.done=true;initial.trending.done=true;
  initial.seen=page.posts.flatMap(post=>[recommendationIdentity(post),...(recommendationFingerprint(post)?[recommendationFingerprint(post)!]:[])]);
  initial.history=page.posts.slice(-20);
  initial.topicDiscovery=Object.fromEntries((page.preferences.followedTopics??[]).map(topic=>[topic,{feeds:[],positions:{},done:true}]));
 }
 const cursor=copyRecommendationCursor(initial);
 const liked=checked&&page.preferences.likedSamples?.some(post=>post.id===checked.id);
 if(liked&&checked?.recommendationVisual){
  const preferences={...page.preferences,visualInterests:(page.preferences.visualInterests??[]).some(vector=>visualSimilarity(vector,checked.recommendationVisual!.vector)>.999)?page.preferences.visualInterests:[...(page.preferences.visualInterests??[]),checked.recommendationVisual.vector].slice(-24),likedSamples:page.preferences.likedSamples?.map(post=>post.id===checked.id?{...checked,engagedAt:post.engagedAt}:post)};
  cursor.preferences=preferences;page={...page,preferences};
 }
 if(checked?.recommendationVisual&&page.preferences.feedback?.some(row=>row.id===recommendationIdentity(checked))){
  const preferences={...page.preferences,feedback:page.preferences.feedback.map(row=>row.id===recommendationIdentity(checked)?{...row,vector:checked.recommendationVisual!.vector,visualKind:checked.recommendationVisual!.kind,imageUrls:checked.imageUrls}:row)};
  cursor.preferences=preferences;page={...page,preferences};
 }
 const merge=(post:PostWithAuthor)=>checked&&post.id===checked.id?{...post,recommendationVisual:checked.recommendationVisual,recommendationVisualStatus:checked.recommendationVisualStatus}:post;
 cursor.pendingVisual=cursor.pendingVisual?.map(merge);cursor.remaining=cursor.remaining.map(merge);
 const shown=applyCachedRecommendationVisuals(page.posts.map(merge)).filter(post=>recommendationIsEligible(post,page.preferences.followedTopics)&&!recommendationIsDismissed(post,page.preferences));
 const verified=applyCachedRecommendationVisuals([...shown,...(cursor.pendingVisual??[]),...cursor.remaining]).filter(post=>post.recommendationVisual&&recommendationIsEligible(post,page.preferences.followedTopics));
 for(const {actor,topics} of topicAuthorCandidates(verified,page.preferences.followedTopics??[]))if(!cursor.authors[actor]&&Object.keys(cursor.topicAuthors??{}).length<4){
  cursor.topicAuthors??={};cursor.topicAuthorLanguages??={};cursor.topicAuthors[actor]=topics;
  cursor.topicAuthorLanguages[actor]=[...new Set(verified.filter(post=>post.userId===actor).flatMap(recommendationOriginLanguages))];
  cursor.authors[actor]={cursor:null,done:false,media:true};
 }
 const result=finishRecommendationPage(cursor,page.preferences,viewerId,emit?Math.max(0,20-shown.length):0);
 return {...result,posts:[...shown,...result.posts],requestKey:page.requestKey};
}

function copyRecommendationCursor(previous:RecommendationCursor):RecommendationCursor {
  return {...previous,pendingVisual:[...(previous.pendingVisual??[])],lime:{...previous.lime},trending:{...previous.trending},authors:Object.fromEntries(Object.entries(previous.authors).map(([id,state])=>[id,{...state}])),topics:Object.fromEntries(Object.entries(previous.topics).map(([term,state])=>[term,{...state}])),nativeAuthors:Object.fromEntries(Object.entries(previous.nativeAuthors).map(([id,state])=>[id,{...state}])),history:[...previous.history],remaining:[...previous.remaining],seen:[...previous.seen],topicDiscovery:Object.fromEntries(Object.entries(previous.topicDiscovery??{}).map(([id,state])=>[id,{...state,feeds:state.feeds?[...state.feeds]:null,positions:Object.fromEntries(Object.entries(state.positions).map(([feed,pos])=>[feed,{...pos}]))}])),topicAuthors:{...(previous.topicAuthors??{})},topicAuthorLanguages:{...(previous.topicAuthorLanguages??{})}};
}

// An empty filtered page is useful progress when a source cursor advanced.
// Stop only repeated reads of the same source positions, never healthy paging.
function recommendationSourcePosition(cursor:RecommendationCursor) {
 return JSON.stringify({lime:cursor.lime,trending:cursor.trending,authors:cursor.authors,topics:cursor.topics,nativeAuthors:cursor.nativeAuthors,discovery:Object.fromEntries(Object.entries(cursor.topicDiscovery??{}).map(([id,state])=>[id,{feeds:state.feeds,positions:state.positions,done:state.done}]))});
}
// A deadline bounds a stalled source; it must not discard ordinary two-second responses.
export const RECOMMENDATION_WAIT_MS=5000;
let requestSequence=0;
export async function getRecommendationPage(previous:RecommendationCursor,viewerId:string|null,signal?:AbortSignal) {
 const controller=new AbortController();
 const abort=()=>controller.abort(signal?.reason);
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 const initial=copyRecommendationCursor(previous);
 try{if(!initial.preferences)initial.preferences=await getRecommendationPreferences(viewerId,()=>{},controller.signal);}catch(error){signal?.removeEventListener('abort',abort);controller.abort();throw error;}
 let work=initial,timer:ReturnType<typeof setTimeout>,readyTimer:ReturnType<typeof setTimeout>|undefined;
 const cancelled=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>{if(signal?.aborted)reject(signal.reason??new DOMException('Aborted','AbortError'));},{once:true}));
 let publishReady!:(page:ReturnType<typeof finishRecommendationPage>)=>void;
 const available=new Promise<ReturnType<typeof finishRecommendationPage>>(resolve=>{publishReady=resolve;});
 const operation=loadRecommendationPage(initial,viewerId,controller.signal,cursor=>{work=cursor;},cursor=>{
  // Let fast siblings contribute to ranking without waiting for a slow source.
  if(readyTimer)return;
  readyTimer=setTimeout(()=>{
   const snapshot=finishRecommendationPage(copyRecommendationCursor(work),work.preferences??cursor.preferences??{authors:{},terms:{}},viewerId);
   if(snapshot.posts.length)publishReady(snapshot);else readyTimer=undefined;
  },100);
 });
 const deadline=new Promise<Awaited<ReturnType<typeof loadRecommendationPage>>>(resolve=>{
  timer=setTimeout(()=>{
   controller.abort(new DOMException('Recommendation read deadline','TimeoutError'));
   const snapshot=copyRecommendationCursor(work);
   // Never turn a failed/slow preference lookup into an unpersonalized feed.
   if(viewerId&&!snapshot.preferences){resolve({posts:[],next:snapshot,preferences:{authors:{},terms:{}},pendingAnalysis:false,requestKey:undefined});return;}
   resolve(finishRecommendationPage(snapshot,snapshot.preferences??{authors:{},terms:{}},viewerId));
  },RECOMMENDATION_WAIT_MS);
 });
 try {const page=await Promise.race([operation,deadline,cancelled,available]);if(signal?.aborted)throw signal.reason;
  if(page.next){
   const progressed=page.posts.length>0||recommendationSourcePosition(page.next)!==recommendationSourcePosition(initial);
   page.next.stalledPages=progressed?0:(previous.stalledPages??0)+1;
  }
  const requestKey=++requestSequence;if(page.next)page.next.pageKey=requestKey;
  return {...page,automaticPaused:!!page.next&&(page.next.stalledPages??0)>=3,requestKey};}
 finally {clearTimeout(timer!);if(readyTimer)clearTimeout(readyTimer);signal?.removeEventListener('abort',abort);controller.abort();}
}
