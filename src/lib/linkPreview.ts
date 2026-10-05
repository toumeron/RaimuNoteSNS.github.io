import {readSavedPreview,savePreview} from './linkPreviewCache';
import {supabase} from './supabase';
import {spaceLinkIn} from './spaceLinks';
export type LinkPreview={url:string;domain:string;title:string;image:string};
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
      if(error)return null;
      const preview=value&&typeof value.title==='string'&&typeof value.image==='string'&&typeof value.domain==='string'&&/^https?:\/\//.test(value.image)?{...value,url} as LinkPreview:null;
      if(persist)savePreview(url,preview);
      return preview;
    }catch{return null;}
  })().finally(()=>pending.delete(key));
  pending.set(key,request);return request;
}
