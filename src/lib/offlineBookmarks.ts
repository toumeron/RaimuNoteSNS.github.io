import { randomUUID } from '@/lib/randomUUID';
import {boundedResponseBlob,ResponseTooLarge} from './boundedResponse';
import {supabase} from './supabase';
import type {LinkPreview} from './linkPreview';
import type {LiveSpace} from "@/components/spaces/SpaceProvider";
import type {PostWithAuthor} from '@/types';
import type {CustomSticker} from './stickers';

export {isInstalledPwa} from './utils';
export type OfflineSpaceCard = LiveSpace & {is_active:boolean};
export type OfflineBookmarks = {userId:string; savedAt:string; posts:PostWithAuthor[]; emojis:CustomSticker[]; linkPreviews?:Record<string,LinkPreview|null>; spaces?:Record<string,OfflineSpaceCard|null>; assets:{url:string;bytes:ArrayBuffer;type:string}[]};
const DATABASE='lime-offline-bookmarks-v1';
function database():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE,2);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('accounts'))request.result.createObjectStore('accounts',{keyPath:'userId'});if(!request.result.objectStoreNames.contains('assets'))request.result.createObjectStore('assets',{keyPath:['userId','generation','url']});};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('オフライン保存を開けませんでした'));
  });
}
type StoredSnapshot=OfflineBookmarks & {generation?:string;assetUrls?:string[]};
export async function readOfflineBookmarks(userId:string,includeAssets=true):Promise<OfflineBookmarks|null> {
 const db=await database();
 try{
  // Read the snapshot and its generation in one transaction so a concurrent
  // save cannot delete its image generation halfway through this read.
  return await new Promise<OfflineBookmarks|null>((resolve,reject)=>{
   const tx=db.transaction(['accounts','assets'],'readonly');
   let value:StoredSnapshot|null=null;const assets:OfflineBookmarks['assets']=[];
   const request=tx.objectStore('accounts').get(userId);
   request.onsuccess=()=>{
    value=request.result??null;
    if(!value||!includeAssets||!value.generation)return;
    for(const url of value.assetUrls??[]){
     const asset=tx.objectStore('assets').get([userId,value.generation,url]);
     asset.onsuccess=()=>{if(asset.result)assets.push({url:asset.result.url,bytes:asset.result.bytes,type:asset.result.type});};
    }
   };
   tx.oncomplete=()=>resolve(!value?null:{...value,assets:!includeAssets?[]:value.generation?assets:value.assets});
   tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
 }finally{db.close();}
}
export async function deleteOfflineBookmarks(userId:string){
 const db=await database();try{await new Promise<void>((resolve,reject)=>{
  const tx=db.transaction(['accounts','assets'],'readwrite');tx.objectStore('accounts').delete(userId);
  const request=tx.objectStore('assets').openCursor(IDBKeyRange.bound([userId],[userId,'\uffff']));
  request.onsuccess=()=>{const cursor=request.result;if(cursor){cursor.delete();cursor.continue();}};
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 });}finally{db.close();}
}
export async function writeOfflineBookmarks(value:OfflineBookmarks){
 const db=await database(),generation=randomUUID();
 try{
  // Individual asset records and the snapshot commit atomically. A failed save
  // retains the previous generation, even when another tab saves concurrently.
  await new Promise<void>((resolve,reject)=>{
   const tx=db.transaction(['accounts','assets'],'readwrite');const assets=tx.objectStore('assets');
   try {
   assets.openCursor(IDBKeyRange.bound([value.userId],[value.userId,'\uffff'])).onsuccess=event=>{
    const cursor=(event.target as IDBRequest<IDBCursorWithValue|null>).result;
    if(cursor){if(cursor.value.generation!==generation)cursor.delete();cursor.continue();}
   };
   for(const asset of value.assets)assets.put({...asset,userId:value.userId,generation});
   tx.objectStore('accounts').put({...value,assets:[],generation,assetUrls:value.assets.map(asset=>asset.url)});
   tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error??new Error('オフラインデータを保存できませんでした'));tx.onabort=()=>reject(tx.error??new Error('オフライン保存が中断されました'));
   } catch(error) { tx.abort(); reject(error); }
  });
 }finally{db.close();}
}

export function bookmarkAssetUrls(posts:PostWithAuthor[]):string[] {
  const urls=new Set<string>();
  const visit=(value:unknown,key='')=>{
    if(typeof value==='string' && /image|avatar|cover|thumb/i.test(key) && /^https?:\/\//.test(value))urls.add(value);
    else if(Array.isArray(value))value.forEach(item=>visit(item,key));
    else if(value && typeof value==='object')Object.entries(value).forEach(([name,item])=>visit(item,name));
  };
  visit(posts);
  return [...urls];
}
async function downloadImage(url:string,signal:AbortSignal){
 try{
  const response=await fetch(url,{signal,credentials:'omit',referrerPolicy:'no-referrer'});
  if(!response.ok)throw new Error('画像を保存できませんでした。もう一度お試しください');
  if(!response.headers.get('content-type')?.startsWith('image/'))throw new Error('画像データを取得できませんでした');
  const blob=await boundedResponseBlob(response,16*1024*1024);
  return {bytes:await blob.arrayBuffer(),type:blob.type};
 }catch(error){
  if(signal.aborted||error instanceof ResponseTooLarge)throw error;
  // Browser image tags may display an asset whose host denies fetch/CORS.
  // Request only supported public media through the authenticated image reader.
  const {data,error:proxyError,response}=await supabase.functions.invoke('link-preview',{body:{url,mode:'image'},signal});
  const type=response?.headers.get('x-lime-image-type')??data?.type??'';
  if(proxyError||!(data instanceof Blob)||!type.startsWith('image/'))throw new Error(`画像を保存できませんでした（${new URL(url).hostname}）`);
  if(data.size>16*1024*1024)throw new ResponseTooLarge();
  return {bytes:await data.arrayBuffer(),type};
 }
}
export async function downloadBookmarkAssets(urls:string[],onProgress:(done:number,total:number)=>void):Promise<OfflineBookmarks['assets']> {
  const assets:OfflineBookmarks['assets']=[];
  let done=0,totalBytes=0;
  if(urls.length>2000)throw new Error('画像が多すぎます。保存対象を減らしてください');
  // Bound simultaneous downloads on iOS. A failed asset leaves the existing
  // snapshot intact, rather than reporting an incomplete download as saved.
  for(let start=0;start<urls.length;start+=2)await Promise.all(urls.slice(start,start+2).map(async url=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try{
      const {bytes,type}=await downloadImage(url,controller.signal);if(!bytes.byteLength)throw new Error('画像を保存できませんでした');
      totalBytes+=bytes.byteLength;if(totalBytes>256*1024*1024)throw new Error('画像の合計が256MBを超えています。保存対象を減らしてください');
      assets.push({url,bytes,type});onProgress(++done,urls.length);
    }finally{clearTimeout(timer);}
  }));
  return assets;
}
export function openOfflineBookmarks(value:OfflineBookmarks) {
  const media=new Map(value.assets.map(asset=>[asset.url,URL.createObjectURL(new Blob([asset.bytes],{type:asset.type}))]));
  const replace=(input:unknown):unknown=>{
    if(typeof input==='string')return media.get(input)??input;
    if(Array.isArray(input))return input.map(replace);
    if(input && typeof input==='object')return Object.fromEntries(Object.entries(input).map(([key,item])=>[key,replace(item)]));
    return input;
  };
  return {userId:value.userId,bookmarkIds:value.posts.map(post=>post.id),posts:replace(value.posts) as PostWithAuthor[],spaces:replace(value.spaces??{}) as Record<string,OfflineSpaceCard|null>,linkPreviews:replace(value.linkPreviews??{}) as Record<string,LinkPreview|null>,emojis:value.emojis,media,release:()=>media.forEach(url=>URL.revokeObjectURL(url))};
}
