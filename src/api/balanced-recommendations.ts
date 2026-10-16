import {createRecommendationCursor,getRecommendationPage,getRecommendationPreferences,type RecommendationCursor} from './recommendations';
import {getRecommendationTwitterPage} from './recommendation-twitter';
import {rankRecommendations} from '@/lib/recommendations';
import {recommendationIdentity,recommendationFingerprint} from '@/lib/recommendationSignals';
import {uniqueRecommendationPosts} from '@/lib/recommendationPaging';
import {applyCachedRecommendationVisuals} from '@/lib/recommendationVisual';
import type {PostWithAuthor} from '@/types';
let fallbackRequestKey=1_000_000_000;
const isTwitter=(post:PostWithAuthor)=>post.source==='x'||post.id.startsWith('x:');
/** Fetch both services before committing a page; keep every withheld candidate in its own cursor. */
export async function getBalancedRecommendationPage(previous:RecommendationCursor,viewer:string|null,signal?:AbortSignal){
 let preferences={...(previous.preferences??await getRecommendationPreferences(viewer,()=>{},signal)),visualOnly:true};
 const candidates={...preferences,allowUnverifiedMedia:true};
 const pageTarget=previous.pageKey===undefined&&previous.history.length===0?2:4;
 if(typeof Worker!=='undefined'&&[...(preferences.likedSamples??[]),...previous.remaining,...(previous.twitterRemaining??[])].some(post=>post.imageUrls.length&&!post.recommendationVisual)){
  void import('@/lib/recommendationVisualInference').then(module=>{if(!signal?.aborted)module.warmRecommendationVisualWorker();}).catch(()=>{});
 }
 const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 const seen=new Set(previous.seen);
 const unseen=(post:PostWithAuthor)=>!seen.has(recommendationIdentity(post))&&!seen.has(recommendationFingerprint(post)??'');
 const twitterActors=[...new Set([...(preferences.followedAuthors??[]),...Object.keys(preferences.authors).filter(actor=>preferences.authors[actor]>0)])].filter(actor=>actor.startsWith('x-user:')||/@(?:twitter|x)\.com$/i.test(actor));
 const twitterEnabled=!!preferences.followedTopics?.length||twitterActors.length>0;
 let cursor=previous.twitterCursor,done=previous.twitterDone??!twitterEnabled,remaining=(previous.twitterRemaining??[]).filter(unseen),twitterError:Error|null=null;
 const authorCounts={...(previous.authorCounts??previous.twitterAuthorCounts??{})},twitterCounts={...(previous.twitterAuthorCounts??{})},authorHandles={...(previous.twitterAuthorHandles??{})};
 const followed=new Set((preferences.followedAuthors??[]).map(actor=>actor.toLowerCase().replace(/@x\.com$/,'@twitter.com')));
 const isFollowed=(actor:string,handle='')=>followed.has(actor.toLowerCase())||followed.has(handle.toLowerCase().replace(/@x\.com$/,'@twitter.com'));
 const authorLimit=(actor:string)=>isFollowed(actor,authorHandles[actor])?6:3;
 const available=(post:PostWithAuthor)=>(authorCounts[post.userId]??0)<authorLimit(post.userId);
 const blocked=Object.fromEntries(Object.entries(twitterCounts).filter(([actor,count])=>count>=authorLimit(actor)).map(([actor])=>[actor,authorHandles[actor]??'']));
 const eligible=()=>rankRecommendations(remaining.filter(available),candidates,viewer,Date.now(),previous.history,Infinity,true);
 if(done&&cursor&&(twitterActors.some(actor=>!cursor?.authors?.[actor])||Object.keys(blocked).some(actor=>!cursor?.blockedActors?.includes(actor))))done=false;
 let timer:ReturnType<typeof setTimeout>;
 const twitter=(async()=>{
  for(let scan=0;scan<3&&!done&&(eligible().length<pageTarget||new Set(eligible().map(post=>post.userId)).size<2);scan++){
   try{
    const page=await getRecommendationTwitterPage(candidates,cursor,controller.signal,viewer,blocked);
    if(controller.signal.aborted)return;
    cursor=page.next??page.state??cursor;done=!page.next;if(page.error)twitterError=page.error;else if(page.attempted!==false)twitterError=null;remaining=uniqueRecommendationPosts([...remaining,...page.posts.filter(unseen)],previous.history);
   }catch(error){if(!signal?.aborted)twitterError=error instanceof Error?error:new Error('twitterを取得できませんでした');return;}
  }
 })();
 const stopped=new Promise<void>(resolve=>controller.signal.addEventListener('abort',()=>resolve(),{once:true}));
 const deadline=new Promise<void>(resolve=>{timer=setTimeout(()=>{twitterError=new DOMException('twitterのおすすめの取得に時間がかかっています','TimeoutError');controller.abort(new DOMException('twitter recommendation deadline','TimeoutError'));resolve();},5000);});
 try{
  const [nativeResult]=await Promise.allSettled([getRecommendationPage({...previous,preferences:candidates,remaining:previous.remaining.filter(post=>!twitterEnabled||available(post)),authors:Object.fromEntries(Object.entries(previous.authors).map(([actor,state])=>[actor,{...state,done:state.done||twitterEnabled&&(authorCounts[actor]??0)>=authorLimit(actor)}]))},viewer,signal,{deferTwitter:true}),Promise.race([twitter,deadline,stopped]).finally(()=>clearTimeout(timer!))]);
  if(nativeResult.status==='rejected'&&!remaining.length)throw nativeResult.reason;
  const native=nativeResult.status==='fulfilled'?nativeResult.value:{posts:[],next:{...previous,preferences},preferences,pendingAnalysis:false,automaticPaused:false,requestKey:++fallbackRequestKey};
  if(signal?.aborted)throw signal.reason;
  let raw=applyCachedRecommendationVisuals(uniqueRecommendationPosts([...native.posts,...remaining].filter(unseen),previous.history),true);
  preferences={...preferences,likedSamples:applyCachedRecommendationVisuals(preferences.likedSamples??[],true)};
  const references=preferences.likedSamples.slice(0,2);
  const analysis:PostWithAuthor[]=[...references.filter(post=>!post.recommendationVisual)];
  for(const provider of [true,false]){
   const creators=new Set<string>();
   for(const post of raw.filter(post=>isTwitter(post)===provider)){
    if(creators.size>=pageTarget)break;
    if(creators.has(post.userId)||!post.imageUrls.length)continue;creators.add(post.userId);
    if(!post.recommendationVisual)analysis.push(post);
   }
  }
  let visualError:Error|null=null;
  if(analysis.length){
   const {enrichRecommendationVisuals,releaseRecommendationVisualWorker,idleRecommendationVisualWorker}=await import('@/lib/recommendationVisualInference');
   const visualController=new AbortController(),cancelVisual=()=>visualController.abort(signal?.reason);
   signal?.addEventListener('abort',cancelVisual,{once:true});if(signal?.aborted)cancelVisual();
   const visualTimer=setTimeout(()=>visualController.abort(new DOMException('Image analysis deadline','TimeoutError')),30000);
   try{
    const checked=await enrichRecommendationVisuals(analysis,preferences.followedTopics??[],visualController.signal,undefined,analysis.length);
    const results=new Map(checked.map(post=>[post.id,post]));
    raw=raw.map(post=>results.get(post.id)??post);
    preferences={...preferences,likedSamples:(preferences.likedSamples??[]).map(post=>results.get(post.id)??post)};
    if(checked.some(post=>post.recommendationVisualStatus==='unavailable'))visualError=new Error('画像を判定できませんでした。未判定の投稿は表示していません。');
   }catch(error){
    if(signal?.aborted)throw signal.reason;
    visualError=new Error('画像を判定できませんでした。未判定の投稿は表示していません。');
   }finally{clearTimeout(visualTimer);signal?.removeEventListener('abort',cancelVisual);if(signal?.aborted)releaseRecommendationVisualWorker();else idleRecommendationVisualWorker();}
  }
  const base={...native,preferences};
  const posts=raw;
  const x=rankRecommendations(posts.filter(post=>isTwitter(post)&&available(post)),base.preferences,viewer,Date.now(),previous.history,Infinity,true),other=rankRecommendations(posts.filter(post=>!isTwitter(post)&&(!twitterEnabled||available(post))),preferences,viewer,Date.now(),previous.history,Infinity,true);
  // Commit pairs on each load. Never repay a Bluesky-only page later with
  // a twitter-only page; retain the faster provider's unused candidates.
  const totals=previous.providerTotals??{twitter:0,other:0};
  const chosenX:PostWithAuthor[]=[],selected:PostWithAuthor[]=[],authors=new Set<string>();
  for(const post of [...x].sort((a,b)=>Number(isFollowed(b.userId,b.author.username))-Number(isFollowed(a.userId,a.author.username)))){
   if(chosenX.length===4)break;
   if(authors.has(post.userId))continue;
   chosenX.push(post);authors.add(post.userId);
  }
  const pairing=twitterEnabled&&(!done||x.length>0||totals.twitter>0)&&nativeResult.status==='fulfilled'&&(other.length>0||!!base.next);
  const diverseOther=twitterEnabled?other.filter((post,index,rows)=>rows.findIndex(row=>row.userId===post.userId)===index):other;
  const pairCount=Math.min(chosenX.length,diverseOther.length,4);
  if(pairing)chosenX.splice(pairCount);
  const otherLimit=pairing?pairCount:twitterEnabled?Math.max(0,2-totals.other):8;
  const chosenOther=diverseOther.slice(0,otherLimit);
  for(const post of chosenX){
   twitterCounts[post.userId]=(twitterCounts[post.userId]??0)+1;
   authorHandles[post.userId]=post.author.username;
  }
  for(const post of [...chosenX,...chosenOther])authorCounts[post.userId]=(authorCounts[post.userId]??0)+1;
  const committed=new Set([...chosenX,...chosenOther].map(post=>post.id));
  const accepted=new Set([...x,...other].map(post=>post.id));
  const retain=(post:PostWithAuthor)=>accepted.has(post.id)||!post.recommendationVisual&&post.recommendationVisualStatus!=='unavailable'&&post.imageUrls.length>0;
  const twitterLeft=posts.filter(post=>isTwitter(post)&&!committed.has(post.id)&&available(post)&&retain(post));
  const xFirst=!isTwitter(previous.history.at(-1)??({id:'',source:'lime'} as PostWithAuthor));
  for(let i=0;i<Math.max(chosenOther.length,chosenX.length);i++)for(const row of xFirst?[chosenX[i],chosenOther[i]]:[chosenOther[i],chosenX[i]])if(row)selected.push(row);
  const withheld=posts.filter(post=>!isTwitter(post)&&!committed.has(post.id)&&available(post)&&retain(post)),next=base.next??((withheld.length||!done||twitterLeft.length)?base.exhaustedCursor??{...createRecommendationCursor([]),lime:{page:0,done:true},trending:{cursor:null,done:true},preferences:base.preferences}:undefined);
  if(next){
   const held=new Set([...withheld,...twitterLeft].flatMap(post=>[recommendationIdentity(post),recommendationFingerprint(post)].filter((id):id is string=>!!id)));
   const emitted=new Set(selected.flatMap(post=>[recommendationIdentity(post),recommendationFingerprint(post)].filter((id):id is string=>!!id)));
   next.seen=[...new Set([...previous.seen,...next.seen.filter(id=>!held.has(id)||emitted.has(id)),...emitted])];
   next.remaining=uniqueRecommendationPosts([...withheld,...next.remaining.filter(retain)]);
   next.history=[...previous.history,...selected].slice(-20);
   next.authorCounts=authorCounts;next.twitterAuthorCounts=twitterCounts;next.twitterAuthorHandles=authorHandles;
   next.providerTotals={twitter:totals.twitter+chosenX.length,other:totals.other+chosenOther.length};
   next.pageKey=base.requestKey;next.preferences=preferences;next.twitterCursor=cursor;next.twitterDone=done;next.twitterRemaining=twitterLeft;
  }
  const position=(value:RecommendationCursor)=>JSON.stringify([value.lime,value.trending,value.authors,value.topics,value.nativeAuthors,value.topicDiscovery]);
  const progressed=selected.length>0||!!base.next&&position(base.next)!==position(previous)||JSON.stringify(cursor)!==JSON.stringify(previous.twitterCursor)||done!==previous.twitterDone;
  if(next)next.stalledPages=progressed?0:(previous.stalledPages??0)+1;
  return {...base,automaticPaused:!!visualError&&!selected.length||!!base.automaticPaused&&!selected.length||!progressed&&!!next&&(next.stalledPages??0)>=2,posts:selected,next,twitterError,visualError};
 }finally{clearTimeout(timer!);signal?.removeEventListener('abort',abort);controller.abort();}
}
