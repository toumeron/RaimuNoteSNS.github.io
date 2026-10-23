import {useState} from 'react';

export function communityAudienceSources(src:string) {
  try {
    const url=new URL(src);
    if(url.protocol!=='https:'||url.hostname!=='res.cloudinary.com'||!/\/image\/upload\//.test(url.pathname)||url.pathname.includes('/s--'))return {src};
    const [prefix,path]=url.pathname.split('/image/upload/');
    const version=path.split('/').findIndex(segment=>/^v\d+$/.test(segment));
    const original=version>=0?path.split('/').slice(version).join('/'):path;
    // Derive each size from the original, never from an already downsized thumbnail.
    const image=(size:number)=>`${url.origin}${prefix}/image/upload/c_fill,g_center,w_${size},h_${size}/q_95/f_auto/${original}${url.search}`;
    return {src:image(108),srcSet:[36,72,108,144].map((size,index)=>`${image(size)} ${index+1}x`).join(', ')};
  }catch{return {src};}
}

export function CommunityAudienceImage({src}:{src:string}) {
  const [failed,setFailed]=useState<string|null>(null);
  const sources=failed===src?{src}:communityAudienceSources(src);
  return <img {...sources} width={36} height={36} alt="" className="h-full w-full object-cover" decoding="async" onError={()=>setFailed(src)}/>;
}
