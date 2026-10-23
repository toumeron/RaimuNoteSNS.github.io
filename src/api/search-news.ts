import { supabase } from "@/lib/supabase";
import { getPostById } from "@/api/posts";
import { type PostWithAuthor, type User } from "@/types/index";
import { searchXPage, xFeed } from "@/lib/fxTwitter";
import { TOPICS, type TopicPreferences, recommendationMatchesFollowedTopics, recommendationIsDismissed, isRecommendationAuthorRejected, rankRecommendations, rejectedRecommendationTopics, type RecommendationPreferences } from "@/lib/recommendations";
import { isTimelinePost, normalizeTimelineBlueskyPost, externalRead } from "@/lib/utils";
import { getRecommendationPreferences } from "@/api/recommendations";
import { type MarketRange, type MarketQuote } from "../../supabase/functions/market-data/http.ts";
import { applyCachedRecommendationVisuals } from "@/lib/recommendationVisual";

// search-news
type SearchNewsItem = {id: string; title: string; content: string; category: string; created_at: string; source?: 'limenote' | 'bluesky'; updated_at?: string; source_post_ids?: unknown; related_post_ids?: unknown; related_posts?: unknown};
type NewsSources = {authors: User[]; postsCount: number};
function sourceIds(news: SearchNewsItem): string[] {
  const refs = [news.related_post_ids, news.related_posts, news.source_post_ids].flatMap(value => Array.isArray(value) ? value : []);
  return [...new Set(refs.map(ref => typeof ref === 'string' ? ref : ref?.id).filter((id): id is string => typeof id === 'string' && !!id))];
}
async function getNewsSources(news: SearchNewsItem[]): Promise<Record<string, NewsSources>> {
  const ids = [...new Set(news.flatMap(sourceIds))];
  const authors = new Map<string, User>();
  let next = 0;
  // Fetch current originals, rather than trusting persisted snapshots of restricted posts.
  await Promise.all(Array.from({length: Math.min(4, ids.length)}, async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try { const post = await getPostById(id); if (post?.author) authors.set(id, post.author); } catch { /* Deleted or inaccessible sources have no avatar. */ }
    }
  }));
  return Object.fromEntries(news.map(item => {
    const visible = sourceIds(item).flatMap(id => authors.has(id) ? [authors.get(id)!] : []);
    return [item.id, {authors: [...new Map(visible.map(author => [author.id, author])).values()].slice(0, 3), postsCount: visible.length}];
  }));
}

function latestNewsPerSource(news: SearchNewsItem[]): SearchNewsItem[] {
  // Each source owns one slot; never replace missing LimeNote news with Bluesky.
  return ['limenote', 'bluesky'].flatMap(source => {
    const latest = news.filter(item => (item.source || 'limenote') === source)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
    return latest ? [latest] : [];
  });
}

/** Publish article and citation metadata together so late avatars cannot shift the row. */
async function getLatestSearchNews() {
  const results=await Promise.all(['limenote','bluesky'].map(source=>supabase
    .from('news_summaries').select('*').eq('source',source)
    .eq('public_sources_verified',true).order('created_at',{ascending:false}).limit(1)));
  const error=results.find(result=>result.error)?.error;
  if(error)throw error;
  const items:SearchNewsItem[]=results.flatMap(result=>result.data??[]);
  return {items,sources:await getNewsSources(latestNewsPerSource(items))};
}

async function getNewsStory(id: string | null): Promise<SearchNewsItem | null> {
  let query = supabase.from('news_summaries').select('*');
  if (id) query = query.eq('id', id);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

async function getNewsHistory(offset = 0): Promise<SearchNewsItem[]> {
  const { data, error } = await supabase.from('news_summaries').select('id,title,content,category,source,created_at')
    .order('created_at', { ascending: false }).range(offset, offset + 19);
  if (error) throw error;
  return data ?? [];
}

async function getNewsRelatedPosts(news: SearchNewsItem): Promise<PostWithAuthor[]> {
  const ids = sourceIds(news).slice(0, 30);
  const posts: PostWithAuthor[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try { const post = await getPostById(id); if (post) posts.push(post); }
      catch { /* Deleted or inaccessible originals must not use stale saved snapshots. */ }
    }
  }));
  return posts;
}

// twitter-trends
type Position={query:string;cursor:string|null;done:boolean};
type TwitterTrendCursor={round:number;positions:Position[];seen:string[];fallbackPositions?:Position[];fallbackRound?:number;remaining?:PostWithAuthor[]};
function shuffle<T>(rows:T[]):T[]{
 const result=[...rows];for(let i=result.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;
}
function createTwitterTrendCursor(preferences:TopicPreferences):TwitterTrendCursor{
 const available=TOPICS.filter(topic=>!preferences.dismissed.includes(topic.id));
 const position=(topic:typeof TOPICS[number]):Position=>({query:`(${topic.queries.join(' ')})`,cursor:null,done:false});
 return {round:0,positions:available.filter(topic=>preferences.followed.includes(topic.id)).map(position),
  fallbackPositions:shuffle(available.filter(topic=>!preferences.followed.includes(topic.id)).map(position)),fallbackRound:0,remaining:[],seen:[]};
}
/** Use topic searches in popular order without a minimum-like cutoff. When
 * topic candidates run short, rotate independent popular-topic searches.
 * No recommendation scores, interest inference or image model are involved. */
async function getTwitterTrendPage(previous:TwitterTrendCursor,signal?:AbortSignal,viewed:ReadonlySet<string>=new Set()):Promise<{posts:PostWithAuthor[];next?:TwitterTrendCursor}>{
 if(signal?.aborted)throw signal.reason;
 const state:TwitterTrendCursor={...previous,positions:previous.positions.map(position=>({...position})),fallbackPositions:(previous.fallbackPositions??[]).map(position=>({...position})),remaining:[...(previous.remaining??[])],seen:[...previous.seen]};
 const controller=new AbortController(),abort=()=>controller.abort(signal?.reason??new DOMException('Aborted','AbortError'));
 signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>controller.abort(new DOMException('Trend fetch deadline','TimeoutError')),25000);
 const cancelled=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true}));
 // A buffered page needs no race consumer, but cleanup still aborts the job.
 void cancelled.catch(()=>{});
 const seen=new Set(state.seen),candidateIds=new Set<string>();
 const eligible=(post:PostWithAuthor)=>post.source==='x'&&Number.isFinite(post.likesCount)&&post.likesCount>=0&&!post.externalRepostedBy&&!post.profileRepostedBy&&isTimelinePost(post)&&!seen.has(post.id)&&!viewed.has(post.id);
 const unique=(rows:PostWithAuthor[])=>rows.filter(post=>{if(!eligible(post)||candidateIds.has(post.id))return false;candidateIds.add(post.id);return true;});
 const byLikes=(a:PostWithAuthor,b:PostWithAuthor)=>b.likesCount-a.likesCount||Date.parse(b.createdAt)-Date.parse(a.createdAt);
 let lastError:unknown;
 const read=async(fallback:boolean)=>{
  const positions=fallback?state.fallbackPositions!:state.positions,active=positions.filter(position=>!position.done),round=fallback?state.fallbackRound??0:state.round;
  const selected=Array.from({length:Math.min(3,active.length)},(_,i)=>active[(round+i)%active.length]);
  if(fallback)state.fallbackRound=round+selected.length;else state.round+=selected.length;
  const results:PromiseSettledResult<PostWithAuthor[]>[]=selected.map(()=>({status:'rejected',reason:undefined}));
  let publishReady!:()=>void;const ready=new Promise<void>(resolve=>{publishReady=resolve;});
  const publishBatch=()=>{
   const ids=new Set(results.flatMap(result=>result.status==='fulfilled'?result.value.filter(eligible).map(post=>post.id):[]));
   if(ids.size>=6)publishReady();
  };
  const reads=selected.map(async(position,index)=>{
   try{
    const partial:PostWithAuthor[]=[];
    const page=await searchXPage(position.query,{cursor:position.cursor,feed:'top',preferAlternative:true,limit:6,signal:controller.signal,onPost:row=>{
     if(controller.signal.aborted)return;
     const post=normalizeTimelineBlueskyPost(row);partial.push(post);
     results[index]={status:'fulfilled',value:partial};
     publishBatch();
    }});
    // A reader finishing after the deadline must not mutate a returned cursor.
    if(controller.signal.aborted)return;
    position.done=!page.cursor||page.cursor===position.cursor;position.cursor=page.cursor;
    results[index]={status:'fulfilled',value:page.posts.map(normalizeTimelineBlueskyPost)};
    publishBatch();
   }catch(error){if(results[index].status!=='fulfilled')results[index]={status:'rejected',reason:error};}
  });
  try{await Promise.race([Promise.all(reads),ready,cancelled]);}
  catch(error){if(signal?.aborted)throw signal.reason;lastError=error;}
  if(signal?.aborted)throw signal.reason;
  results.forEach(result=>{if(result.status==='rejected'&&result.reason)lastError=result.reason;});
  return unique(results.flatMap(result=>result.status==='fulfilled'?result.value:[])).sort(byLikes);
 };
 try{
  const posts=unique(state.remaining!);state.remaining=[];
  if(!posts.length)posts.push(...await read(false));
  // A sparse topic page must not produce an empty screen while other public
  // popular sources have candidates. Sample from the highest-like candidates.
  if(!posts.length){
   let popular:PostWithAuthor[]=[];
   try{popular=await read(true);}catch(error){if(signal?.aborted)throw signal.reason;lastError=error;}
   posts.push(...popular);
  }
  if(!posts.length&&lastError)throw lastError;
  posts.sort(byLikes);state.remaining=posts.slice(20);
  const delivered=shuffle(posts.slice(0,20));delivered.forEach(post=>seen.add(post.id));state.seen=[...seen].slice(-10000);
  return {posts:delivered,next:state.remaining.length||[...state.positions,...state.fallbackPositions!].some(position=>!position.done)?state:undefined};
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
}

// twitter-videos
type TwitterVideosPosition={cursor:string|null;done:boolean};
type TwitterVideoCursor={authors:Record<string,TwitterVideosPosition>;topics:Record<string,TwitterVideosPosition>;round:number;popular?:TwitterVideosPosition;seen?:string[];preferences:Awaited<ReturnType<typeof getRecommendationPreferences>>};
/** Read metadata only; the lightbox downloads media for the active slide. */
async function getTwitterVideoPage(viewerId:string,previous?:TwitterVideoCursor,signal?:AbortSignal):Promise<{posts:PostWithAuthor[];nextCursor:TwitterVideoCursor|null}>{
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
 const choose=(positions:Record<string,TwitterVideosPosition>)=>{const entries=Object.entries(positions).filter(([,position])=>!position.done);return entries.length?entries[cursor.round%entries.length]:undefined;};
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

// marketData
export {MARKET_ASSETS,MARKET_RANGES,matchMarketAsset,suggestMarketAssets} from "./../../supabase/functions/market-data/http.ts";
export type {MarketAsset,MarketRange,MarketQuote,MarketPoint} from "./../../supabase/functions/market-data/http.ts";
async function getMarketQuote(symbol:string,range:MarketRange,signal?:AbortSignal):Promise<MarketQuote>{
 const url=new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/market-data`);
 url.search=new URLSearchParams({symbol,range}).toString();
 const response=await fetch(url,{signal});if(!response.ok)throw new Error('Market data unavailable');
 return response.json();
}
function formatMarketPrice(price:number,currency:string):string{
 return new Intl.NumberFormat('ja-JP',{style:'currency',currency:currency||'USD',minimumFractionDigits:currency==='JPY'?0:2,maximumFractionDigits:2}).format(price);
}

// twitterSearch
/** Translate LimeNote search conditions to the provider's search syntax. */
function twitterSearchQuery(p:{terms:string[];phrases:string[];orGroups:string[][];excludes:string[];from:string[];notFrom:string[];to?:string[];bareHandle:string|null;since:Date|null;until:Date|null;minLikes:number|null;maxLikes:number|null;minReposts:number|null;media:'any'|'image'|'video'|null;excludeImage:boolean;excludeVideo:boolean;hasLink:boolean;excludeLink:boolean}){
 const day=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
 const handle=(value:string)=>value.replace(/@(?:x|twitter)\.com$/i,'').replace(/^@/,'');
 const parts=[...p.terms.filter(term=>!(p.to??[]).some(name=>term.toLowerCase()===`@${name.toLowerCase()}`)),...p.phrases.map(value=>JSON.stringify(value)),...p.orGroups.map(group=>`(${group.join(' OR ')})`),...p.excludes.map(value=>`-${JSON.stringify(value)}`)];
 if(p.bareHandle)parts.push(`from:${handle(p.bareHandle)}`);
 if(p.from.length)parts.push(`(${p.from.map(value=>`from:${handle(value)}`).join(' OR ')})`);
 parts.push(...p.notFrom.map(value=>`-from:${handle(value)}`),...(p.to??[]).map(value=>`to:${handle(value)}`));
 if(p.since)parts.push(`since:${day(p.since)}`);
 if(p.until){const exclusive=new Date(p.until);exclusive.setDate(exclusive.getDate()+1);parts.push(`until:${day(exclusive)}`);}
 if(p.minLikes!==null)parts.push(`min_faves:${p.minLikes}`);
 if(p.maxLikes!==null)parts.push(`-min_faves:${p.maxLikes+1}`);
 if(p.minReposts!==null)parts.push(`min_retweets:${p.minReposts}`);
 if(p.media)parts.push(`filter:${p.media==='any'?'media':p.media==='image'?'images':'videos'}`);
 if(p.excludeImage)parts.push('-filter:images');if(p.excludeVideo)parts.push('-filter:videos');
 if(p.hasLink)parts.push('filter:links');if(p.excludeLink)parts.push('-filter:links');
 return parts.join(' ').trim();
}

// twitterSearchResults
/** Fill matching search results rather than counting IDs rejected by filters.
 * Read at most two source pages, retaining the last successful cursor on errors. */
async function searchTwitterResults(query:string,options:{cursor:string|null;feed:'top'|'latest'|'media';signal?:AbortSignal;matches:(post:PostWithAuthor)=>boolean;exclude?:ReadonlySet<string>;target?:number}){
 if(options.signal?.aborted)throw options.signal.reason;
 const posts:PostWithAuthor[]=[],seen=new Set(options.exclude),cursors=new Set<string|null>();
 let cursor=options.cursor,error:unknown=null;
 for(let read=0;read<2&&posts.length<(options.target??18);read++){
  if(cursors.has(cursor))break;cursors.add(cursor);
  try{
   const page=await searchXPage(query,{cursor,feed:options.feed,preferAlternative:true,limit:20,signal:options.signal});
   if(options.signal?.aborted)throw options.signal.reason;
   for(const row of page.posts){const post=normalizeTimelineBlueskyPost(row);if(seen.has(post.id)||!options.matches(post))continue;seen.add(post.id);posts.push(post);}
   cursor=page.cursor;
   if(!cursor||cursors.has(cursor)){cursor=null;break;}
  }catch(failure){if(options.signal?.aborted)throw options.signal.reason;error=failure;break;}
 }
 return {posts,cursor,error};
}

// searchProviderBatch
/** Preserve relevance order within each service while keeping twitter visible in all-source search. */
function searchProviderBatch(candidates:PostWithAuthor[],limit:number,mixed:boolean){
 const rows=[...new Map(candidates.map(post=>[post.id,post])).values()];
 if(!mixed)return {posts:rows.slice(0,limit),remaining:rows.slice(limit)};
 const isTwitter=(post:PostWithAuthor)=>post.source==='x'||post.id.startsWith('x:');
 const twitter=rows.filter(isTwitter),other=rows.filter(post=>!isTwitter(post));
 const count=Math.min(twitter.length,Math.max(Math.ceil(limit*.9),limit-other.length));
 const a=twitter.slice(0,count),b=other.slice(0,limit-a.length),posts:PostWithAuthor[]=[];
 const total=a.length+b.length;let x=0,y=0;
 for(let i=0;i<total;i++){if(x<Math.ceil((i+1)*a.length/total))posts.push(a[x++]);else posts.push(b[y++]);}
 const selected=new Set(posts.map(post=>post.id));
 return {posts,remaining:rows.filter(post=>!selected.has(post.id))};
}

// twitterSearchRelay
const twitterSearchCooldowns=new Map<string,number>();
const twitterSearchRateLimitError=()=>Object.assign(new Error('検索の取得先が一時的にアクセス制限中です。時間をおいて再試行してください。'),{name:'VideoSourceRateLimitError'});
async function relayTwitterSearch(query:string,feed:string,offset:number,signal?:AbortSignal,limit=6):Promise<{ids:string[];cursor:number|null}>{
 limit=Math.max(1,Math.min(20,Math.floor(limit)||6));
 const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('twitterの代替検索にはLimeNoteへのログインが必要です');
 if((twitterSearchCooldowns.get(session.user.id)??0)>Date.now())throw twitterSearchRateLimitError();
 const result=await externalRead(()=>supabase.functions.invoke('link-preview',{body:{mode:'twitter-search',query,feed,offset,...(limit!==6?{limit}:{})},signal}),signal,'interactive');
 const response=result.error?.context;
 if(response instanceof Response&&response.status===429){
  const seconds=Math.max(1,Number(response.headers.get('retry-after'))||300);
  twitterSearchCooldowns.set(session.user.id,Date.now()+seconds*1000);throw twitterSearchRateLimitError();
 }
 if(result.error||!Array.isArray(result.data?.ids))throw new Error('twitterの検索結果を取得できませんでした');
 return {ids:result.data.ids.filter((id:unknown):id is string=>typeof id==='string'&&/^\d{2,20}$/.test(id)).slice(0,limit),cursor:Number.isInteger(result.data.cursor)&&result.data.cursor>offset?result.data.cursor:null};
}

// blueskySearchRelay
async function relayBlueskySearch(endpoint:string,params:URLSearchParams,signal?:AbortSignal):Promise<Response|null>{
 const {data:{session}}=await supabase.auth.getSession();
 if(!session)return null;
 const result=await externalRead(()=>supabase.functions.invoke('link-preview',{body:{mode:'bluesky',endpoint,params:Object.fromEntries(params)},signal}),signal,'interactive');
 if(result.error||!result.data||!Object.prototype.hasOwnProperty.call(result.data,'data'))throw new Error('Bluesky検索を取得できませんでした');
 return new Response(JSON.stringify(result.data.data),{status:200,headers:{'Content-Type':'application/json'}});
}

export { sourceIds };
export { getNewsSources };
export { latestNewsPerSource };
export { getLatestSearchNews };
export { getNewsStory };
export { getNewsHistory };
export { getNewsRelatedPosts };
export type { SearchNewsItem };
export type { NewsSources };
export { createTwitterTrendCursor };
export { getTwitterTrendPage };
export type { TwitterTrendCursor };
export { getTwitterVideoPage };
export type { TwitterVideoCursor };
export { getMarketQuote };
export { formatMarketPrice };
export { twitterSearchQuery };
export { searchTwitterResults };
export { searchProviderBatch };
export { relayTwitterSearch };
export { relayBlueskySearch };


// recommendation-twitter
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
