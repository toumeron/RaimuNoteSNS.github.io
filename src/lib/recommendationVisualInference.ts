import type {PostWithAuthor} from '@/types';
import prototypes from './recommendationVisualPrototypes.json';
import {isTopicId,type TopicId} from './topics';
import {visualSimilarity,readVisualCache,writeVisualCache,type RecommendationVisual} from './recommendationVisual';

/** Open-set classification: a nearest label is not evidence when all labels
 * are poor matches. Ambiguous media must not inherit a feed's full topic. */
export function classifyRecommendationVisual(vector:number[]):RecommendationVisual {
 const ordered=prototypes.prototypes.map(row=>({...row,similarity:Math.max(...row.vectors.map(prototype=>visualSimilarity(vector,prototype)))})).sort((a,b)=>b.similarity-a.similarity);
 const first=ordered[0],margin=first.similarity-ordered[1].similarity;
 const confidence=first.similarity>=.24?Math.min(1,Math.max(0,margin)/.06):0;
 const certain=confidence>=.25;
 return {version:1,kind:certain?first.id:'unknown',topics:certain?first.topics.filter(isTopicId):[],confidence,similarity:first.similarity,vector};
}

let worker:Worker|undefined;
let nextId=0;
const pending=new Map<number,{resolve:(vector:number[])=>void;reject:(error:Error)=>void}>();
/** Release the WASM heap and model after a bounded analysis job. */
export function releaseRecommendationVisualWorker(){
 if(pending.size)return;
 worker?.terminate();worker=undefined;
}
function visualWorker():Worker {
 if(worker)return worker;
 worker=new Worker(new URL('./recommendationVisual.worker.ts',import.meta.url),{type:'module'});
 worker.onmessage=({data}:{data:{id:number;vector?:number[];error?:string}})=>{
  const request=pending.get(data.id);if(!request)return;pending.delete(data.id);
  if(data.vector)request.resolve(data.vector);else request.reject(new Error(data.error??'Image analysis unavailable'));
 };
 worker.onerror=()=>{for(const request of pending.values())request.reject(new Error('Image analysis unavailable'));pending.clear();worker?.terminate();worker=undefined;};
 return worker;
}
async function analyze(url:string,signal?:AbortSignal):Promise<RecommendationVisual> {
 if(signal?.aborted)throw signal.reason;
 const cached=readVisualCache(url);if(cached)return cached;
 const id=nextId++;
 const vector=await new Promise<number[]>((resolve,reject)=>{
  const cancel=()=>{pending.delete(id);reject(signal?.reason??new DOMException('Aborted','AbortError'));worker?.postMessage({cancel:id});if(!pending.size){worker?.terminate();worker=undefined;}};
  signal?.addEventListener('abort',cancel,{once:true});
  const finish=<T>(fn:(value:T)=>void)=>(value:T)=>{signal?.removeEventListener('abort',cancel);fn(value);};
  pending.set(id,{resolve:finish(resolve),reject:finish(reject)});
  try{visualWorker().postMessage({id,url});}catch(error){pending.delete(id);signal?.removeEventListener('abort',cancel);reject(error);}
 });
 const result=classifyRecommendationVisual(vector);
 writeVisualCache(url,result);
 return result;
}
/** Only on a requested feed page, in a worker. No upload of image pixels,
 * server inference, paid API, background loop or database is used. */
export async function enrichRecommendationVisuals(posts:PostWithAuthor[],followed:TopicId[],signal?:AbortSignal,onChecked?:(post:PostWithAuthor)=>void,budget=32):Promise<PostWithAuthor[]> {
 if(!followed.length)return posts;
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
 for(const post of selected){
  if(signal?.aborted)throw signal.reason;
  try{post.recommendationVisual=await analyze(post.imageUrls[0],signal);post.recommendationVisualStatus='checked';}
  catch(error){if(signal?.aborted)throw error;post.recommendationVisualStatus='unavailable';}
  onChecked?.(post);
 }
 // Digital artwork requires positive visual evidence; an unexamined image
 // cannot be certified as character artwork by a tag or a source alone.
 return rows;
}
