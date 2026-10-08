import type {PostWithAuthor} from '@/types';
import {isTopicId,type TopicId} from './topics';
export type RecommendationVisual={version:1;kind:string;topics:TopicId[];confidence:number;similarity:number;vector:number[]};
export function visualSimilarity(a:number[],b:number[]):number {
 if(a.length!==512||b.length!==512||a.some(value=>!Number.isFinite(value))||b.some(value=>!Number.isFinite(value)))return 0;
 const length=Math.hypot(...a)*Math.hypot(...b);
 return length?a.reduce((sum,value,i)=>sum+value*b[i],0)/length:0;
}
const cache=new Map<string,RecommendationVisual>();
const cacheKey='lime_recommendation_visual_cache_v1';
let restored=false;
function imageKey(url:string):string{
 try{const parsed=new URL(url);if(parsed.hostname==='cdn.bsky.app')return (parsed.pathname.split('/').at(-1)??url).split('@')[0];return parsed.origin+parsed.pathname;}catch{return url;}
}
export function readVisualCache(url:string):RecommendationVisual|undefined{
 if(!restored){restored=true;try{
  const rows=JSON.parse(localStorage.getItem(cacheKey)??'[]');
  for(const [key,result] of rows)if(typeof key==='string'&&result?.version===1&&typeof result.kind==='string'&&Array.isArray(result.topics)&&result.topics.every(isTopicId)&&Number.isFinite(result.confidence)&&Array.isArray(result.vector)&&result.vector.length===512&&result.vector.every(Number.isFinite))cache.set(key,result);
 }catch{/* Public-media cache is optional. */}}
 return cache.get(imageKey(url));
}
export function writeVisualCache(url:string,result:RecommendationVisual):void{
 cache.set(imageKey(url),result);if(cache.size>150)cache.delete(cache.keys().next().value!);
 try{localStorage.setItem(cacheKey,JSON.stringify([...cache]));}catch{/* No private preferences depend on this cache. */}
}
/** Synchronous, small and model-free: never delay the first feed for inference. */
export function applyCachedRecommendationVisuals(posts:PostWithAuthor[]):PostWithAuthor[]{
 return posts.map(post=>{const visual=post.recommendationVisual??(post.imageUrls?.[0]?readVisualCache(post.imageUrls[0]):undefined);return visual?{...post,recommendationVisual:visual,recommendationVisualStatus:'checked'}:post;});
}

/** Do not download an 85 MiB model while opening a timeline. */
export async function hasInstalledVisualModel():Promise<boolean>{
 try{
  if(typeof caches==='undefined'||!await caches.has('transformers-cache'))return false;
  const keys=await (await caches.open('transformers-cache')).keys();
  const urls=keys.map(key=>key.url).filter(url=>url.includes('/Xenova/clip-vit-base-patch32/'));
  return urls.some(url=>url.endsWith('/onnx/vision_model_quantized.onnx'))&&urls.some(url=>url.endsWith('/preprocessor_config.json'))&&urls.some(url=>url.endsWith('/config.json'));
 }catch{return false;}
}
