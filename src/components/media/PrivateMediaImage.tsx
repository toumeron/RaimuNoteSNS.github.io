import {forwardRef,useEffect,useState,type ImgHTMLAttributes} from 'react';
import {isDeferredPrivateMedia,resolvePrivateMediaUrl} from '@/lib/privateMediaFetch';

/** Keep attachment downloads outside the post metadata request. */
export function usePrivateMediaUrl(src:string|undefined){
 const [resolved,setResolved]=useState<{input:string;url:string|null}>();
 const deferred=!!src&&isDeferredPrivateMedia(src);
 useEffect(()=>{
  if(!src||!deferred)return;
  let active=true;
  void resolvePrivateMediaUrl(src).then(url=>{if(active)setResolved({input:src,url});}).catch(()=>{if(active)setResolved({input:src,url:null});});
  return()=>{active=false;};
 },[src,deferred]);
 return deferred?(resolved?.input===src?resolved.url??undefined:undefined):src;
}
export const PrivateMediaImage=forwardRef<HTMLImageElement,ImgHTMLAttributes<HTMLImageElement>>(({src,...props},ref)=>{
 const resolved=usePrivateMediaUrl(src);
 return <img {...props} ref={ref} src={resolved}/>;
});
PrivateMediaImage.displayName='PrivateMediaImage';
