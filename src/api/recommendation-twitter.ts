import {applyCachedRecommendationVisuals} from '@/lib/recommendationVisual';
import {searchXPage,xFeed} from '@/lib/fxTwitter';
import {TOPICS} from '@/lib/topics';
import {normalizeTimelineBlueskyPost} from '@/lib/timelinePaging';
import {isRecommendationAuthorRejected,rankRecommendations,rejectedRecommendationTopics,type RecommendationPreferences} from '@/lib/recommendations';
type SourcePosition={cursor:string|null;done:boolean;retryAfter?:number;query?:string;mode?:'media-top'|'media';fallback?:boolean};
export type TwitterRecommendationCursor={positions:Record<string,SourcePosition>;round:number;authors?:Record<string,SourcePosition>;authorRound?:number;blockedActors?:string[]};
/** Rotate followed creators and topic discovery with independent, retryable source positions. */
export async function getRecommendationTwitterPage(preferences:RecommendationPreferences,previous?:TwitterRecommendationCursor,signal?:AbortSignal,viewer:string|null=null,excludedAuthors:Record<string,string>={}):Promise<{posts:import('@/types').PostWithAuthor[];next?:TwitterRecommendationCursor;state:TwitterRecommendationCursor;error?:Error;attempted:boolean}>{
 const excludedTopics=new Set(rejectedRecommendationTopics(preferences));
 const followed=(preferences.followedTopics??[]).filter(topic=>!excludedTopics.has(topic));
 // Prefer the specific artwork topic over a broad "anime" conversation search.
 const topics=[...followed].filter(topic=>!followed.includes('digital-illustration')||!['anime','art'].includes(topic)).sort((a,b)=>Number(b==='digital-illustration')-Number(a==='digital-illustration'));
 const tags=new Map<string,{works:Set<string>;topics:Set<string>}>();
 for(const post of preferences.visualOnly?[]:preferences.likedSamples??[]){
  const aligned=topics.filter(topic=>post.recommendationTopics?.includes(topic)||post.recommendationVisual?.topics.includes(topic));
  if(!post.imageUrls.length||!aligned.length)continue;
  for(const tag of new Set(post.content.normalize('NFKC').match(/#[\p{L}\p{N}_]{2,40}/gu)??[])){
   if(TOPICS.some(topic=>topic.terms.some(term=>tag.slice(1).toLowerCase()===term.toLowerCase())))continue;
   const evidence=tags.get(tag)??{works:new Set(),topics:new Set()};evidence.works.add(post.id);aligned.forEach(topic=>evidence.topics.add(topic));tags.set(tag,evidence);
  }
 }
 const learned=[...tags].filter(([,evidence])=>evidence.works.size>=2).sort((a,b)=>b[1].works.size-a[1].works.size).slice(0,3);
 const terms=preferences.visualOnly?[]:[...learned.map(([tag])=>tag),...topics.flatMap(topic=>TOPICS.find(row=>row.id===topic)?.queries.slice(0,topic==='digital-illustration'?2:1)??[])];
 const cursor:TwitterRecommendationCursor=previous?structuredClone(previous):{positions:{},round:0};
 const excluded=[...new Set(Object.values(excludedAuthors).map(handle=>handle.replace(/@(?:twitter|x)\.com$/i,'').replace(/^@/,'')).filter(handle=>/^[a-z0-9_]{1,15}$/i.test(handle)))].slice(-8);
 cursor.blockedActors=Object.keys(excludedAuthors);
 for(const [index,term] of terms.entries()){
  const query=[term,...excluded.map(handle=>'-from:'+handle)].join(' ');
  const state=cursor.positions[term]??={cursor:null,done:false};
  if(state.query!==query){state.query=query;state.cursor=null;state.done=false;state.mode=index%2?'media':'media-top';state.fallback=false;}
 }
 cursor.authors??={};
 for(const [actor] of [...new Set([...(preferences.followedAuthors??[]),...Object.keys(preferences.authors)])].filter(actor=>(actor.startsWith('x-user:')||/@(?:twitter|x)\.com$/i.test(actor))&&((preferences.authors[actor]??0)>0||preferences.followedAuthors?.includes(actor))&&!isRecommendationAuthorRejected(actor,preferences)).sort((a,b)=>Number(!!preferences.followedAuthors?.includes(b))-Number(!!preferences.followedAuthors?.includes(a))||(preferences.authors[b]??0)-(preferences.authors[a]??0)).map(actor=>[actor] as const))cursor.authors[actor]??={cursor:null,done:false};
 const authors=Object.entries(cursor.authors).filter(([actor,state])=>!Object.hasOwn(excludedAuthors,actor)&&!state.done&&!(state.retryAfter&&state.retryAfter>Date.now()));
 const pendingAuthors=()=>Object.entries(cursor.authors??{}).some(([actor,state])=>!Object.hasOwn(excludedAuthors,actor)&&!state.done);
 const pending=()=>Object.entries(cursor.positions).some(([term,state])=>terms.includes(term)&&!state.done)||pendingAuthors();
 const failed=(state:SourcePosition,error:unknown)=>{if(signal?.aborted)throw signal.reason;state.retryAfter=Date.now()+30000;return {attempted:true,state:cursor,posts:[],next:cursor,error:error instanceof Error?error:new Error('twitterを取得できませんでした')};};
 if(authors.length&&(cursor.round%2===0||!Object.values(cursor.positions).some(state=>!state.done))){
  const [actor,state]=authors[(cursor.authorRound??0)%authors.length];cursor.authorRound=(cursor.authorRound??0)+1;cursor.round++;
  let page:Awaited<ReturnType<typeof xFeed>>;
  const handle=(preferences.authorHandles?.[actor]??preferences.likedSamples?.find(post=>post.userId===actor)?.author.username??(!actor.startsWith('x-user:')?actor:'')).replace(/@(?:twitter|x)\.com$/i,'').replace(/^@/,'');
  try{
   // This selects an account, never matching a word in a post body.
   page=preferences.visualOnly&&/^[a-z0-9_]{1,15}$/i.test(handle)
    ?await searchXPage('from:'+handle,{cursor:state.cursor,feed:'media',signal,preferAlternative:true,limit:8})
    :await xFeed({actor,cursor:state.cursor,filter:'posts_with_media',limit:8,signal});
  }catch(error){return failed(state,error);}
  if(signal?.aborted)throw signal.reason;
  state.done=!page.cursor||page.cursor===state.cursor;state.cursor=page.cursor;
  const posts=page.posts.map(normalizeTimelineBlueskyPost).map(post=>({...post,recommendationAuthorTopics:[...new Set([...(post.recommendationAuthorTopics??[]),...Object.entries(preferences.authorTopics?.[actor]??{}).filter(([,weight])=>(weight??0)>0).map(([topic])=>topic)])],recommendationLanguages:preferences.authorLanguages?.[actor]}));
  return {attempted:true,state:cursor,posts:rankRecommendations(applyCachedRecommendationVisuals(posts),{...preferences,followedTopics:topics},viewer,Date.now(),[],8,false),next:pending()?cursor:undefined};
 }
 const active=Object.entries(cursor.positions).filter(([term,state])=>terms.includes(term)&&!state.done&&!(state.retryAfter&&state.retryAfter>Date.now()));
 if(!active.length)return {attempted:false,state:cursor,posts:[],next:pending()?cursor:undefined};
 const [term,state]=active[cursor.round++%active.length];
 const query=state.query!;
 let page:Awaited<ReturnType<typeof searchXPage>>;
 try{page=await searchXPage(query,{cursor:state.cursor,feed:state.mode??'media-top',signal,preferAlternative:true,limit:6});}catch(error){return failed(state,error);}
 if(signal?.aborted)throw signal.reason;
 const exhausted=!page.cursor||page.cursor===state.cursor;
 if(exhausted&&!state.fallback){state.fallback=true;state.mode=(state.mode??'media-top')==='media-top'?'media':'media-top';state.cursor=null;state.done=false;}
 else{state.done=exhausted;state.cursor=page.cursor;}
 const evidence=tags.get(term);
 const posts=page.posts.map(normalizeTimelineBlueskyPost).map(post=>{
  const learned=!!evidence&&evidence.works.size>=2&&new Set<string>(post.content.normalize('NFKC').match(/#[\p{L}\p{N}_]+/gu)??[]).has(term);
  return {...post,recommendationTopics:learned?[...new Set([...(post.recommendationTopics??[]),...evidence.topics])]:post.recommendationTopics,recommendationSources:[...(post.recommendationSources??[]),(learned?'twitter-interest:':'twitter-search:')+term]};
 });
 return {attempted:true,state:cursor,posts:rankRecommendations(applyCachedRecommendationVisuals(posts),{...preferences,followedTopics:topics},viewer,Date.now(),[],6,false),next:pending()?cursor:undefined};
}
