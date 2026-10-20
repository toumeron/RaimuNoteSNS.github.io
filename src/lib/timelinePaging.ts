import type { PostWithAuthor } from "@/types";
import type { BlueskyAuthorFeedPage } from "@/lib/bluesky";
import type { FeedCursor } from "@/api/posts";

const SOURCE_PAGE_SIZE = 10;
const TIMELINE_PAGE_SIZE = 20;

type SourceCursor = { done: boolean; posts: PostWithAuthor[] };
export type TimelineCursor = {
  lime: SourceCursor & { page: number; before?: FeedCursor };
  bluesky: Record<string, SourceCursor & { cursor: string | null }>;
};
export type TimelinePage = { posts: PostWithAuthor[]; next: TimelineCursor | undefined };
export type TimelineSources = {
  lime: (page: number, limit: number, before?: FeedCursor) => Promise<PostWithAuthor[]>;
  bluesky: (handle: string, cursor: string | null, limit: number) => Promise<BlueskyAuthorFeedPage>;
};

export function createTimelineCursor(handles: string[]): TimelineCursor {
  const twitter=(handle:string)=>/@(?:twitter|x)\.com$/i.test(handle)||handle.startsWith('x-user:');
  const pools=[handles.filter(twitter),handles.filter(handle=>!twitter(handle))];
  const ordered=Array.from({length:Math.max(0,...pools.map(pool=>pool.length))},(_,index)=>pools.flatMap(pool=>pool[index]?[pool[index]]:[])).flat();
  return {
    lime: { page: 0, done: false, posts: [] },
    bluesky: Object.fromEntries(ordered.map(handle => [handle, { cursor: null, done: false, posts: [] }])),
  };
}

export function normalizeTimelineBlueskyPost(post: BlueskyAuthorFeedPage['posts'][number]): PostWithAuthor {
  return {
    ...post,
    id: post.id, userId: post.userId, content: post.content, imageUrls: post.imageUrls,
    createdAt: post.createdAt, visibility: post.visibility,
    likedByMe: post.likedByMe, likesCount: post.likesCount, commentsCount: post.commentsCount,
    isBot: post.isBot,
    ...(post.is_bot !== undefined ? { is_bot: post.is_bot } : {}),
    repostsCount: post.externalDetails?.reposts??post.repostsCount??0, repostedByMe: false,
    author: {
      id: post.author.id, username: post.author.username, displayName: post.author.displayName,
      avatarUrl: post.author.avatarUrl, coverUrl: '', isOfficial: false, providerVerification: post.author.providerVerification,
      bio: post.author.bio, createdAt: post.author.createdAt,
    },
  };
}

const newestFirst = (a: PostWithAuthor, b: PostWithAuthor) =>
  Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id);

type SourceResult = Partial<SourceCursor> & {page?:number;before?:FeedCursor;cursor?:string|null};
type SourceRead = {settled:boolean;result?:SourceResult;error?:unknown;promise:Promise<void>};
const pendingReads=new WeakMap<SourceCursor,SourceRead>();
let activeAuthorReads=0;
const authorReads:Array<()=>void>=[];
function readAuthor<T>(load:()=>Promise<T>):Promise<T>{
 return new Promise((resolve,reject)=>{
  const start=()=>{
   activeAuthorReads++;
   void load().then(resolve,reject).finally(()=>{activeAuthorReads--;authorReads.shift()?.();});
  };
  if(activeAuthorReads<2)start();else authorReads.push(start);
 });
}
function sourceRead(state:SourceCursor,load:()=>Promise<SourceResult>):SourceRead{
 const existing=pendingReads.get(state);if(existing)return existing;
 const job={settled:false,promise:null as unknown as Promise<void>} as SourceRead;
 job.promise=load().then(result=>{job.result=result;},error=>{job.error=error;}).finally(()=>{job.settled=true;});
 pendingReads.set(state,job);return job;
}
export function watchTimelineSources(cursor:TimelineCursor,onReady:()=>void):()=>void{
 let active=true;
 const jobs=new Set([cursor.lime,...Object.values(cursor.bluesky)].map(state=>pendingReads.get(state)).filter((job):job is SourceRead=>!!job));
 for(const job of jobs)void job.promise.then(()=>{if(active)onReady();});
 return()=>{active=false;};
}
/** Publish already-started source responses without starting another page read. */
export function collectReadyTimelineSources(previous:TimelineCursor):TimelinePage|undefined{
 let changed=false;
 const posts:PostWithAuthor[]=[];
 const collect=<T extends SourceCursor>(old:T):T=>{
  const state={...old,posts:[...old.posts]},job=pendingReads.get(old);
  if(!job)return state;
  if(!job.settled){pendingReads.set(state,job);return state;}
  changed=true;
  if(job.error)return state; // Keep the original position for an ordinary retry.
  Object.assign(state,job.result,{posts:[]});
  posts.push(...(job.result?.posts??[]).filter(isTimelinePost));
  return state;
 };
 const lime=collect(previous.lime),bluesky=Object.fromEntries(Object.entries(previous.bluesky).map(([handle,state])=>[handle,collect(state)]));
 if(!changed)return undefined;
 const states=[lime,...Object.values(bluesky)];
 return {posts:posts.sort(newestFirst),next:states.some(state=>!state.done||state.posts.length)?{lime,bluesky}:undefined};
}
/** Keep slow reads for the next page without making ready posts wait for every account. */
export async function loadTimelinePage(previous: TimelineCursor, sources: TimelineSources): Promise<TimelinePage> {
 const started=Date.now();
 const copy=<T extends SourceCursor>(old:T):T=>{
  const state={...old,posts:[...old.posts]};
  const pending=pendingReads.get(old);if(pending&&!pending.error)pendingReads.set(state,pending);
  return state;
 };
 const lime=copy(previous.lime);
 const bluesky=Object.fromEntries(Object.entries(previous.bluesky).map(([handle,state])=>[handle,copy(state)]));
 const states=[lime,...Object.values(bluesky)],posts:PostWithAuthor[]=[],seen=new Set<string>();
 const reads=new Map<SourceCursor,number>(),failures=new Map<SourceCursor,unknown>();
 while(posts.length<TIMELINE_PAGE_SIZE){
  const missing=states.filter(state=>!state.done&&!state.posts.length);
  const jobs:Array<{state:SourceCursor;job:SourceRead}>=[];
  for(const state of missing){
   if(failures.has(state)||(reads.get(state)??0)>=2||Date.now()-started>=1000&&!pendingReads.has(state))continue;
   const existing=pendingReads.get(state);
   const job=sourceRead(state,()=>{
    if(state===lime)return sources.lime(lime.page,SOURCE_PAGE_SIZE,lime.before).then(rows=>{
     const ordered=[...rows].sort(newestFirst),oldest=ordered.at(-1);
     return {page:lime.page+1,done:rows.length<SOURCE_PAGE_SIZE,posts:ordered,...(oldest?{before:{createdAt:oldest.createdAt,id:oldest.id}}:{})};
    });
    const [handle,blue]=Object.entries(bluesky).find(([,value])=>value===state)!;
    return readAuthor(()=>sources.bluesky(handle,blue.cursor,SOURCE_PAGE_SIZE)).then(page=>{
     if(page.cursor&&page.cursor===blue.cursor)throw new Error(`Bluesky cursor did not advance for ${handle}`);
     return {cursor:page.cursor,done:!page.cursor,posts:page.posts.map(normalizeTimelineBlueskyPost).sort(newestFirst)};
    });
   });
   if(!existing)reads.set(state,(reads.get(state)??0)+1);
   jobs.push({state,job});
  }
  if(jobs.length){
   const remaining=1000-(Date.now()-started);
   let timer:ReturnType<typeof setTimeout>|undefined;
   try{if(remaining>0)await Promise.race([Promise.all(jobs.map(({job})=>job.promise)),new Promise<void>(resolve=>{timer=setTimeout(resolve,remaining);})]);}
   finally{clearTimeout(timer);}
   for(const {state,job} of jobs)if(job.settled){
    pendingReads.delete(state);
    if(job.error){failures.set(state,job.error);continue;}
    Object.assign(state,{...job.result,posts:[...(job.result?.posts??[])]});
   }
  }
  const available=states.filter(state=>state.posts.length);
  if(!available.length){
   if(jobs.some(({job})=>!job.settled)||missing.some(state=>(reads.get(state)??0)>=2)||Date.now()-started>=1000)break;
   if(states.some(state=>!state.done&&!failures.has(state)))continue;
   break;
  }
  // Fast sources retain chronological merging. After the display budget,
  // delayed accounts join later through their preserved, shared pending read.
  available.sort((a,b)=>newestFirst(a.posts[0],b.posts[0]));
  const post=available[0].posts.shift()!;
  if(seen.has(post.id)||!isTimelinePost(post))continue;
  seen.add(post.id);posts.push(post);
 }
 if(!posts.length&&failures.size&&!states.some(state=>pendingReads.has(state)||state.posts.length))throw failures.values().next().value;
 const hasMore=states.some(state=>!state.done||state.posts.length);
 return {posts,next:hasMore?{lime,bluesky}:undefined};
}

/** Replies stay on reply/profile screens. Quotes remain timeline posts. */
export function isTimelinePost(post:PostWithAuthor):boolean {
 return !post.replyId&&!post.replyPostId&&!post.externalReplyToId&&!(post.parentId&&!post.isQuote);
}
/** External discovery searches cannot prove that no matching posts exist. */
export function showTimelineEmpty(loading:boolean,fetching:boolean,error:boolean,count:number,tab?:string):boolean {
 return tab!=='recommended'&&tab!=='trending'&&!loading&&!fetching&&!error&&count===0;
}

/** Latest is LimeNote-only; a native quote may still contain an external parent. */
export function isLimeNoteTimelinePost(post:PostWithAuthor):boolean{
 return (!post.source||post.source==='lime')&&!/^(?:bsky:|misskey:|x:)/.test(post.id);
}
