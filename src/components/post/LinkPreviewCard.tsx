import {useContext,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {OfflineBookmarkContext} from '@/components/stickers/OfflineBookmarkContext';
import {fetchLinkPreview,singlePreviewUrl,type LinkPreview} from '@/lib/linkPreview';
export function useLinkPreview(content:string,enabled=true,provided?:LinkPreview) {
  const url=singlePreviewUrl(content);
  const seed=url&&provided?.url===url?provided:null;
  const offline=useContext(OfflineBookmarkContext);
  const [failed,setFailed]=useState<string|null>(null);
  const query=useQuery({queryKey:['link-preview-v2',url],queryFn:()=>fetchLinkPreview(url!),enabled:enabled&&!!url&&!offline&&!seed,staleTime:query=>query.state.data?3600000:60000,gcTime:3600000,retry:1});
  const preview=enabled&&url&&failed!==url?(offline?offline.linkPreviews?.[url]??seed:seed??query.data):null;
  return {preview:preview??null,onImageError:()=>setFailed(url),text:(text:string)=>preview?text.replace(url!, '').replace(content.match(/https?:\/\/[^\s<>"\u3000]+/i)?.[0]??url!, '').trim():text};
}
export function LinkPreviewCard({preview,onImageError}:{preview:LinkPreview|null;onImageError?:()=>void}) {
  if(!preview)return null;
  return <a href={preview.url} target="_blank" rel="noopener noreferrer" onClick={event=>event.stopPropagation()} className="mt-3 block w-full max-w-[420px] overflow-hidden rounded-2xl border border-border bg-background text-foreground hover:bg-muted/30" aria-label={preview.title} data-link-preview>
    <img src={preview.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={onImageError} className="block aspect-[2.4/1] max-h-[175px] w-full object-cover" />
    <div className="px-3 py-2"><div className="truncate text-sm text-muted-foreground">{preview.domain}</div><div className="mt-1 line-clamp-2 text-sm leading-snug">{preview.title}</div></div>
  </a>;
}
export function PostLinkPreview({content}:{content:string}){const state=useLinkPreview(content);return <LinkPreviewCard {...state}/>;}
