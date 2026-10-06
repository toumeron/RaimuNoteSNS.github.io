import {page} from './http.ts';
import {metadata,publicUrl,type LinkPreview} from './metadata.ts';
export async function loadPreview(raw:string):Promise<LinkPreview|null> {
  const original=publicUrl(raw).href;let url=publicUrl(original);
  for(let redirects=0;redirects<=3;redirects++){
    const result=await page(url);
    if(result.status>=300&&result.status<400&&result.location){url=publicUrl(new URL(result.location,url).href);continue;}
    return metadata(result.html,url.href,original);
  }
  return null;
}

export function allowedImage(raw:string,storageHost:string):URL{
 const url=publicUrl(raw);
 const platform=/^(?:res\.cloudinary\.com|cdn\.bsky\.app|pbs\.twimg\.com|media\d*\.tenor\.com|media\.tenor\.com)$/i.test(url.hostname);
 if(url.protocol!=='https:'||(!platform&&!(url.hostname===storageHost&&url.pathname.startsWith('/storage/v1/object/'))))throw new Error('Unsupported image host');
 return url;
}
export async function loadImage(raw:string,storageHost:string):Promise<Blob>{
 let url=allowedImage(raw,storageHost);
 for(let redirects=0;redirects<=3;redirects++){
  const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Accept:'image/*'}});
  if(response.status>=300&&response.status<400){const location=response.headers.get('location');await response.body?.cancel();if(!location)break;url=allowedImage(new URL(location,url).href,storageHost);continue;}
  const type=response.headers.get('content-type')??'';
  if(!response.ok||!type.startsWith('image/')||!response.body){await response.body?.cancel();throw new Error('Image unavailable');}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>16*1024*1024)throw new Error('Image too large');chunks.push(value);}}finally{await reader.cancel();}
  const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
  return new Blob([buffer],{type});
 }
 throw new Error('Image redirect limit');
}
