import type {LinkPreview} from './linkPreview';
import type {LiveSpace} from '@/components/spaces/SpaceContext';
import type {PostWithAuthor} from '@/types';
import type {CustomSticker} from './stickers';

export {isInstalledPwa} from './pwa';
export type OfflineSpaceCard = LiveSpace & {is_active:boolean};
export type OfflineBookmarks = {userId:string; savedAt:string; posts:PostWithAuthor[]; emojis:CustomSticker[]; linkPreviews?:Record<string,LinkPreview|null>; spaces?:Record<string,OfflineSpaceCard|null>; assets:{url:string;bytes:ArrayBuffer;type:string}[]};
const DATABASE='lime-offline-bookmarks-v1';
function database():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('accounts',{keyPath:'userId'});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('オフライン保存を開けませんでした'));
  });
}
export async function readOfflineBookmarks(userId:string):Promise<OfflineBookmarks|null> {
  const db=await database();
  try{return await new Promise((resolve,reject)=>{
    const request=db.transaction('accounts').objectStore('accounts').get(userId);
    request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error);
  });}finally{db.close();}
}
async function write(userId:string,value?:OfflineBookmarks) {
  const db=await database();
  try{await new Promise<void>((resolve,reject)=>{
    const transaction=db.transaction('accounts','readwrite');
    const store=transaction.objectStore('accounts');
    if(value)store.put(value);else store.delete(userId);
    transaction.oncomplete=()=>resolve();transaction.onerror=event=>reject((event.target as IDBRequest)?.error??transaction.error??new Error('オフラインデータを保存できませんでした'));transaction.onabort=()=>reject(transaction.error??new Error('オフライン保存が中断されました'));
  });}finally{db.close();}
}
export const deleteOfflineBookmarks=(userId:string)=>write(userId);
export const writeOfflineBookmarks=(value:OfflineBookmarks)=>write(value.userId,value);

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
export async function downloadBookmarkAssets(urls:string[],onProgress:(done:number,total:number)=>void):Promise<OfflineBookmarks['assets']> {
  const assets:OfflineBookmarks['assets']=[];
  let done=0;
  // Bound simultaneous downloads on iOS. A failed asset leaves the existing
  // snapshot intact, rather than reporting an incomplete download as saved.
  for(let start=0;start<urls.length;start+=4)await Promise.all(urls.slice(start,start+4).map(async url=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try{
      const response=await fetch(url,{signal:controller.signal});
      if(!response.ok)throw new Error('画像を保存できませんでした。もう一度お試しください');
      const bytes=await response.arrayBuffer();if(!bytes.byteLength)throw new Error('画像を保存できませんでした');
      assets.push({url,bytes,type:response.headers.get('content-type')??'application/octet-stream'});onProgress(++done,urls.length);
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
