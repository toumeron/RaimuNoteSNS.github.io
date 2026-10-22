import prototypes from './recommendationVisualClassifierData.json';
import type {PostWithAuthor} from '@/types';
import {isTopicId,type TopicId} from "@/lib/recommendations";
import {privateMediaReference} from './privateMediaFetch';
import {isInstalledPwa} from './utils';
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
const unclassified=new Set<string>();
export function recommendationImageIdentity(url:string):string{
 url=privateMediaReference(url);
 try{const parsed=new URL(url);if(parsed.hostname==='cdn.bsky.app')return (parsed.pathname.split('/').at(-1)??url).split('@')[0];return parsed.origin+parsed.pathname;}catch{return url;}
}
function restoreVisualCache(){
 if(!restored){restored=true;try{
  const rows=JSON.parse(localStorage.getItem(cacheKey)??'[]');
  if(!Array.isArray(rows))return;
  for(const row of rows.slice(-150)){
   if(!Array.isArray(row))continue;
   const [key,result]=row;
   if(typeof key==='string'&&result?.version===1&&typeof result.kind==='string'&&Array.isArray(result.topics)&&result.topics.every(isTopicId)&&Number.isFinite(result.confidence)&&Array.isArray(result.vector)&&result.vector.length===512&&result.vector.every(Number.isFinite)){cache.set(key,result);unclassified.add(key);}
  }
 }catch{/* Public-media cache is optional. */}}
}
export function readVisualCache(url:string):RecommendationVisual|undefined{
 restoreVisualCache();
 const key=recommendationImageIdentity(url),value=cache.get(key);
 if(value&&unclassified.delete(key)){const classified=classifyRecommendationVisual(value.vector);cache.set(key,classified);return classified;}
 return value;
}
let dirty=false,saveTimer:ReturnType<typeof setTimeout>|undefined,idleSave:number|undefined;
const flushHidden=()=>{if(document.hidden)flushVisualCache();};
export function flushVisualCache(){
 clearTimeout(saveTimer);saveTimer=undefined;
 if(typeof window!=='undefined'){
  if(idleSave!==undefined){window.cancelIdleCallback?.(idleSave);idleSave=undefined;}
  window.removeEventListener('pagehide',flushVisualCache);document.removeEventListener('visibilitychange',flushHidden);
 }
 if(!dirty)return;dirty=false;
 try{localStorage.setItem(cacheKey,JSON.stringify([...cache]));}catch{/* Public-media cache is optional. */}
}
function saveVisualCache(){
 dirty=true;
 if(!isInstalledPwa()||document.hidden){flushVisualCache();return;}
 if(saveTimer!==undefined||idleSave!==undefined)return;
 window.addEventListener('pagehide',flushVisualCache);document.addEventListener('visibilitychange',flushHidden);
 saveTimer=setTimeout(()=>{saveTimer=undefined;if(typeof window.requestIdleCallback==='function')idleSave=window.requestIdleCallback(()=>{idleSave=undefined;flushVisualCache();},{timeout:1000});else flushVisualCache();},250);
}
export function writeVisualCache(url:string,result:RecommendationVisual):void{
 restoreVisualCache();
 const key=recommendationImageIdentity(url);result={...result,classifierVersion:3};cache.set(key,result);unclassified.delete(key);
 if(cache.size>150){const oldest=cache.keys().next().value!;cache.delete(oldest);unclassified.delete(oldest);}
 saveVisualCache();
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
