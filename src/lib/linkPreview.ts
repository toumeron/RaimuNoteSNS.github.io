import { supabase } from "@/lib/supabase";
import { spaceLinkIn } from "@/lib/spaceLinks";

export type LinkPreview={url:string;domain:string;title:string;image:string;description?:string};
export function previewUrlMatches(first:string|null,second:string|undefined):boolean{
 try{return !!first&&!!second&&new URL(first).href===new URL(second).href;}catch{return false;}
}
export function singlePreviewUrl(content:string):string|null {
  const urls=content.match(/https?:\/\/[^\s<>"\u3000]+/gi)??[];
  if(urls.length!==1)return null;
  const raw=urls[0].replace(/[.,!?:;、。！？」』）)]+$/,'');
  try{
    const url=new URL(raw);
    if(url.username||url.password||spaceLinkIn(raw)||/(^|\.)(youtube\.com|youtu\.be|spotify\.com)$/.test(url.hostname)||/\.(png|jpe?g|gif|webp|avif|svg)(?:$|\?)/i.test(url.pathname)||url.origin===window.location.origin&&/\/(post|posts|spaces)\//.test(url.pathname))return null;
    return url.href;
  }catch{return null;}
}
const pending=new Map<string,Promise<LinkPreview|null>>();
export async function fetchLinkPreview(url:string,persist=true):Promise<LinkPreview|null> {
  if(persist){const saved=readSavedPreview(url);if(saved)return saved.preview;}
  const key=`${persist?'saved':'live'}:${url}`;
  const active=pending.get(key);if(active)return active;
  const request=(async()=>{
    try{
      const {data,error}=await supabase.functions.invoke('link-preview',{body:{url}});const value=data?.preview;
      if(error||data?.retryable)return null;
      const preview=value&&typeof value.title==='string'&&typeof value.image==='string'&&typeof value.domain==='string'&&(value.title.trim()||typeof value.description==='string'&&value.description.trim())&&(!value.image||/^https?:\/\//.test(value.image))?{...value,url} as LinkPreview:null;
      if(persist)savePreview(url,preview);
      return preview;
    }catch{return null;}
  })().finally(()=>pending.delete(key));
  pending.set(key,request);return request;
}

const KEY='lime-link-previews-v1';
type Entry={preview:LinkPreview|null;savedAt:number;version?:number};
function entries():Record<string,Entry>{try{const value=JSON.parse(localStorage.getItem(KEY)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}}
export function readSavedPreview(url:string):Entry|undefined{
 const entry=entries()[url];
 if(!entry||typeof entry.savedAt!=='number')return;
 if(entry.preview===null)return entry.version===6&&Date.now()-entry.savedAt<900_000?entry:undefined;
 const p=entry.preview;
 // Old Amazon cards only retained the storefront title and lost the product image.
 if(p&&/(^|\.)amazon\.co\.jp$/.test(p.domain)&&(/^Amazon\.co\.jp\s*$/i.test(p.title)||!p.image&&(entry.version!==6||Date.now()-entry.savedAt>=900_000)))return;
 return p?.url===url&&typeof p.title==='string'&&typeof p.domain==='string'&&typeof p.image==='string'&&(!p.image||/^https?:\/\//.test(p.image))?entry:undefined;
}
export function savePreview(url:string,preview:LinkPreview|null){
 try{const saved=entries();saved[url]={preview,savedAt:Date.now(),version:6};const keys=Object.keys(saved).sort((a,b)=>(saved[a]?.savedAt??0)-(saved[b]?.savedAt??0));for(const key of keys.slice(0,Math.max(0,keys.length-200)))delete saved[key];localStorage.setItem(KEY,JSON.stringify(saved));}catch{/* Preview rendering still works when storage is unavailable. */}
 if(preview?.image)void savePreviewImage(preview.image);
}
const IMAGE_DB='lime-link-preview-images';
type SavedImage={url:string;bytes:ArrayBuffer;type:string;savedAt:number};
function imageDb():Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(IMAGE_DB,1);
  request.onupgradeneeded=()=>request.result.createObjectStore('images',{keyPath:'url'});
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
}
async function writeImage(url:string,blob:Blob){
 const bytes=await blob.arrayBuffer(),db=await imageDb();
 try{await new Promise<void>((resolve,reject)=>{
  const tx=db.transaction('images','readwrite'),store=tx.objectStore('images');
  const request=store.getAll();
  request.onsuccess=()=>{
   const records=(request.result as SavedImage[]).filter(record=>record.url!==url).sort((a,b)=>a.savedAt-b.savedAt);
   let totalBytes=records.reduce((sum,record)=>sum+record.bytes.byteLength,bytes.byteLength);
   while(records.length>=200||totalBytes>40*1024*1024){const oldest=records.shift();if(!oldest)break;totalBytes-=oldest.bytes.byteLength;store.delete(oldest.url);}
   store.put({url,bytes,type:blob.type,savedAt:Date.now()});
  };
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 });}finally{db.close();}
}
const imageRequests=new Map<string,Promise<void>>();
export function savePreviewImage(url:string):Promise<void>{
 if(typeof indexedDB==='undefined'||!/^https?:\/\//.test(url))return Promise.resolve();
 const pending=imageRequests.get(url);if(pending)return pending;
 const task=(async()=>{try{
  if(await savedPreviewImage(url))return;
  const response=await fetch(url,{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)return;
  const blob=await response.blob();if(blob.size>8*1024*1024||!blob.size||blob.type.startsWith('text/'))return;
  await writeImage(url,blob);
 }catch{/* Sites that disallow CORS use the normal browser image cache. */}})().finally(()=>imageRequests.delete(url));
 imageRequests.set(url,task);return task;
}
export async function savedPreviewImage(url:string):Promise<Blob|null>{
 if(typeof indexedDB==='undefined')return null;
 try{
  const db=await imageDb();
  try{return await new Promise<Blob|null>((resolve,reject)=>{
   const tx=db.transaction('images','readonly'),request=tx.objectStore('images').get(url);
   request.onsuccess=()=>resolve(request.result?new Blob([request.result.bytes],{type:request.result.type}):null);request.onerror=()=>reject(request.error);
  });}finally{db.close();}
 }catch{return null;}
}
