import { useEffect, useState } from "react";
import { readChatImage, writeChatImage } from "@/lib/chatImageStore";
import { boundedResponseBlob } from "@/lib/devFunctionFetch";

// chatImageCache
const pending=new Map<string,Promise<Blob>>();
const MAX_BYTES=10*1024*1024;
const eligible=(url:string)=>{try{const u=new URL(url);return u.protocol==='https:'&&(['upload.wikimedia.org','thumb.wikimedia.org','res.cloudinary.com'].includes(u.hostname)||u.hostname.endsWith('.supabase.co'));}catch{return false}};
/** Cache only successful image responses, separately for each signed-in account. */
async function loadChatImage(url:string,account:string):Promise<Blob>{
 const key=JSON.stringify([account,url]);const existing=pending.get(key);if(existing)return existing;
 const request=(async()=>{
  try{const saved=await readChatImage(account,url);if(saved)return saved;}catch{/* Storage can be disabled; the image still works online. */}
  const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(30000)});
  if(!response.ok||!/^image\//i.test(response.headers.get('content-type')??''))throw Error('Image unavailable');
  const blob=await boundedResponseBlob(response,MAX_BYTES);
  try{await writeChatImage(account,url,blob);}catch{/* A full cache must not prevent display. */}
  return blob;
 })();pending.set(key,request);try{return await request;}finally{pending.delete(key)}
}
function useCachedChatImage(url:string,account='public'){
 const canCache=eligible(url)&&typeof indexedDB!=='undefined';const [state,setState]=useState({key:'',src:''});const key=JSON.stringify([account,url]);
 useEffect(()=>{if(!canCache)return;let cancelled=false,local='';void loadChatImage(url,account).then(blob=>{if(cancelled)return;local=URL.createObjectURL(blob);setState({key,src:local});}).catch(()=>{if(!cancelled)setState({key,src:url})});return()=>{cancelled=true;if(local)URL.revokeObjectURL(local)}},[url,account,key,canCache]);
 return canCache?(state.key===key?state.src:''):url;
}

// chatPostLink
/** Resolve only links to this app; arbitrary sites with /post paths stay links. */
function findChatPostLink(content:string):{id:string;url:string}|null{
 for(const raw of content.match(/https?:\/\/[^\s]+/gi)??[]){
  try{
   const url=new URL(raw.replace(/[)\]}>。、，．！？!?]+$/g,''));
   if(!['localhost','127.0.0.1','toumeron.github.io'].includes(url.hostname))continue;
   const match=url.pathname.replace(/\/+$/,'').match(/^(?:\/RaimuNoteSNS\.github\.io)?\/post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
   if(match)return {id:match[1],url:url.href};
  }catch{/* Incomplete links remain ordinary message text. */}
 }
 return null;
}

export { loadChatImage };
export { useCachedChatImage };
export { findChatPostLink };
