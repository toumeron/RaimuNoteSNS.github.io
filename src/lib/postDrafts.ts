import type {PollDraft} from '@/lib/utils';
import type {PreparedVideo} from '@/lib/mediaThumbnail';
import type {PostWithAuthor} from '@/types';

export type PostDraft={content:string;previews:string[];originals:string[];sticker:string|null;poll:PollDraft|null;scheduledAt:string|null;visibility:'public'|'following'|'members';communityId?:string;quotedPost:PostWithAuthor|null;video:PreparedVideo|null};
type Asset=Blob|string;
type StoredDraft=Omit<PostDraft,'previews'|'originals'|'poll'|'video'>&{images:{preview:Asset;original:Asset}[];poll:(Omit<PollDraft,'options'>&{options:{label:string;image?:Asset}[]})|null;video:Omit<PreparedVideo,'url'>|null;revision:number};
const assets=new Map<string,Blob>();
const records=new Map<string,Promise<StoredDraft>|null>();
const queues=new Map<string,Promise<unknown>>();
const prefix='lime-post-draft:';
let sequence=Date.now();
let opening:Promise<IDBDatabase>|undefined;

export function createDraftMediaUrl(blob:Blob){const url=URL.createObjectURL(blob);assets.set(url,blob);return url;}
export function revokeDraftMediaUrl(url:string){assets.delete(url);URL.revokeObjectURL(url);}
export function postDraftKey(owner:string,surface:string,community?:string,map?:{latitude:number;longitude:number}){return JSON.stringify([owner,surface,community??null,map?.latitude??null,map?.longitude??null]);}
export function hasPostDraft(draft:PostDraft){return !!(draft.content||draft.previews.length||draft.sticker||draft.poll||draft.video);}
export function postDraftFingerprint(draft:PostDraft){return JSON.stringify([draft.content,draft.previews,draft.originals,draft.sticker,draft.poll,draft.scheduledAt,draft.visibility,draft.communityId,draft.quotedPost?.id,draft.video?{url:draft.video.url,duration:draft.video.duration}:null]);}
function database(){
 if(!opening)opening=new Promise<IDBDatabase>((resolve,reject)=>{
  if(typeof indexedDB==='undefined'){reject(new Error('IndexedDB unavailable'));return;}
  const request=indexedDB.open('limenote-post-drafts',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('drafts');
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error??new Error('Draft storage failed'));
 }).catch(error=>{opening=undefined;throw error;});
 return opening;
}
async function storedAsset(url:string):Promise<Asset>{
 if(!url.startsWith('blob:'))return url;
 const retained=assets.get(url);if(retained)return retained;
 const response=await fetch(url);if(!response.ok)throw new Error('Draft attachment unavailable');return response.blob();
}
async function snapshot(draft:PostDraft,revision:number):Promise<StoredDraft>{
 // Resolve URLs immediately, before the editor can revoke them on unmount.
 const images=draft.previews.map((url,index)=>Promise.all([storedAsset(url),storedAsset(draft.originals[index]??url)]).then(([preview,original])=>({preview,original})));
 const options=draft.poll?.options.map(async option=>({...option,...(option.image?{image:await storedAsset(option.image)}:{})}));
 const {previews:_previews,originals:_originals,poll,video,...text}=draft;
 return {...text,images:await Promise.all(images),poll:poll?{...poll,options:await Promise.all(options!)}:null,video:video?{file:video.file,poster:video.poster,duration:video.duration,width:video.width,height:video.height}:null,revision};
}
function enqueue(key:string,task:()=>Promise<void>){
 const next=(queues.get(key)??Promise.resolve()).catch(()=>{}).then(task);
 queues.set(key,next);void next.finally(()=>{if(queues.get(key)===next)queues.delete(key);}).catch(()=>{});
 return next;
}
async function write(key:string,value:StoredDraft|null){
 const db=await database();
 await new Promise<void>((resolve,reject)=>{
  const tx=db.transaction('drafts','readwrite');
  if(value)tx.objectStore('drafts').put(value,key);else tx.objectStore('drafts').delete(key);
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error??new Error('Draft storage failed'));tx.onabort=()=>reject(tx.error??new Error('Draft storage aborted'));
 });
}
export function savePostDraftText(key:string,draft:PostDraft):number{
 const previous=readEnvelope(key);
 const revision=sequence=Math.max(sequence+1,Date.now(),Number(previous?.revision??0)+1);
 // Text is synchronous protection against a reload between IDB transactions.
 // Blob URLs are intentionally never written to localStorage.
 try{localStorage.setItem(prefix+key,JSON.stringify({content:draft.content,sticker:draft.sticker,scheduledAt:draft.scheduledAt,visibility:draft.visibility,communityId:draft.communityId,quotedPost:draft.quotedPost,revision}));}catch{/* IDB remains the primary store. */}
 return revision;
}
export function savePostDraft(key:string,draft:PostDraft):Promise<void>{
 const revision=savePostDraftText(key,draft);
 const value=snapshot(draft,revision);records.set(key,value);
 // Snapshot errors are handled even if a newer revision supersedes this one.
 void value.catch(()=>{});
 return enqueue(key,async()=>{if(records.get(key)!==value)return;const stored=await value;await write(key,stored);if(records.get(key)===value)records.delete(key);});
}
export function removePostDraft(key:string):Promise<void>{
 records.set(key,null);try{localStorage.setItem(prefix+key,JSON.stringify({deleted:true,revision:++sequence}));}catch{/* IDB may still work. */}
 return enqueue(key,async()=>{await write(key,null);if(records.get(key)===null){records.delete(key);try{localStorage.removeItem(prefix+key);}catch{/* Keep the tombstone if storage is blocked. */}}});
}
function readEnvelope(key:string):Record<string,unknown>|null{
 try{return JSON.parse(localStorage.getItem(prefix+key)??'null');}catch{return null;}
}
export function readPostDraftText(key:string):Partial<PostDraft>|null{
 const value=readEnvelope(key);return value&&typeof value.content==='string'?value as Partial<PostDraft>:null;
}
export async function flushPostDrafts(){await Promise.allSettled([...queues.values()]);}
export async function loadPostDraft(key:string):Promise<PostDraft|null>{
 const envelope=readEnvelope(key);if(envelope?.deleted===true)return null;
 let value:StoredDraft|undefined|null;
 if(records.has(key)){try{value=await records.get(key);}catch{/* Recover the last committed images instead. */}}
 if(value===undefined){
  try{const db=await database();value=await new Promise<StoredDraft|undefined>((resolve,reject)=>{const request=db.transaction('drafts','readonly').objectStore('drafts').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}catch{/* Text/memory recovery still works if storage is blocked. */}
 }
 const newest=readEnvelope(key);if(newest?.deleted===true)return null;
 const text=(!value||Number(newest?.revision??0)>=value.revision)?readPostDraftText(key):null;
 if(!value)return text?{content:'',previews:[],originals:[],sticker:null,poll:null,scheduledAt:null,visibility:'public',quotedPost:null,video:null,...text}:null;
 const urls=new Map<Blob,string>();
 const url=(asset:Asset)=>{if(typeof asset==='string')return asset;let result=urls.get(asset);if(!result){result=createDraftMediaUrl(asset);urls.set(asset,result);}return result;};
 return {...value,...text,previews:value.images.map(image=>url(image.preview)),originals:value.images.map(image=>url(image.original)),poll:value.poll?{...value.poll,options:value.poll.options.map(option=>({label:option.label,...(option.image?{image:url(option.image)}:{})}))}:null,video:value.video?{...value.video,url:createDraftMediaUrl(value.video.file)}:null};
}
