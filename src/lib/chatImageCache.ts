import {useEffect,useState} from 'react';
import {readChatImage,writeChatImage} from './chatImageStore';
const pending=new Map<string,Promise<Blob>>();
const MAX_BYTES=10*1024*1024;
const eligible=(url:string)=>{try{const u=new URL(url);return u.protocol==='https:'&&(['upload.wikimedia.org','thumb.wikimedia.org','res.cloudinary.com'].includes(u.hostname)||u.hostname.endsWith('.supabase.co'));}catch{return false}};
/** Cache only successful image responses, separately for each signed-in account. */
export async function loadChatImage(url:string,account:string):Promise<Blob>{
 const key=JSON.stringify([account,url]);const existing=pending.get(key);if(existing)return existing;
 const request=(async()=>{
  try{const saved=await readChatImage(account,url);if(saved)return saved;}catch{/* Storage can be disabled; the image still works online. */}
  const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer'});
  if(!response.ok||!/^image\//i.test(response.headers.get('content-type')??''))throw Error('Image unavailable');
  const blob=await response.blob();if(blob.size>MAX_BYTES)throw Error('Image exceeds cache limit');
  try{await writeChatImage(account,url,blob);}catch{/* A full cache must not prevent display. */}
  return blob;
 })();pending.set(key,request);try{return await request;}finally{pending.delete(key)}
}
export function useCachedChatImage(url:string,account='public'){
 const canCache=eligible(url)&&typeof indexedDB!=='undefined';const [state,setState]=useState({key:'',src:''});const key=JSON.stringify([account,url]);
 useEffect(()=>{if(!canCache)return;let cancelled=false,local='';void loadChatImage(url,account).then(blob=>{if(cancelled)return;local=URL.createObjectURL(blob);setState({key,src:local});}).catch(()=>{if(!cancelled)setState({key,src:url})});return()=>{cancelled=true;if(local)URL.revokeObjectURL(local)}},[url,account,key,canCache]);
 return canCache?(state.key===key?state.src:''):url;
}
