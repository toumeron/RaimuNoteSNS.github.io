import { isDeferredPrivateMedia, resolvePrivateMediaUrl, boundedResponseBlob, ResponseTooLarge } from "@/lib/privateMediaFetch";
import { randomUUID, type CustomSticker } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { type LinkPreview } from "@/lib/mediaThumbnail";
import { type LiveSpace } from "@/components/spaces/SpaceProvider";
import { type PostWithAuthor } from "@/types/index";

// offlineBookmarks
export {isInstalledPwa} from './utils';
type OfflineSpaceCard = LiveSpace & {is_active:boolean};
type OfflineBookmarks = {userId:string; savedAt:string; posts:PostWithAuthor[]; emojis:CustomSticker[]; linkPreviews?:Record<string,LinkPreview|null>; spaces?:Record<string,OfflineSpaceCard|null>; assets:{url:string;bytes:ArrayBuffer;type:string}[]};
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
async function readOfflineBookmarks(userId:string,includeAssets=true):Promise<OfflineBookmarks|null> {
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
async function deleteOfflineBookmarks(userId:string){
 const db=await database();try{await new Promise<void>((resolve,reject)=>{
  const tx=db.transaction(['accounts','assets'],'readwrite');tx.objectStore('accounts').delete(userId);
  const request=tx.objectStore('assets').openCursor(IDBKeyRange.bound([userId],[userId,'\uffff']));
  request.onsuccess=()=>{const cursor=request.result;if(cursor){cursor.delete();cursor.continue();}};
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 });}finally{db.close();}
}
async function writeOfflineBookmarks(value:OfflineBookmarks){
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

function bookmarkAssetUrls(posts:PostWithAuthor[]):string[] {
  const urls=new Set<string>();
  const visit=(value:unknown,key='')=>{
    if(typeof value==='string' && /image|avatar|cover|thumb/i.test(key) && (/^https?:\/\//.test(value)||isDeferredPrivateMedia(value)))urls.add(value);
    else if(Array.isArray(value))value.forEach(item=>visit(item,key));
    else if(value && typeof value==='object')Object.entries(value).forEach(([name,item])=>visit(item,name));
  };
  visit(posts);
  return [...urls];
}
async function downloadImage(url:string,signal:AbortSignal){
 try{
  const resolved=await resolvePrivateMediaUrl(url);if(!resolved)throw new Error('画像を取得できませんでした');
  const response=await fetch(resolved,{signal,credentials:'omit',referrerPolicy:'no-referrer'});
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
async function downloadBookmarkAssets(urls:string[],onProgress:(done:number,total:number)=>void):Promise<OfflineBookmarks['assets']> {
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
function openOfflineBookmarks(value:OfflineBookmarks) {
  const media=new Map(value.assets.map(asset=>[asset.url,URL.createObjectURL(new Blob([asset.bytes],{type:asset.type}))]));
  const replace=(input:unknown):unknown=>{
    if(typeof input==='string')return media.get(input)??input;
    if(Array.isArray(input))return input.map(replace);
    if(input && typeof input==='object')return Object.fromEntries(Object.entries(input).map(([key,item])=>[key,replace(item)]));
    return input;
  };
  return {userId:value.userId,bookmarkIds:value.posts.map(post=>post.id),posts:replace(value.posts) as PostWithAuthor[],spaces:replace(value.spaces??{}) as Record<string,OfflineSpaceCard|null>,linkPreviews:replace(value.linkPreviews??{}) as Record<string,LinkPreview|null>,emojis:value.emojis,media,release:()=>media.forEach(url=>URL.revokeObjectURL(url))};
}

// chatImageStore
type ImageRecord={account:string;bytes:ArrayBuffer;type:string;savedAt:number};
const key=(account:string,url:string)=>JSON.stringify([account,url]);
async function chatImageStoreDatabase(){return await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('lime-chat-images',1);r.onupgradeneeded=()=>r.result.createObjectStore('images').createIndex('age',['account','savedAt']);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});}
async function readChatImage(account:string,url:string):Promise<Blob|undefined>{
 const db=await chatImageStoreDatabase();return await new Promise((resolve,reject)=>{const tx=db.transaction('images','readonly'),r=tx.objectStore('images').get(key(account,url));let record:ImageRecord|undefined;r.onsuccess=()=>{record=r.result};tx.oncomplete=()=>{db.close();resolve(record?new Blob([record.bytes],{type:record.type}):undefined)};tx.onabort=()=>{db.close();reject(tx.error)}});
}
async function writeChatImage(account:string,url:string,blob:Blob){
 const record:ImageRecord={account,bytes:await blob.arrayBuffer(),type:blob.type,savedAt:Date.now()};const db=await chatImageStoreDatabase();return await new Promise<void>((resolve,reject)=>{const tx=db.transaction('images','readwrite'),s=tx.objectStore('images');s.put(record,key(account,url));const keys=s.index('age').getAllKeys(IDBKeyRange.bound([account,0],[account,Number.MAX_SAFE_INTEGER]));keys.onsuccess=()=>{for(const k of keys.result.slice(0,Math.max(0,keys.result.length-64)))s.delete(k)};tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>{db.close();reject(tx.error)}});
}

export { readOfflineBookmarks };
export { deleteOfflineBookmarks };
export { writeOfflineBookmarks };
export { bookmarkAssetUrls };
export { downloadBookmarkAssets };
export { openOfflineBookmarks };
export type { OfflineSpaceCard };
export type { OfflineBookmarks };
export { readChatImage };
export { writeChatImage };
