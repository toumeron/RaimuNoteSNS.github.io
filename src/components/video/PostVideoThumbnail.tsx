import {useEffect,useRef,useState} from 'react';
import {resolvePostVideoPoster} from '@/lib/postVideoStorage';
export function PostVideoThumbnail({postId,duration,thumbnail,external}:{postId:string;duration:number;thumbnail?:string;external?:boolean}){
 const element=useRef<HTMLDivElement>(null),[url,setUrl]=useState<string>();
 useEffect(()=>{if(external){setUrl(thumbnail);return;}let local:string|undefined;const abort=new AbortController();setUrl(undefined);const observer=new IntersectionObserver(entries=>{if(!entries.some(entry=>entry.isIntersecting))return;observer.disconnect();void resolvePostVideoPoster(postId,abort.signal).then(url=>{if(abort.signal.aborted)URL.revokeObjectURL(url);else{local=url;setUrl(url);}}).catch(()=>{});},{rootMargin:'120px'});if(element.current)observer.observe(element.current);return()=>{abort.abort();observer.disconnect();if(local)URL.revokeObjectURL(local);};},[postId,thumbnail,external]);
 return <div ref={element} className="relative h-full w-full bg-black">{url&&<img referrerPolicy="no-referrer" src={url} loading="lazy" decoding="async" alt="動画のプレビュー" className="h-full w-full object-cover"/>}{duration>0&&<span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-1 text-sm leading-none text-white tabular-nums">{Math.floor(Math.max(0,duration)/60)}:{Math.floor(Math.max(0,duration)%60).toString().padStart(2,'0')}</span>}</div>;
}
