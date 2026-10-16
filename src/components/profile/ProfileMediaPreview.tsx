import { memo, forwardRef, useEffect, useState, type ImgHTMLAttributes } from "react";
import { useInView } from "react-intersection-observer";
import { PostVideoThumbnail } from "@/components/video/PostVideoThumbnail";
import { mediaThumbnailUrl } from "@/lib/mediaThumbnail";
import { isDeferredPrivateMedia, resolvePrivateMediaUrl } from "@/lib/privateMediaFetch";

// PrivateMediaImage
/** Keep attachment downloads outside the post metadata request. */
function usePrivateMediaUrl(src:string|undefined){
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
const PrivateMediaImage=forwardRef<HTMLImageElement,ImgHTMLAttributes<HTMLImageElement>>(({src,...props},ref)=>{
 const resolved=usePrivateMediaUrl(src);
 return <img {...props} ref={ref} src={resolved}/>;
});
PrivateMediaImage.displayName='PrivateMediaImage';

// ProfileMediaPreview
/** Preserve grid geometry, releasing decoded images/posters outside the nearby rows. */
const ProfileMediaPreview=memo(function ProfileMediaPreview({src,postId,duration,thumbnail,external}:{src?:string;postId?:string;duration?:number;thumbnail?:string;external?:boolean}){
 const {ref,inView}=useInView({initialInView:false,rootMargin:'400px 0px'});
 return <div ref={ref} className="h-full w-full">{inView&&(duration!==undefined&&postId?<PostVideoThumbnail postId={postId} duration={duration} thumbnail={thumbnail} external={external}/>:src?<PrivateMediaImage src={mediaThumbnailUrl(src)} referrerPolicy={/^https:\/\/pbs[.]twimg[.]com\//.test(src)?'no-referrer':undefined} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async"/>:null)}</div>;
});

export { ProfileMediaPreview };
export { usePrivateMediaUrl };
export { PrivateMediaImage };
