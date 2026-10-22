import { searchXPage } from "@/lib/fxTwitter";
import { TOPICS, type TopicId, recommendationOriginLanguages, topicAuthorCandidates, recommendationIdentity, recommendationFingerprint, recommendationIsEligible, isDeclaredGeneratedArt, clearRecommendationReserve, recommendationTopicSignals, addRecommendationInterest, rejectedRecommendationTopics, isRecommendationAuthorRejected, rankRecommendations, recommendationQueries, readRecommendationLikes, selectRecommendationLikeSamples, readRecommendationImpressions, recommendationIsDismissed, selectRecommendationPage, type RecommendationPreferences, type RecommendationFeedback } from "@/lib/recommendations";
import { learnedRecommendationScores, getTopicPreferences } from "@/api/topics";
import { supabase } from "@/lib/supabase";
import { getFeed, getPostsByUser, searchPosts, type FeedCursor, getPostById, getVideoFeed } from "@/api/posts";
import { discoverBlueskyTopicFeeds, fetchBlueskyTopicFeed, fetchBlueskyAuthorFeed, fetchBlueskyLikedPosts, fetchBlueskyTopicPosts, fetchTrendingJapaneseBlueskyPosts } from "@/lib/bluesky";
import { applyCachedRecommendationVisuals, visualSimilarity, restoreRecommendationVisuals } from "@/lib/recommendationVisual";
import { normalizeTimelineBlueskyPost } from "@/lib/utils";
import { type PostWithAuthor } from "@/types/index";
import { fetchMisskeyTopicPosts } from "@/lib/misskey";
import { getExternalPost, isExternalPostId } from "@/api/external-posts";
import { type MediaViewerSelection } from "@/lib/mediaThumbnail";

// recommendations
// Read additional saved likes only during history hydration, never on the
// critical first-page path. Joined payloads are retained only while building
// the compact preference profile, not in timeline pages.
async function readRecommendationLikeHistory(viewerId:string,extended:boolean,signal?:AbortSignal) {
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

async function getRecommendationPreferences(viewerId:string|null,onTopics?:(preferences:RecommendationPreferences)=>void,signal?:AbortSignal):Promise<RecommendationPreferences> {
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
      supabase.from('follows').select('followee_id,external_profile,external_provider,external_handle').eq('follower_id',viewerId).eq('approved',true).abortSignal(signal),
      readRecommendationLikeHistory(viewerId,!onTopics,signal),
      !onTopics?supabase.from('reposts').select('created_at,posts:post_id(id,user_id,content,image_urls,created_at)').eq('user_id',viewerId).order('created_at',{ascending:false}).limit(100).abortSignal(signal):Promise.resolve({data:[],error:null}),
      !onTopics?supabase.from('external_reposts').select('created_at,post_snapshot').eq('user_id',viewerId).order('created_at',{ascending:false}).limit(100).abortSignal(signal):Promise.resolve({data:[],error:null}),
      !onTopics?supabase.from('comments').select('created_at,content,post:post_id(user_id,content)').eq('user_id',viewerId).order('created_at',{ascending:false}).limit(50).abortSignal(signal):Promise.resolve({data:[],error:null}),
      !onTopics?fetchBlueskyLikedPosts(signal).then(posts=>({data:posts.map(post=>({post_snapshot:normalizeTimelineBlueskyPost(post)})),error:null})):Promise.resolve({data:[],error:null}),
    ];
    const historyReads=historyJobs.map((job,index)=>Promise.resolve(job).then(value=>{partial[index]={status:'fulfilled',value};return value;},reason=>{partial[index]={status:'rejected',reason};throw reason;}));
    const historyRead=Promise.allSettled(historyReads);
    // Follows are explicit intent too; do not abort this small read with optional likes.
    await Promise.all([topicRead, historyReads[0].catch(()=>{})]);
    // First paint needs explicit topics and completed history only. The hook
    // hydrates remaining history separately without holding the open timeline.
    const results=onTopics?await Promise.race([historyRead,new Promise<PromiseSettledResult<any>[]>(resolve=>setTimeout(()=>resolve([...partial]),0))]):await historyRead;
    for(const [index,result] of results.entries()){
      if(!result||result.status!=='fulfilled' || result.value.error) continue;
      let processed=0;
      for(const row of result.value.data ?? []) {
        if(++processed%50===0){await new Promise(resolve=>setTimeout(resolve,0));if(signal.aborted)throw signal.reason;}
        if ('followee_id' in row && row.followee_id) { preferences.followedAuthors!.push(row.followee_id); preferences.authors[row.followee_id]=(preferences.authors[row.followee_id] ?? 0)+3; }
        else if(row.external_provider){
          const profile=row.external_profile;
          const handle=row.external_handle??profile?.username;
          const twitter=row.external_provider==='x'||row.external_provider==='twitter';
          const actor=profile?.id??(twitter&&handle?(/@(?:twitter|x)\.com$/i.test(handle)?handle:handle.replace(/^@/,'')+'@twitter.com'):undefined);
          if(actor){const id=actor.replace(/^bsky:/,'');preferences.followedAuthors!.push(id);preferences.authors[id]=(preferences.authors[id]??0)+3;if(handle){preferences.authorHandles??={};preferences.authorHandles[id]=handle;}}
        }
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
  preferences.likedSamples=selectRecommendationLikeSamples(applyCachedRecommendationVisuals(restoreRecommendationVisuals([...likes.filter(post=>post.imageUrls?.length),...(preferences.likedSamples??[])])));
  for(const post of preferences.likedSamples)if(post.recommendationVisual&&!preferences.visualInterests?.some(vector=>visualSimilarity(vector,post.recommendationVisual!.vector)>.999)){preferences.visualInterests??=[];preferences.visualInterests.push(post.recommendationVisual.vector);}
  for(const post of likes)if(!learnedLikes.has(recommendationIdentity(post)))addRecommendationInterest(preferences,post,2,post.engagedAt ?? new Date(Date.now()-30*86400000).toISOString());
  return preferences;
}
type RecommendationCursor={
  learnedScores?:Record<string,number>;
  pageKey?:number;
  lime:{page:number;before?:FeedCursor;done:boolean};
  trending:{cursor:string|null;done:boolean};
  authors:Record<string,{cursor:string|null;done:boolean;media?:boolean;emptyReads?:number}>;
  topics:Record<string,{limePage:number;limeDone:boolean;blueCursor:string|null;blueDone:boolean;misskeyCursor?:string|null;misskeyDone?:boolean}>;
  nativeAuthors:Record<string,{page:number;done:boolean}>;
  topicDiscovery?:Partial<Record<TopicId,{feedRound?:number;feeds:string[]|null;positions:Record<string,{cursor:string|null;done:boolean;emptyReads?:number}>;done:boolean}>>;
  discoveryRound?:number;
  authorRound?:number;
  twitterCursor?:import("@/api/search-news").TwitterRecommendationCursor;
  twitterDone?:boolean;
  providerTotals?:{twitter:number;other:number};
  authorCounts?:Record<string,number>;
  twitterAuthorCounts?:Record<string,number>;
  twitterAuthorHandles?:Record<string,string>;
  twitterRemaining?:PostWithAuthor[];
  twitterRound?:number;
  twitterDiscovery?:Record<string,{cursor:string|null;done:boolean}>;
  needsCreators?:boolean;
  stalledPages?:number;
  topicAuthors?:Record<string,TopicId[]>;
  topicAuthorLanguages?:Record<string,string[]>;
  history:PostWithAuthor[];
  pendingVisual?:PostWithAuthor[];
  catalogRead?:boolean;
  remaining:PostWithAuthor[];seen:string[];preferences?:RecommendationPreferences;
};
function createRecommendationCursor(handles:string[]):RecommendationCursor {
  const buckets=[handles.filter(actor=>/@(?:twitter|x)\.com$/i.test(actor)||actor.startsWith('x-user:')),handles.filter(actor=>!/@(?:twitter|x)\.com$/i.test(actor)&&!actor.startsWith('x-user:'))];
  const ordered=Array.from({length:Math.max(...buckets.map(rows=>rows.length))},(_,i)=>buckets.flatMap(rows=>rows[i]?[rows[i]]:[])).flat();
  return {lime:{page:0,done:false},trending:{cursor:null,done:false},authors:Object.fromEntries(ordered.map(actor=>[actor,{cursor:null,done:false}])),topics:{},nativeAuthors:{},history:[],remaining:[],seen:[]};
}
const RECOMMENDATION_SOURCE_SIZE=8;
const RECOMMENDATION_PAGE_SIZE=8;
async function loadRecommendationPage(previous:RecommendationCursor,viewerId:string|null,signal?:AbortSignal,publish?:(cursor:RecommendationCursor)=>void,ready?:(cursor:RecommendationCursor)=>void,sourceState?:{twitterPending:boolean},deferTwitter=false) {
  const cursor=copyRecommendationCursor(previous);
  publish?.(cursor);
  const preferences=cursor.preferences ?? await getRecommendationPreferences(viewerId,early=>{cursor.preferences={...early};},signal);
  cursor.topicDiscovery=Object.fromEntries(Object.entries(previous.topicDiscovery??{}).map(([id,state])=>[id,{...state,feeds:state.feeds?[...state.feeds]:null,positions:Object.fromEntries(Object.entries(state.positions).map(([feed,pos])=>[feed,{...pos}]))}]));
  cursor.topicAuthors={...(previous.topicAuthors??{})};
  cursor.topicAuthorLanguages={...(previous.topicAuthorLanguages??{})};
  cursor.preferences=preferences;
  const markSourceYield=(state:{done:boolean;emptyReads?:number},posts:PostWithAuthor[])=>{
    const seen=new Set(cursor.seen);
    const unseen=posts.filter(post=>!seen.has(recommendationIdentity(post))&&!(recommendationFingerprint(post)&&seen.has(recommendationFingerprint(post)!)));
    const usable=rankRecommendations(unseen,preferences,viewerId,Date.now(),cursor.history,1,true).length>0;
    state.emptyReads=usable?0:(state.emptyReads??0)+1;
    // Drop an unproductive source for this cursor, not the whole timeline.
    // Sources that yield related works retain ordinary unlimited pagination.
    if(state.emptyReads>=8)state.done=true;
  };
  const favoriteBlueskyAuthors = Object.entries(preferences.authors)
    .filter(([id,weight]) => weight>0&&(id.startsWith('did:') || id.startsWith('misskey-user:') || id.startsWith('x-user:'))&&!isRecommendationAuthorRejected(id,preferences))
    .sort((a,b) => b[1]-a[1]).slice(0,12);
  for (const [actor] of favoriteBlueskyAuthors) {
    if (!cursor.authors[actor]) cursor.authors[actor]={cursor:null,done:false};
  }
  for (const term of recommendationQueries(preferences)) {
    if (!cursor.topics[term]) cursor.topics[term]={limePage:0,limeDone:false,blueCursor:null,blueDone:false,misskeyCursor:null,misskeyDone:false};
  }
  const twitterTerms=(preferences.followedTopics??[]).filter(topic=>!(preferences.dismissedTopics??[]).includes(topic)).flatMap(topic=>TOPICS.find(row=>row.id===topic)?.queries.slice(0,1)??[]);
  cursor.twitterDiscovery??={};
  for(const term of deferTwitter?[]:twitterTerms)cursor.twitterDiscovery[term]??={cursor:null,done:false};
  const favoriteNativeAuthors=Object.entries(preferences.authors).filter(([id])=>/^[0-9a-f-]{36}$/i.test(id) && id!==viewerId).sort((a,b)=>b[1]-a[1]).slice(0,2);
  for (const [author] of favoriteNativeAuthors) if(!cursor.nativeAuthors[author]) cursor.nativeAuthors[author]={page:0,done:false};
  const suppliedCreators=new Set(cursor.remaining.map(post=>post.userId));
  const needsCreatorVariety=cursor.remaining.length>=RECOMMENDATION_PAGE_SIZE&&suppliedCreators.size===1&&
    Object.entries(cursor.authors).some(([actor,state])=>!state.done&&!suppliedCreators.has(actor));
  if(cursor.remaining.length<RECOMMENDATION_PAGE_SIZE||cursor.needsCreators||needsCreatorVariety) {
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
    for(const [actor,state] of Object.entries(cursor.authors))if(isRecommendationAuthorRejected(actor,preferences)||deferTwitter&&(actor.startsWith('x-user:')||/@(?:twitter|x)\.com$/i.test(actor)))state.done=true;
    const authorSlots=Object.entries(cursor.authors).sort(([a],[b])=>(preferences.authors[b]??0)-(preferences.authors[a]??0));
    const authorRound=cursor.authorRound??0;
    const selectedAuthors:typeof authorSlots=[];
    let scannedAuthors=0;
    while(selectedAuthors.length<2&&scannedAuthors<authorSlots.length){
      const entry=authorSlots[(authorRound+scannedAuthors++)%authorSlots.length];
      const alreadySupplied=needsCreatorVariety&&suppliedCreators.has(entry[0]);
      if(!entry[1].done&&!alreadySupplied)selectedAuthors.push(entry);
    }
    cursor.authorRound=authorRound+scannedAuthors;
    for(const [actor,state] of selectedAuthors) {
      jobs.push({priority:3,load:async()=>{
        const page=await fetchBlueskyAuthorFeed({actor,cursor:state.cursor,limit:RECOMMENDATION_SOURCE_SIZE,filter:state.media||preferences.followedTopics?.some(topic=>topic==='art'||topic==='digital-illustration')?'posts_with_media':undefined,signal});
        state.done=!page.cursor || page.cursor===state.cursor;state.cursor=page.cursor ?? null;
        const rows=page.posts.map(normalizeTimelineBlueskyPost).map(post=>cursor.topicAuthors![actor]?{...post,recommendationAuthorTopics:cursor.topicAuthors![actor],recommendationLanguages:cursor.topicAuthorLanguages![actor]}:post);
        markSourceYield(state,rows);return rows;
      }});
    }
    const rejectedTopics=new Set(rejectedRecommendationTopics(preferences));
    for(const topic of rejectedTopics){
      const state=cursor.topicDiscovery![topic]??={feeds:[],positions:{},done:true};state.done=true;
    }
    const topicSlots=(preferences.followedTopics??[]).filter(topic=>!rejectedTopics.has(topic));
    const round=cursor.discoveryRound??0;
    const selected:TopicId[]=[];let scannedTopics=0;
    while(selected.length<1&&scannedTopics<topicSlots.length){
      const topic=topicSlots[(round+scannedTopics++)%topicSlots.length];
      if(!cursor.topicDiscovery![topic]?.done)selected.push(topic);
    }
    cursor.discoveryRound=round+scannedTopics;
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
          if(!signal?.aborted){const rows=page.posts.map(normalizeTimelineBlueskyPost);markSourceYield(position,rows);cursor.remaining.push(...rows);}
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
    const twitterSources=Object.entries(cursor.twitterDiscovery);
    if((cursor.history.length>0||cursor.pageKey!==undefined)&&twitterSources.some(([,state])=>!state.done)){
      const available=twitterSources.filter(([,state])=>!state.done),[term,state]=available[(cursor.twitterRound??0)%available.length];
      jobs.push({priority:2,load:async()=>{
        cursor.twitterRound=(cursor.twitterRound??0)+1;
        if(sourceState)sourceState.twitterPending=true;
        let page:Awaited<ReturnType<typeof searchXPage>>;
        try{page=await searchXPage(term,{cursor:state.cursor,feed:'latest',signal,preferAlternative:true,limit:2});}finally{if(sourceState)sourceState.twitterPending=false;}
        state.done=!page.cursor||page.cursor===state.cursor;state.cursor=page.cursor;
        return page.posts.map(normalizeTimelineBlueskyPost).map(post=>({...post,recommendationSources:[...(post.recommendationSources??[]),'twitter-search:'+term]}));
      }});
    }
    for(const [author,state] of Object.entries(cursor.nativeAuthors)) if(!state.done) jobs.push({load:async()=>{
      const rows=await getPostsByUser(author,state.page,RECOMMENDATION_SOURCE_SIZE,signal);state.page++;state.done=rows.length<RECOMMENDATION_SOURCE_SIZE;return rows;
    }});
    const results:PromiseSettledResult<PostWithAuthor[]>[]=new Array(jobs.length);
    jobs.sort((a,b)=>(b.priority??0)-(a.priority??0));
    // Spend the same small budget on initial and subsequent pages. Reserve
    // a slot for another source so familiar creators cannot starve topics.
    const topicJobs=jobs.filter(job=>job.priority===2);
    const topicLimit=twitterSources.some(([,state])=>!state.done)&&(cursor.history.length>0||cursor.pageKey!==undefined)?2:1;
    const topics=topicJobs.slice(0,topicLimit);
    const primary=jobs.filter(job=>job.priority===3).slice(0,Math.min(2,4-topics.length-1));
    const others=jobs.filter(job=>!primary.includes(job)&&job.priority!==3&&job.priority!==2);
    const batch=[...primary,...topics,...others.slice(0,4-primary.length-topics.length)];
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
    const unattemptedTopics=(preferences.followedTopics??[]).some(topic=>!rejectedTopics.has(topic)&&!cursor.topicDiscovery?.[topic]);
    if(failed && !cursor.remaining.length && !unattemptedTopics && successful.every(result=>result.status==='fulfilled' && !result.value.length)) throw failed.reason;
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
  if(!preferences.visualOnly&&import.meta.env.VITE_RECOMMENDATION_RANKER_ENABLED==='true') {
    const candidates=rankRecommendations(applyCachedRecommendationVisuals([...cursor.remaining,...(cursor.pendingVisual??[])]).filter(post=>!cursor.seen.includes(recommendationIdentity(post))&&!(recommendationFingerprint(post)&&cursor.seen.includes(recommendationFingerprint(post)!))),preferences,viewerId,Date.now(),cursor.history,40,cursor.history.length===0);
    cursor.learnedScores=await learnedRecommendationScores(candidates,preferences,viewerId,signal);
  } else cursor.learnedScores={};
  return finishRecommendationPage(cursor,preferences,viewerId);
}

function finishRecommendationPage(cursor:RecommendationCursor,preferences:RecommendationPreferences,viewerId:string|null,pageSize=RECOMMENDATION_PAGE_SIZE) {
  cursor.remaining=applyCachedRecommendationVisuals([...cursor.remaining,...(cursor.pendingVisual??[])]);
  cursor.pendingVisual=[];
  const waiting=new Set(cursor.pendingVisual.map(post=>post.id));
  cursor.remaining=cursor.remaining.filter(post=>!waiting.has(post.id));
  const seen=new Set(cursor.seen);
  const ranked=rankRecommendations(cursor.remaining.filter(post=>!seen.has(recommendationIdentity(post))&&!(recommendationFingerprint(post)&&seen.has(recommendationFingerprint(post)!))),preferences,viewerId,Date.now(),cursor.history,40,cursor.history.length===0);
  if(cursor.learnedScores&&ranked.every(post=>Number.isFinite(cursor.learnedScores![recommendationIdentity(post)])))ranked.sort((a,b)=>cursor.learnedScores![recommendationIdentity(b)]-cursor.learnedScores![recommendationIdentity(a)]);
  const selection=selectRecommendationPage(ranked,preferences,cursor.history,pageSize);
  const posts=selection.posts;cursor.remaining=selection.remaining;cursor.needsCreators=selection.blocked;cursor.seen.push(...posts.flatMap(post=>[recommendationIdentity(post),...(recommendationFingerprint(post)?[recommendationFingerprint(post)!]:[])]));cursor.seen=cursor.seen.slice(-1000);cursor.history=[...cursor.history,...posts].slice(-20);
  const sourcesAvailable=Object.values(cursor.twitterDiscovery??{}).some(state=>!state.done) || !!cursor.pendingVisual.length || !cursor.lime.done || !cursor.trending.done || Object.values(cursor.authors).some(state=>!state.done) || (preferences.followedTopics??[]).some(topic=>!cursor.topicDiscovery![topic]?.done) || Object.values(cursor.topics).some(state=>!state.limeDone || !state.blueDone || !state.misskeyDone) || Object.values(cursor.nativeAuthors).some(state=>!state.done);
  const more=sourcesAvailable||(cursor.remaining.length>0&&!selection.blocked);
  return {posts,next:more?cursor:undefined,...(!more?{exhaustedCursor:cursor}:{}),preferences,pendingAnalysis:!!cursor.pendingVisual.length,requestKey:undefined as number|undefined};
}

/** Preserve visible order while removing media rejected by newly learned evidence. */
function refreshRecommendationVisualPage(page:ReturnType<typeof finishRecommendationPage>,viewerId:string|null,checked?:PostWithAuthor,emit=true) {
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
 // Pixel updates only remove/annotate visible work. Running native pagination
 // here could terminate the independent twitter continuation and reset budgets.
 if(!emit)return {...page,posts:shown,next:page.next?cursor:undefined};
 const result=finishRecommendationPage(cursor,page.preferences,viewerId,Math.max(0,20-shown.length));
 return {...result,posts:[...shown,...result.posts],requestKey:page.requestKey};
}

function copyRecommendationCursor(previous:RecommendationCursor):RecommendationCursor {
  return {...previous,twitterDiscovery:Object.fromEntries(Object.entries(previous.twitterDiscovery??{}).map(([term,state])=>[term,{...state}])),pendingVisual:[...(previous.pendingVisual??[])],lime:{...previous.lime},trending:{...previous.trending},authors:Object.fromEntries(Object.entries(previous.authors).map(([id,state])=>[id,{...state}])),topics:Object.fromEntries(Object.entries(previous.topics).map(([term,state])=>[term,{...state}])),nativeAuthors:Object.fromEntries(Object.entries(previous.nativeAuthors).map(([id,state])=>[id,{...state}])),history:[...previous.history],remaining:[...previous.remaining],seen:[...previous.seen],topicDiscovery:Object.fromEntries(Object.entries(previous.topicDiscovery??{}).map(([id,state])=>[id,{...state,feeds:state.feeds?[...state.feeds]:null,positions:Object.fromEntries(Object.entries(state.positions).map(([feed,pos])=>[feed,{...pos}]))}])),topicAuthors:{...(previous.topicAuthors??{})},topicAuthorLanguages:{...(previous.topicAuthorLanguages??{})}};
}

// An empty filtered page is useful progress when a source cursor advanced.
// Stop only repeated reads of the same source positions, never healthy paging.
function recommendationSourcePosition(cursor:RecommendationCursor) {
 return JSON.stringify({lime:cursor.lime,trending:cursor.trending,twitter:cursor.twitterDiscovery,authors:cursor.authors,topics:cursor.topics,nativeAuthors:cursor.nativeAuthors,discovery:Object.fromEntries(Object.entries(cursor.topicDiscovery??{}).map(([id,state])=>[id,{feeds:state.feeds,positions:state.positions,done:state.done}]))});
}
// A deadline bounds a stalled source; it must not discard ordinary two-second responses.
const RECOMMENDATION_WAIT_MS=5000;
let requestSequence=0;
async function getRecommendationPage(previous:RecommendationCursor,viewerId:string|null,signal?:AbortSignal,options?:{deferTwitter?:boolean}) {
 const startedAt=Date.now();
 const controller=new AbortController();
 const abort=()=>controller.abort(signal?.reason);
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 const initial=copyRecommendationCursor(previous);
 const initialCreators=new Set(initial.remaining.map(post=>post.userId));
 const seekingVariety=initial.remaining.length>=RECOMMENDATION_PAGE_SIZE&&initialCreators.size===1&&
  Object.entries(initial.authors).some(([actor,state])=>!state.done&&!initialCreators.has(actor));
 try{if(!initial.preferences)initial.preferences=await getRecommendationPreferences(viewerId,()=>{},controller.signal);}catch(error){signal?.removeEventListener('abort',abort);controller.abort();throw error;}
 let work=initial,timer:ReturnType<typeof setTimeout>,readyTimer:ReturnType<typeof setTimeout>|undefined;
 const cancelled=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>{if(signal?.aborted)reject(signal.reason??new DOMException('Aborted','AbortError'));},{once:true}));
 let publishReady!:(page:ReturnType<typeof finishRecommendationPage>)=>void;
 const available=new Promise<ReturnType<typeof finishRecommendationPage>>(resolve=>{publishReady=resolve;});
 const sourceState={twitterPending:false};
 const operation=loadRecommendationPage(initial,viewerId,controller.signal,cursor=>{work=cursor;},cursor=>{
  // Let fast siblings contribute to ranking without waiting for a slow source.
  if(readyTimer)return;
  readyTimer=setTimeout(()=>{
   const snapshot=finishRecommendationPage(copyRecommendationCursor(work),work.preferences??cursor.preferences??{authors:{},terms:{}},viewerId);
   // Cached work from one author is already available. Do not cancel the
   // alternate creator's read merely because an empty fast sibling completed.
   if(initial.history.length>0&&sourceState.twitterPending){readyTimer=undefined;return;}
   if(snapshot.posts.length&&(!seekingVariety||new Set(snapshot.posts.map(post=>post.userId)).size>1))publishReady(snapshot);else readyTimer=undefined;
  },100);
 },sourceState,options?.deferTwitter);
 const deadline=new Promise<Awaited<ReturnType<typeof loadRecommendationPage>>>(resolve=>{
  timer=setTimeout(()=>{
   controller.abort(new DOMException('Recommendation read deadline','TimeoutError'));
   const snapshot=copyRecommendationCursor(work);
   // Never turn a failed/slow preference lookup into an unpersonalized feed.
   if(viewerId&&!snapshot.preferences){resolve({posts:[],next:snapshot,preferences:{authors:{},terms:{}},pendingAnalysis:false,requestKey:undefined});return;}
   resolve(finishRecommendationPage(snapshot,snapshot.preferences??{authors:{},terms:{}},viewerId));
  },Math.max(0,RECOMMENDATION_WAIT_MS-(Date.now()-startedAt)));
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

// recommendation-feedback
function createRecommendationFeedback(post:PostWithAuthor):RecommendationFeedback {
 return {id:recommendationIdentity(post),userId:post.userId,fingerprint:recommendationFingerprint(post)??undefined,topics:post.recommendationVisual?.topics??recommendationTopicSignals(post),vector:post.recommendationVisual?.vector,imageUrls:post.imageUrls.slice(0,4),visualKind:post.recommendationVisual?.kind,createdAt:new Date().toISOString()};
}
async function dismissRecommendation(post:PostWithAuthor):Promise<RecommendationFeedback>{
 const feedback=createRecommendationFeedback(post);
 const {error}=await supabase.rpc('dismiss_recommendation',{feedback});if(error)throw error;clearRecommendationReserve();return feedback;
}

/** Enrich only an existing dismissal; preserve its date and never recreate one. */
async function enrichRecommendationFeedback(post:PostWithAuthor){
 if(!post.recommendationVisual)return;
 const {error}=await supabase.rpc('dismiss_recommendation',{feedback:{enrichment:true,id:recommendationIdentity(post),userId:post.userId,vector:post.recommendationVisual.vector,visualKind:post.recommendationVisual.kind,imageUrls:post.imageUrls.slice(0,4)}});
 if(error)throw error;
}

export { readRecommendationLikeHistory };
export { getRecommendationPreferences };
export { createRecommendationCursor };
export { refreshRecommendationVisualPage };
export { getRecommendationPage };
export type { RecommendationCursor };
export { RECOMMENDATION_WAIT_MS };
export { createRecommendationFeedback };
export { dismissRecommendation };
export { enrichRecommendationFeedback };


// video-recommendations
export type VideoRecommendationCursor = {
  stage: 'author' | 'mixed';
  authorCount?: number;
  following?: PostWithAuthor[];
  popularDone?: boolean;
  popularQuery?: string;
  popularQueries?: string[];
  author?: PostWithAuthor;
  before?: FeedCursor;
  externalCursor?: string | null;
  seen: string[];
};

const isExternal = (post: PostWithAuthor) => !!post.source && post.source !== 'lime' || /^(x-user:|did:|misskey-user:)/.test(post.userId);
const actor = (post: PostWithAuthor) => post.source === 'x' || post.userId.startsWith('x-user:') ? post.author.username || post.userId : post.userId;
const newest = (a: PostWithAuthor, b: PostWithAuthor) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id);

type SourceRead<T> = {done: boolean; value?: T; error?: unknown; promise: Promise<void>};
function startRead<T>(read: () => Promise<T>): SourceRead<T> {
  const job: SourceRead<T> = {done: false, promise: Promise.resolve()};
  job.promise = read().then(value => {job.value = value;}, error => {job.error = error;}).finally(() => {job.done = true;});
  return job;
}
const followingReads = new WeakMap<VideoRecommendationCursor, SourceRead<PostWithAuthor[]>>();
const popularReads = new WeakMap<VideoRecommendationCursor, SourceRead<Awaited<ReturnType<typeof searchXPage>>>>();
async function recentFollowing(viewerId: string | undefined, author: PostWithAuthor | undefined, signal?: AbortSignal): Promise<PostWithAuthor[]> {
    const follows: {followee_id?: string; external_provider?: string; external_handle?: string; external_profile?: {id?: string; username?: string}}[] = [];
    if (viewerId) for (let offset = 0; ; offset += 1000) {
      const {data, error} = await supabase.from('follows').select('followee_id,external_provider,external_handle,external_profile').eq('follower_id', viewerId).eq('approved', true).order('created_at', {ascending: false}).range(offset, offset + 999).abortSignal(signal!);
      if (error) {if (signal?.aborted) throw signal.reason; break;}
      follows.push(...data ?? []);
      if (!data || data.length < 1000) break;
    }
    const nativeIds = follows.filter(row => !row.external_provider && row.followee_id && row.followee_id !== author?.userId).map(row => row.followee_id!);
    // A finite recent pool keeps old followed posts from postponing popular videos forever.
    const native = nativeIds.length ? await getVideoFeed(undefined, signal, {authorIds: nativeIds, limit: 20}).catch(error => {if (signal?.aborted) throw error; return {posts: []};}) : {posts: []};
    const actors = [...new Set(follows.filter(row => ['x','twitter','bluesky'].includes(row.external_provider ?? '')).flatMap(row => {
      const handle = row.external_handle || row.external_profile?.username;
      const name = handle || row.external_profile?.id;
      if (!name) return [];
      return [(row.external_provider === 'x' || row.external_provider === 'twitter') && handle ? `${handle.replace(/^@/, '').replace(/@(?:x|twitter)\.com$/i, '')}@twitter.com` : name];
    }))];
    const external: PostWithAuthor[] = [];
    let index = 0;
    await Promise.all(Array.from({length: Math.min(3, actors.length)}, async () => {
      while (index < actors.length) {
        const name = actors[index++];
        try {
          const page = await fetchBlueskyAuthorFeed({actor: name, filter: 'posts_with_media', includeReposts: false, limit: 30, signal});
          external.push(...page.posts.map(normalizeTimelineBlueskyPost));
        } catch (error) {if (signal?.aborted) throw error;} // One unavailable follow must not stop popular-video fallback.
      }
    }));
    return [...new Map([...native.posts, ...external].filter(post => (post.video || post.externalVideo) && !post.externalRepostedBy && !post.profileRepostedBy && post.userId !== author?.userId).sort(newest).map(post => [post.id, post])).values()];
}

/** Offer up to three more author videos, then interleave recent follows and popular Twitter videos. */
export async function getVideoRecommendationPage(selection: MediaViewerSelection, viewerId: string | undefined, previous?: VideoRecommendationCursor, signal?: AbortSignal): Promise<{posts: PostWithAuthor[]; nextCursor: VideoRecommendationCursor | null}> {
  const id = selection.video?.postId ?? selection.postId;
  const state: VideoRecommendationCursor = previous ? {...previous, seen: [...previous.seen], following: previous.following ? [...previous.following] : undefined} : {stage: 'author', seen: id ? [id] : []};
  const seen = new Set(state.seen);
  const deliver = (rows: PostWithAuthor[], limit = Infinity) => {
    let count = 0;
    return rows.filter(post => {
    if (count >= limit || !(post.video || post.externalVideo) || post.externalRepostedBy || post.profileRepostedBy || seen.has(post.id)) return false;
    count++; seen.add(post.id); return true;
    });
  };
  let posts: PostWithAuthor[] = [];
  if (state.stage === 'author') {
    const author = state.author ?? selection.post ?? (id ? await (isExternalPostId(id) ? getExternalPost(id) : getPostById(id)) : null);
    if (!author) throw new Error('投稿者の情報を取得できませんでした');
    state.author = author;
    if (isExternal(author)) {
      const page = await fetchBlueskyAuthorFeed({actor: actor(author), cursor: state.externalCursor, filter: 'posts_with_media', includeReposts: false, limit: 30, signal});
      posts = deliver(page.posts.map(normalizeTimelineBlueskyPost).filter(post => post.userId === author.userId), 3 - (state.authorCount ?? 0));
      if (!page.cursor || page.cursor === state.externalCursor) state.stage = 'mixed';
      state.externalCursor = page.cursor;
    } else {
      const page = await getVideoFeed(state.before, signal, {authorIds: [author.userId]});
      posts = deliver(page.posts, 3 - (state.authorCount ?? 0));
      state.before = page.nextCursor ?? undefined;
      if (!page.nextCursor) state.stage = 'mixed';
    }
    state.authorCount = (state.authorCount ?? 0) + posts.length;
    if (state.authorCount >= 3) state.stage = 'mixed';
    if (state.stage === 'mixed') state.externalCursor = null;
  } else {
    let recent = previous ? followingReads.get(previous) : undefined;
    if (state.following === undefined && !recent) recent = startRead(() => recentFollowing(viewerId, state.author, signal));
    let search = previous ? popularReads.get(previous) : undefined;
    if (!search) {
      // A meaningful random topic works even when a filter-only search has no candidates.
      if (!state.popularQuery || state.popularDone) {
        const queries = [...new Set(TOPICS.flatMap(topic => topic.queries).map(term => `${term} 動画`))];
        const available = queries.filter(query => !(state.popularQueries ?? []).includes(query));
        const pool = available.length ? available : queries;
        state.popularQuery = pool[Math.floor(Math.random() * pool.length)] ?? '動画';
        state.popularQueries = [...(available.length ? state.popularQueries ?? [] : []), state.popularQuery];
        state.externalCursor = null;
      }
      search = startRead(() => searchXPage(state.popularQuery!, {cursor: state.externalCursor, feed: 'top', preferAlternative: true, limit: 20, signal}));
    }
    if (!state.following?.length) {
      await Promise.race([search.promise, ...(recent ? [recent.promise] : [])]);
      if (!search.done && !recent?.value?.some(post => !seen.has(post.id))) await search.promise;
    } else await Promise.resolve();
    if (signal?.aborted) throw signal.reason;
    if (recent?.done) {
      state.following = recent.value ?? [];
      recent = undefined;
    }
    let popular: PostWithAuthor[] = [];
    if (search.done) {
      if (search.error && !state.following?.length) throw search.error;
      const page = search.value;
      popular = (page?.posts ?? []).map(normalizeTimelineBlueskyPost).filter(post => (post.externalVideo || post.video) && post.userId !== state.author?.userId && !seen.has(post.id) && !post.externalRepostedBy && !post.profileRepostedBy);
      state.popularDone = !popular.length || !page?.cursor || page.cursor === state.externalCursor;
      state.externalCursor = page?.cursor ?? null;
      search = undefined;
      for (let i = popular.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [popular[i], popular[j]] = [popular[j], popular[i]];
      }
    }
    // Late results are retained for the next page; neither provider blocks ready videos.
    if (recent) followingReads.set(state, recent);
    if (search) popularReads.set(state, search);
   // Keep a recent-follow reserve across popular pages, mixing one of each in order.
   const following = state.following?.splice(0, 6) ?? [];
   posts = deliver(Array.from({length: Math.max(following.length, popular.length)}, (_, i) => [following[i], popular[i]]).flat().filter((post): post is PostWithAuthor => !!post));
  }
  if (signal?.aborted) throw signal.reason;
  state.seen = [...seen];
  return {posts, nextCursor: state};
}
