import {supabase} from './supabase';
import type {LinkPreview} from './linkPreview';
import type {LiveSpace} from '@/components/spaces/SpaceContext';
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
async function entry<T>(db:IDBDatabase,store:string,key:IDBValidKey):Promise<T|null>{
 return await new Promise((resolve,reject)=>{const request=db.transaction(store).objectStore(store).get(key);request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error);});
}
export async function readOfflineBookmarks(userId:string,includeAssets=true):Promise<OfflineBookmarks|null> {
 const db=await database();
 try{
  const value=await entry<StoredSnapshot>(db,'accounts',userId);if(!value)return null;
  if(!includeAssets)return {...value,assets:[]};
  if(!value.generation)return value; // Migrate existing snapshots without deleting them.
  const assets:OfflineBookmarks['assets']=[];
  for(const url of value.assetUrls??[]){const asset=await entry<OfflineBookmarks['assets'][number]>(db,'assets',[userId,value.generation,url]);if(!asset)throw new Error('保存した画像データを読み込めませんでした');assets.push({url:asset.url,bytes:asset.bytes,type:asset.type});}
  return {...value,assets};
 }finally{db.close();}
}
async function mutate(db:IDBDatabase,store:string,action:(store:IDBObjectStore)=>void){
 await new Promise<void>((resolve,reject)=>{const tx=db.transaction(store,'readwrite');action(tx.objectStore(store));tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error??new Error('オフラインデータを保存できませんでした'));tx.onabort=()=>reject(tx.error??new Error('オフライン保存が中断されました'));});
}
async function removeAssets(db:IDBDatabase,userId:string,keep?:string,only?:string){
 await mutate(db,'assets',store=>{const request=store.openCursor(IDBKeyRange.bound([userId],[userId,'\uffff']));request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;const generation=cursor.value.generation;if((!only||generation===only)&&generation!==keep)cursor.delete();cursor.continue();};});
}
export async function deleteOfflineBookmarks(userId:string){const db=await database();try{await mutate(db,'accounts',store=>store.delete(userId));await removeAssets(db,userId);}finally{db.close();}}
export async function writeOfflineBookmarks(value:OfflineBookmarks){
 const db=await database(),generation=crypto.randomUUID();
 try{
  // Write one binary asset per transaction. WebKit no longer has to clone the
  // entire image collection along with every post in one large IDB record.
  for(const asset of value.assets)await mutate(db,'assets',store=>store.put({...asset,userId:value.userId,generation}));
  await mutate(db,'accounts',store=>store.put({...value,assets:[],generation,assetUrls:value.assets.map(asset=>asset.url)}));
  await removeAssets(db,value.userId,generation).catch(()=>{});
 }catch(error){await removeAssets(db,value.userId,undefined,generation).catch(()=>{});throw error;}finally{db.close();}
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
  return {bytes:await response.arrayBuffer(),type:response.headers.get('content-type')??'application/octet-stream'};
 }catch(error){
  if(signal.aborted)throw error;
  // Browser image tags may display an asset whose host denies fetch/CORS.
  // Request only supported public media through the authenticated image reader.
  const {data,error:proxyError,response}=await supabase.functions.invoke('link-preview',{body:{url,mode:'image'},signal});
  const type=response?.headers.get('x-lime-image-type')??data?.type??'';
  if(proxyError||!(data instanceof Blob)||!type.startsWith('image/'))throw new Error(`画像を保存できませんでした（${new URL(url).hostname}）`);
  return {bytes:await data.arrayBuffer(),type};
 }
}
export async function downloadBookmarkAssets(urls:string[],onProgress:(done:number,total:number)=>void):Promise<OfflineBookmarks['assets']> {
  const assets:OfflineBookmarks['assets']=[];
  let done=0;
  // Bound simultaneous downloads on iOS. A failed asset leaves the existing
  // snapshot intact, rather than reporting an incomplete download as saved.
  for(let start=0;start<urls.length;start+=2)await Promise.all(urls.slice(start,start+2).map(async url=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try{
      const {bytes,type}=await downloadImage(url,controller.signal);if(!bytes.byteLength)throw new Error('画像を保存できませんでした');
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
