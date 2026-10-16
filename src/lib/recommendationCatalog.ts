import type {PostWithAuthor} from '@/types';
import {classifyRecommendationVisual,recommendationImageIdentity} from './recommendationVisual';

export const RECOMMENDATION_CATALOG_VERSION=1;
export const RECOMMENDATION_CATALOG_MAX_AGE=2*60*60*1000;
type Catalog={version:number;generatedAt:string;model:string;revision:string;posts:PostWithAuthor[]};
const model='Xenova/clip-vit-base-patch32';
const revision='d15189d7028b43f1d3e65039190477f6af591c2a';
let cached:{expires:number;posts:PostWithAuthor[]}|undefined;
let pending:Promise<PostWithAuthor[]>|undefined;

/** Restore reference and candidate vectors only for the same immutable image.
 * A matching author or caption is never sufficient evidence. */
export function applyCatalogRecommendationVisuals(posts:PostWithAuthor[],catalog:PostWithAuthor[]):PostWithAuthor[]{
 const visuals=new Map(catalog.filter(post=>post.imageUrls[0]&&post.recommendationVisual).map(post=>[recommendationImageIdentity(post.imageUrls[0]),post.recommendationVisual!]));
 return posts.map(post=>{
  const visual=!post.recommendationVisual&&post.imageUrls[0]?visuals.get(recommendationImageIdentity(post.imageUrls[0])):undefined;
  return visual?{...post,recommendationVisual:visual,recommendationVisualStatus:'checked'}:post;
 });
}

/** Only public, already analysed candidates belong in the shared catalog.
 * Personal interests, likes and dismissals are applied locally by the ranker. */
export function parseRecommendationCatalog(value:unknown,now=Date.now()):PostWithAuthor[]{
 if(!value||typeof value!=='object')return [];
 const input=value as Catalog;
 const age=now-Date.parse(input.generatedAt);
 if(input.version!==RECOMMENDATION_CATALOG_VERSION||input.model!==model||input.revision!==revision||!Number.isFinite(age)||age< -60000||age>RECOMMENDATION_CATALOG_MAX_AGE||!Array.isArray(input.posts)||input.posts.length>1000)return [];
 const ids=new Set<string>();
 return input.posts.filter(post=>{
  const visual=post?.recommendationVisual;
  if(!post||typeof post.id!=='string'||ids.has(post.id)||typeof post.userId!=='string'||post.author?.id!==post.userId||typeof post.author?.username!=='string'||post.visibility!=='public'||!['x','bluesky','misskey'].includes(post.source??'')||typeof post.content!=='string'||!Number.isFinite(Date.parse(post.createdAt))||!Array.isArray(post.imageUrls)||!post.imageUrls.length||!post.imageUrls.every(url=>{try{return new URL(url).protocol==='https:';}catch{return false;}})||!visual||visual.version!==1||!Array.isArray(visual.vector)||visual.vector.length!==512||!visual.vector.every(Number.isFinite))return false;
  // Reclassify with the application prototypes instead of trusting labels in
  // a shared artifact. No caption or feed label can certify an image.
  ids.add(post.id);return true;
 }).map(post=>({...post,likedByMe:false,repostedByMe:false,recommendationVisual:classifyRecommendationVisual(post.recommendationVisual!.vector),recommendationVisualStatus:'checked'}));
}

/** A bounded public read; never download the image model to read this catalog. */
export async function readRecommendationCatalog(signal?:AbortSignal):Promise<PostWithAuthor[]>{
 if(signal?.aborted)throw signal.reason;
 const url=import.meta.env.VITE_RECOMMENDATION_CATALOG_URL;
 if(!url)return [];
 if(cached&&cached.expires>Date.now())return cached.posts;
 const job=pending??=loadCatalog(url).finally(()=>{pending=undefined;});
 if(!signal)return job;
 let abort:()=>void;
 const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
 try{return await Promise.race([job,cancelled]);}
 finally{signal.removeEventListener('abort',abort!);}
}
async function loadCatalog(url:string):Promise<PostWithAuthor[]>{
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),400);
 try{
  const response=await fetch(url,{credentials:'omit',signal:controller.signal,referrerPolicy:'no-referrer'});
  if(!response.ok||Number(response.headers.get('content-length'))>8*1024*1024)return [];
  const text=await response.text();if(text.length>8*1024*1024)return [];
  const input=JSON.parse(text),posts=parseRecommendationCatalog(input);
  cached={posts,expires:Math.min(Date.now()+60000,Date.parse(input?.generatedAt)+RECOMMENDATION_CATALOG_MAX_AGE)};
  return posts;
 }catch{return [];}
 finally{clearTimeout(timer);}
}
