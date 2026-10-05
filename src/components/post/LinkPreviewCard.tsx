import {readSavedPreview,savePreview,savedPreviewImage} from '@/lib/linkPreviewCache';
import {useContext,useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {OfflineBookmarkContext} from '@/components/stickers/OfflineBookmarkContext';
import {fetchLinkPreview,singlePreviewUrl,type LinkPreview} from '@/lib/linkPreview';
export function useLinkPreview(content:string,enabled=true,provided?:LinkPreview,persist=true) {
  const url=singlePreviewUrl(content);
  const saved=url&&persist?readSavedPreview(url):undefined;
  const seed=saved?.preview??(url&&provided?.url===url?provided:null);
  const offline=useContext(OfflineBookmarkContext);
  const [failed,setFailed]=useState<string|null>(null);
  const query=useQuery({queryKey:[persist?'link-preview-saved-v1':'link-preview-live-v1',url],queryFn:()=>fetchLinkPreview(url!,persist),enabled:enabled&&!!url&&!offline&&!seed,initialData:saved?.preview,staleTime:persist&&saved?.preview!==null?Infinity:900_000,gcTime:86400000,retry:1});
  useEffect(()=>{if(persist&&enabled&&url&&provided?.url===url&&!offline&&!saved)savePreview(url,provided);},[persist,enabled,url,provided,offline,saved]);
  const preview=enabled&&url&&failed!==url?(offline?offline.linkPreviews?.[url]??seed:seed??query.data):null;
  return {preview:preview??null,cacheImage:persist&&!offline,onImageError:()=>setFailed(url),text:(text:string)=>preview?text.replace(url!, '').replace(content.match(/https?:\/\/[^\s<>"\u3000]+/i)?.[0]??url!, '').trim():text};
}
export function LinkPreviewCard({preview,onImageError,cacheImage=true}:{preview:LinkPreview|null;onImageError?:()=>void;cacheImage?:boolean}) {
  if(!preview)return null;
  return <a href={preview.url} target="_blank" rel="noopener noreferrer" onClick={event=>event.stopPropagation()} className="mt-3 block w-full max-w-[420px] overflow-hidden rounded-2xl border border-border bg-background text-foreground hover:bg-muted/30" aria-label={preview.title} data-link-preview>
    <SavedImage image={preview.image} cacheImage={cacheImage} alt="" loading="lazy" referrerPolicy="no-referrer" onError={onImageError} className="block aspect-[2.4/1] max-h-[175px] w-full object-cover" />
    <div className="px-3 py-2"><div className="truncate text-sm text-muted-foreground">{preview.domain}</div><div className="mt-1 line-clamp-2 text-sm leading-snug">{preview.title}</div></div>
  </a>;
}

function SavedImage({image,cacheImage,onError,...props}:{image:string;cacheImage:boolean;onError?:()=>void;alt:string;loading:'lazy';referrerPolicy:'no-referrer';className:string}){
 const [loaded,setLoaded]=useState<{image:string;src:string}|null>(null);
 useEffect(()=>{
  if(!cacheImage||!/^https?:\/\//.test(image))return;
  let active=true,objectUrl:string|undefined;
  savedPreviewImage(image).then(blob=>{if(!active)return;objectUrl=blob?URL.createObjectURL(blob):undefined;setLoaded({image,src:objectUrl??image});});
  return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[image,cacheImage]);
 const src=!cacheImage||!/^https?:\/\//.test(image)?image:loaded?.image===image?loaded.src:undefined;
 return <img {...props} src={src} onError={onError}/>;
}

export function PostLinkPreview({content}:{content:string}){const state=useLinkPreview(content);return <LinkPreviewCard {...state}/>;}
