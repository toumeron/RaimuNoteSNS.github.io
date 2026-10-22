import { type PostWithAuthor } from "@/types/index";
import { type TopicId } from "@/lib/recommendations";
import { classifyRecommendationVisual, readVisualCache, writeVisualCache, recommendationImageIdentity, type RecommendationVisual } from "@/lib/recommendationVisual";
import { isDeferredPrivateMedia, resolvePrivateMediaUrl, retainPrivateMediaUrl } from "@/lib/privateMediaFetch";
import { isInstalledPwa } from "@/lib/utils";

// recommendationVisualQueue
/** Fetch a few images concurrently, but keep the model and decoded pixels serial. */
function createRecommendationVisualQueue<Context,Input,Prepared,Output>(options:{
 load:()=>Promise<Context>;
 prepare:(input:Input)=>Promise<Prepared>;
 infer:(context:Context,prepared:Prepared,input:Input)=>Promise<Output>;
 capacity?:number;
}){
 const capacity=options.capacity??3;
 let active=0,tail:Promise<unknown>=Promise.resolve();
 const waiting:Array<()=>void>=[];
 const acquire=()=>new Promise<void>(resolve=>{
  const start=()=>{active++;resolve();};
  if(active<capacity)start();else waiting.push(start);
 });
 return async(input:Input):Promise<Output>=>{
  await acquire();
  try{
   // Model initialization and image/PDS reads do not depend on each other.
   const [context,prepared]=await Promise.all([options.load(),options.prepare(input)]);
   const result=tail.then(()=>options.infer(context,prepared,input));
   tail=result.catch(()=>{});
   return await result;
  }finally{active--;waiting.shift()?.();}
 };
}

// recommendationImageInput
/** CLIP reads 224 px. Fetching multi-megabyte originals adds no useful detail. */
function recommendationThumbnailUrl(raw:string):string|null{
 try{
  const url=new URL(raw);
  if(url.protocol!=='https:')return null;
  if(url.hostname==='cdn.bsky.app'&&/^\/img\/feed_(fullsize|thumbnail)\/plain\//.test(url.pathname)){
   url.pathname=url.pathname.replace('/feed_fullsize/','/feed_thumbnail/');return url.href;
  }
  if(url.hostname==='pbs.twimg.com'&&url.pathname.startsWith('/media/')){url.searchParams.set('name','small');return url.href;}
 }catch{/* Other media keep their existing reader. */}
 return null;
}

/** Public pixels never consume the URL-preview/search quota. The worker reads
 * Bluesky blobs from the creator's public PDS when the CDN lacks CORS. */
async function prepareRecommendationImage(raw:string,signal?:AbortSignal):Promise<{url:string;release:()=>void}>{
 if(signal?.aborted)throw signal.reason;
 return {url:recommendationThumbnailUrl(raw)??raw,release:()=>{}};
}

// recommendationVisualInference
export {classifyRecommendationVisual} from './recommendationVisual';

let worker:Worker|undefined;
let idleTimer:ReturnType<typeof setTimeout>|undefined;
function idleRecommendationVisualWorker(){clearTimeout(idleTimer);if(isInstalledPwa()&&document.hidden){releaseRecommendationVisualWorker();return;}idleTimer=setTimeout(releaseRecommendationVisualWorker,120000);}
function warmRecommendationVisualWorker(){if(typeof Worker==='undefined'||isInstalledPwa()&&document.hidden)return;visualWorker().postMessage({warm:true});idleRecommendationVisualWorker();}
// A failed public image must not be fetched again on every scroll page.
const unavailableUntil=new Map<string,number>();
const FAILURE_COOLDOWN=60_000;
let nextId=0;
const pending=new Map<number,{resolve:(vector:number[])=>void;reject:(error:Error)=>void}>();
const releaseHiddenWorker=()=>{if(isInstalledPwa()&&document.hidden)releaseRecommendationVisualWorker();};
/** Release the WASM heap and model after a bounded analysis job. */
function releaseRecommendationVisualWorker(){
 clearTimeout(idleTimer);
 if(pending.size)return;
 worker?.terminate();worker=undefined;
 document.removeEventListener('visibilitychange',releaseHiddenWorker);
}
function visualWorker():Worker {
 clearTimeout(idleTimer);
 if(worker)return worker;
 worker=new Worker(new URL('./recommendationVisual.worker.ts',import.meta.url),{type:'module'});
 document.addEventListener('visibilitychange',releaseHiddenWorker);
 worker.onmessage=({data}:{data:{id:number;vector?:number[];error?:string}})=>{
  const request=pending.get(data.id);if(!request)return;pending.delete(data.id);
  if(data.vector)request.resolve(data.vector);else request.reject(new Error(data.error??'Image analysis unavailable'));
  releaseHiddenWorker();
 };
 worker.onerror=()=>{for(const request of pending.values())request.reject(new Error('Image analysis unavailable'));pending.clear();releaseRecommendationVisualWorker();};
 return worker;
}
async function analyze(url:string,signal?:AbortSignal):Promise<RecommendationVisual> {
 if(signal?.aborted)throw signal.reason;
 const cached=readVisualCache(url);if(cached)return cached;
 const identity=recommendationImageIdentity(url);
 if((unavailableUntil.get(identity)??0)>Date.now())throw new Error('Image unavailable');
 const id=nextId++;
 const imageUrl=isDeferredPrivateMedia(url)?await resolvePrivateMediaUrl(url):url;
 if(signal?.aborted)throw signal.reason;
 if(!imageUrl)throw new Error('Image unavailable');
 const prepared=recommendationThumbnailUrl(imageUrl)?await prepareRecommendationImage(imageUrl,signal):{url:imageUrl,release:()=>{}};
 const releasePrivate=retainPrivateMediaUrl(imageUrl);
 try{
 if(signal?.aborted)throw signal.reason;
 const vector=await new Promise<number[]>((resolve,reject)=>{
  const cancel=()=>{pending.delete(id);reject(signal?.reason??new DOMException('Aborted','AbortError'));worker?.postMessage({cancel:id});if(!pending.size)idleRecommendationVisualWorker();};
  signal?.addEventListener('abort',cancel,{once:true});
  const finish=<T>(fn:(value:T)=>void)=>(value:T)=>{signal?.removeEventListener('abort',cancel);fn(value);};
  pending.set(id,{resolve:finish(resolve),reject:finish(reject)});
  try{visualWorker().postMessage({id,url:prepared.url});}catch(error){pending.delete(id);signal?.removeEventListener('abort',cancel);reject(error);}
 });
 const result=classifyRecommendationVisual(vector);
 writeVisualCache(url,result);unavailableUntil.delete(identity);
 return result;
 }catch(error){
  if(!signal?.aborted){unavailableUntil.set(identity,Date.now()+FAILURE_COOLDOWN);if(unavailableUntil.size>512)unavailableUntil.delete(unavailableUntil.keys().next().value!);}
  throw error;
 }finally{prepared.release();releasePrivate();}
}
/** Only on a requested feed page, in a worker. No upload of image pixels,
 * server inference, paid API, background loop or database is used. */
async function enrichRecommendationVisuals(posts:PostWithAuthor[],followed:TopicId[],signal?:AbortSignal,onChecked?:(post:PostWithAuthor)=>void,budget=32):Promise<PostWithAuthor[]> {
 if(typeof Worker==='undefined'){const rows=posts.map(post=>post.imageUrls.length&&!post.recommendationVisual?{...post,recommendationVisualStatus:'unavailable' as const}:post);rows.forEach(post=>onChecked?.(post));return rows;}
 const rows=posts.map(post=>({...post}));
 // Round-robin sources prevents a large feed from consuming the image budget.
 const pools=new Map<string,PostWithAuthor[]>();
 const priority=(post:PostWithAuthor)=>post.recommendationTopics?.some(topic=>followed.includes(topic as TopicId))?2:post.recommendationAuthorTopics?.some(topic=>followed.includes(topic as TopicId))?1:0;
 for(const post of [...rows].sort((a,b)=>priority(b)-priority(a))){
  if(!post.imageUrls.length||post.recommendationVisual)continue;
  const key=post.recommendationSources?.[0]??`author:${post.userId}`;
  const pool=pools.get(key)??[];pool.push(post);pools.set(key,pool);
 }
 const selected:PostWithAuthor[]=[];
 for(const level of [2,1,0]){
  const group=[...pools.values()].filter(pool=>pool.length&&priority(pool[0])===level);
  while(selected.length<budget&&group.some(pool=>pool.length))for(const pool of group){
   if(selected.length>=budget)break;const post=pool.shift();if(post)selected.push(post);
  }
 }
 let next=0;
 const images=new Map<string,Promise<RecommendationVisual>>();
 await Promise.all(Array.from({length:Math.min(8,selected.length)},async()=>{
  while(next<selected.length){
   const post=selected[next++];
   if(signal?.aborted)throw signal.reason;
   try{
    const url=post.imageUrls[0];let result=images.get(url);
    if(!result){result=analyze(url,signal);images.set(url,result);}
    post.recommendationVisual=await result;post.recommendationVisualStatus='checked';
   }catch(error){if(signal?.aborted)throw error;post.recommendationVisualStatus='unavailable';}
   onChecked?.(post);
  }
 }));
 // Digital artwork requires positive visual evidence; an unexamined image
 // cannot be certified as character artwork by a tag or a source alone.
 return rows;
}

export { idleRecommendationVisualWorker };
export { warmRecommendationVisualWorker };
export { releaseRecommendationVisualWorker };
export { enrichRecommendationVisuals };
export { createRecommendationVisualQueue };
export { recommendationThumbnailUrl };
export { prepareRecommendationImage };
