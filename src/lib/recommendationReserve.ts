import type {getBalancedRecommendationPage} from '@/api/balanced-recommendations';
type Page=Awaited<ReturnType<typeof getBalancedRecommendationPage>>;
const KEY='lime-recommendation-reserve-v1';
const MAX_AGE=120_000;
/** Only an unconsumed, accepted reserve is persisted, scoped to the active account and sources. */
export function readRecommendationReserve(scope:string):Page|undefined{
 try{
  const entry=JSON.parse(sessionStorage.getItem(KEY)??'null');
  if(!entry||entry.scope!==scope||Date.now()-entry.at>MAX_AGE||Date.now()<entry.at)return;
  const page=entry.page;
  if(!Array.isArray(page?.posts)||page.posts.length<20||!page.preferences?.authors||!page.preferences?.terms)return;
  if(!page.posts.every((post:any)=>typeof post.id==='string'&&typeof post.userId==='string'&&post.author&&Array.isArray(post.imageUrls)))return;
  if(page.next&&(!Array.isArray(page.next.remaining)||!Array.isArray(page.next.seen)||!Array.isArray(page.next.history)))return;
  return page;
 }catch{return;}
}
export function saveRecommendationReserve(scope:string,page:Page){
 if(page.posts.length<20)return;
 try{sessionStorage.setItem(KEY,JSON.stringify({scope,at:Date.now(),page}));}catch{}
}
export function clearRecommendationReserve(){try{sessionStorage.removeItem(KEY);}catch{}}
