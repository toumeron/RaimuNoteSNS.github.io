import type {PostWithAuthor} from '@/types';
import {classifyRecommendationVisual,recommendationImageIdentity} from './recommendationVisual';

export const RECOMMENDATION_CATALOG_VERSION=1;
export const RECOMMENDATION_CATALOG_MAX_AGE=2*60*60*1000;
type Catalog={version:number;generatedAt:string;model:string;revision:string;posts:PostWithAuthor[]};
const model='Xenova/clip-vit-base-patch32';
const revision='d15189d7028b43f1d3e65039190477f6af591c2a';
<<<<<<< HEAD
let cached:{expires:number;posts:PostWithAuthor[]}|undefined;
let pending:Promise<PostWithAuthor[]>|undefined;
=======
let cached:{expires:number;validUntil:number;posts:PostWithAuthor[]}|undefined;
let pending:Promise<PostWithAuthor[]>|undefined;
let bootstrapRead=false;
>>>>>>> 374490cc (“update23”)

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
<<<<<<< HEAD
export function parseRecommendationCatalog(value:unknown,now=Date.now()):PostWithAuthor[]{
 if(!value||typeof value!=='object')return [];
 const input=value as Catalog;
 const age=now-Date.parse(input.generatedAt);
 if(input.version!==RECOMMENDATION_CATALOG_VERSION||input.model!==model||input.revision!==revision||!Number.isFinite(age)||age< -60000||age>RECOMMENDATION_CATALOG_MAX_AGE||!Array.isArray(input.posts)||input.posts.length>1000)return [];
=======
export function parseRecommendationCatalog(value:unknown,now=Date.now(),maxAge=RECOMMENDATION_CATALOG_MAX_AGE):PostWithAuthor[]{
 if(!value||typeof value!=='object')return [];
 const input=value as Catalog;
 const age=now-Date.parse(input.generatedAt);
 if(input.version!==RECOMMENDATION_CATALOG_VERSION||input.model!==model||input.revision!==revision||!Number.isFinite(age)||age< -60000||age>maxAge||!Array.isArray(input.posts)||input.posts.length>1000)return [];
>>>>>>> 374490cc (“update23”)
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
<<<<<<< HEAD
 if(cached&&cached.expires>Date.now())return cached.posts;
=======
 if(cached&&cached.validUntil>Date.now()){
  if(cached.expires<=Date.now()){
   cached.expires=Date.now()+60000;
   pending??=loadCatalog(url,5000).finally(()=>{pending=undefined;});
  }
  return cached.posts;
 }
 if(!bootstrapRead){
  bootstrapRead=true;
  // Public pixels are analysed during the build. This is a source catalog,
  // not a saved user's timeline; all personal quality gates still run below.
  // Keep a bounded offline fallback while the hourly public snapshot refreshes.
  const raw=import.meta.env.VITE_RECOMMENDATION_BOOTSTRAP;
  let bootstrap:unknown;try{bootstrap=typeof raw==='string'?JSON.parse(raw):raw;}catch{/* Ignore an invalid build artifact. */}
  const posts=parseRecommendationCatalog(bootstrap,Date.now(),7*24*60*60*1000);
  if(posts.length){
   cached={posts,expires:Date.now()+60000,validUntil:Date.parse((bootstrap as Catalog).generatedAt)+7*24*60*60*1000};
   pending??=loadCatalog(url,5000).finally(()=>{pending=undefined;});
   return posts;
  }
 }
>>>>>>> 374490cc (“update23”)
 const job=pending??=loadCatalog(url).finally(()=>{pending=undefined;});
 if(!signal)return job;
 let abort:()=>void;
 const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
 try{return await Promise.race([job,cancelled]);}
 finally{signal.removeEventListener('abort',abort!);}
}
<<<<<<< HEAD
async function loadCatalog(url:string):Promise<PostWithAuthor[]>{
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),400);
=======
async function loadCatalog(url:string,timeout=400):Promise<PostWithAuthor[]>{
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeout);
>>>>>>> 374490cc (“update23”)
 try{
  const response=await fetch(url,{credentials:'omit',signal:controller.signal,referrerPolicy:'no-referrer'});
  if(!response.ok||Number(response.headers.get('content-length'))>8*1024*1024)return [];
  const text=await response.text();if(text.length>8*1024*1024)return [];
  const input=JSON.parse(text),posts=parseRecommendationCatalog(input);
<<<<<<< HEAD
  cached={posts,expires:Math.min(Date.now()+60000,Date.parse(input?.generatedAt)+RECOMMENDATION_CATALOG_MAX_AGE)};
=======
  if(!posts.length)return [];
  cached={posts,validUntil:Date.parse(input.generatedAt)+7*24*60*60*1000,expires:Math.min(Date.now()+60000,Date.parse(input?.generatedAt)+RECOMMENDATION_CATALOG_MAX_AGE)};
>>>>>>> 374490cc (“update23”)
  return posts;
 }catch{return [];}
 finally{clearTimeout(timer);}
}
