import prototypes from './recommendationVisualPrototypes.json';
import type {PostWithAuthor} from '@/types';
import {isTopicId,type TopicId} from './topics';
import {privateMediaReference} from './privateMediaFetch';
export type RecommendationVisual={version:1;classifierVersion?:3;kind:string;topics:TopicId[];confidence:number;similarity:number;vector:number[]};
export function visualSimilarity(a:number[],b:number[]):number {
 if(a.length!==512||b.length!==512||a.some(value=>!Number.isFinite(value))||b.some(value=>!Number.isFinite(value)))return 0;
 const length=Math.hypot(...a)*Math.hypot(...b);
 return length?a.reduce((sum,value,i)=>sum+value*b[i],0)/length:0;
}
/** Reuse immutable vectors only within one synchronous scoring pass. */
export function createVisualSimilarityComparator(){
 const lengths=new WeakMap<number[],number>(),pairs=new WeakMap<number[],WeakMap<number[],number>>();
 const norm=(vector:number[])=>{
  const cached=lengths.get(vector);if(cached!==undefined)return cached;
  const length=vector.length===512&&vector.every(Number.isFinite)?Math.hypot(...vector):0;
  lengths.set(vector,length);return length;
 };
 return (a:number[],b:number[])=>{
  const old=pairs.get(a)?.get(b);if(old!==undefined)return old;
  const length=norm(a)*norm(b);let dot=0;
  if(length)for(let i=0;i<512;i++)dot+=a[i]*b[i];
  const score=length?dot/length:0;
  let values=pairs.get(a);if(!values){values=new WeakMap();pairs.set(a,values);}values.set(b,score);
  let inverse=pairs.get(b);if(!inverse){inverse=new WeakMap();pairs.set(b,inverse);}inverse.set(a,score);
  return score;
 };
}
const cache=new Map<string,RecommendationVisual>();
const cacheKey='lime_recommendation_visual_cache_v1';
let restored=false;
export function recommendationImageIdentity(url:string):string{
 url=privateMediaReference(url);
 try{const parsed=new URL(url);if(parsed.hostname==='cdn.bsky.app')return (parsed.pathname.split('/').at(-1)??url).split('@')[0];return parsed.origin+parsed.pathname;}catch{return url;}
}
export function readVisualCache(url:string):RecommendationVisual|undefined{
 if(!restored){restored=true;try{
  const rows=JSON.parse(localStorage.getItem(cacheKey)??'[]');
  for(const [key,result] of rows)if(typeof key==='string'&&result?.version===1&&typeof result.kind==='string'&&Array.isArray(result.topics)&&result.topics.every(isTopicId)&&Number.isFinite(result.confidence)&&Array.isArray(result.vector)&&result.vector.length===512&&result.vector.every(Number.isFinite))cache.set(key,classifyRecommendationVisual(result.vector));
 }catch{/* Public-media cache is optional. */}}
 return cache.get(recommendationImageIdentity(url));
}
export function writeVisualCache(url:string,result:RecommendationVisual):void{
 result={...result,classifierVersion:3};cache.set(recommendationImageIdentity(url),result);if(cache.size>150)cache.delete(cache.keys().next().value!);
 try{localStorage.setItem(cacheKey,JSON.stringify([...cache]));}catch{/* No private preferences depend on this cache. */}
}
/** Synchronous, small and model-free: never delay the first feed for inference. */
export function applyCachedRecommendationVisuals(posts:PostWithAuthor[],upgrade=false):PostWithAuthor[]{
 return posts.map(post=>{const previous=post.recommendationVisual??(post.imageUrls?.[0]?readVisualCache(post.imageUrls[0]):undefined);const visual=previous&&upgrade&&previous.classifierVersion!==3?classifyRecommendationVisual(previous.vector):previous;return visual?{...post,recommendationVisual:visual,recommendationVisualStatus:'checked'}:post;});
}
/** Classifier labels in storage may predate the current prototypes even when
 * their format version is unchanged. Restore from vectors, not saved labels. */
export function restoreRecommendationVisuals(posts:PostWithAuthor[]):PostWithAuthor[]{
 return posts.map(post=>{
  const vector=post.recommendationVisual?.vector;if(vector?.length!==512)return post;
  let visual=restoredVectors.get(vector);if(!visual){visual=classifyRecommendationVisual(vector);restoredVectors.set(vector,visual);}
  return {...post,recommendationVisual:visual};
 });
}
const restoredVectors=new WeakMap<number[],RecommendationVisual>();

/** Do not download an 85 MiB model while opening a timeline. */
export async function hasInstalledVisualModel():Promise<boolean>{
 try{
  if(typeof caches==='undefined'||!await caches.has('transformers-cache'))return false;
  const keys=await (await caches.open('transformers-cache')).keys();
  const urls=keys.map(key=>key.url).filter(url=>url.includes('/Xenova/clip-vit-base-patch32/'));
  return urls.some(url=>url.endsWith('/onnx/vision_model_quantized.onnx'))&&urls.some(url=>url.endsWith('/preprocessor_config.json'))&&urls.some(url=>url.endsWith('/config.json'));
 }catch{return false;}
}

/** Open-set classification: a nearest label is not evidence when all labels
 * are poor matches. Ambiguous media must not inherit a feed's full topic. */
const classificationPrototypes=prototypes.prototypes.map(row=>({...row,vectors:row.vectors.map(vector=>({vector,norm:Math.hypot(...vector)}))}));
export function classifyRecommendationVisual(vector:number[]):RecommendationVisual {
 const norm=vector.length===512&&vector.every(Number.isFinite)?Math.hypot(...vector):0;
 const ordered=classificationPrototypes.map(row=>({...row,similarity:Math.max(...row.vectors.map(prototype=>{
  if(!norm||!prototype.norm)return 0;
  let dot=0;for(let i=0;i<512;i++)dot+=vector[i]*prototype.vector[i];
  return dot/(norm*prototype.norm);
 }))})).sort((a,b)=>b.similarity-a.similarity);
 const first=ordered[0],margin=first.similarity-ordered[1].similarity;
 const confidence=first.similarity>=.24?Math.min(1,Math.max(0,margin)/.06):0;
 const certain=confidence>=.25;
 return {version:1,classifierVersion:3,kind:certain?first.id:'unknown',topics:certain?first.topics.filter(isTopicId):[],confidence,similarity:first.similarity,vector};
}

/** Subject requirements for user-selected topics, independent of captions and feed labels. */
export function visualMatchesRecommendationTopic(visual:RecommendationVisual,topic:TopicId):boolean {
 if(topic==='digital-illustration')return ['moe','male-character'].includes(visual.kind);
 if(topic==='anime')return ['moe','male-character','anime-screen'].includes(visual.kind);
 return visual.topics.includes(topic);
}
