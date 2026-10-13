import {Link2} from 'lucide-react';
import {YouTubeEmbed} from '@/components/YouTubeEmbed';
const linkPattern=/https?:\/\/[^\s<>"']+/g;
export function youtubeMessageId(value:string):string|null {
 try{
  const url=new URL(value);
  let id:string|null=null;
  if(url.hostname==='youtu.be')id=url.pathname.split('/')[1];
  else if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com'].includes(url.hostname)){
   if(url.pathname==='/watch')id=url.searchParams.get('v');
   else if(/^\/(shorts|live|embed)\//.test(url.pathname))id=url.pathname.split('/')[2];
  }
  return id&&/^[\w-]{11}$/.test(id)?id:null;
 }catch{return null;}
}
export function directMessageVideoIds(content:string):string[] {
 return [...new Set([...content.matchAll(linkPattern)].map(match=>youtubeMessageId(match[0].replace(/[。、,!?）)\]}]+$/g,''))).filter((id):id is string=>!!id))].slice(0,3);
}
export function directMessageText(content:string):string {
 return content.replace(linkPattern,link=>youtubeMessageId(link.replace(/[。、,!?）)\]}]+$/g,''))?'':link).trim();
}
export function DirectMessageMedia({content}:{content:string}) {
 const videos=directMessageVideoIds(content);
 return videos.length?<div className="dm-message-media dm-youtube-media">{videos.map(id=><div key={id} className="dm-video-embed" onClick={event=>event.stopPropagation()}><YouTubeEmbed videoId={id}/></div>)}</div>:null;
}
export function DirectMessageContent({content}:{content:string}) {
 const text=directMessageText(content);
 if(!text)return null;
 let solo:URL|null=null;
 if(/^https?:\/\/[^\s]+$/.test(text)){try{solo=new URL(text);}catch{/* Render an incomplete URL as ordinary message text. */}}
 return <div className="dm-message-text">
  {solo?<a className="dm-link-card" href={solo.href} target="_blank" rel="noopener noreferrer" title={solo.href} onClick={event=>event.stopPropagation()}><span className="dm-link-icon" aria-hidden="true"><Link2 size={22}/></span><span className="dm-link-copy"><strong>{solo.href.replace(/^https?:\/\//,'')}</strong><span className="dm-link-domain">{solo.hostname}</span></span></a>:<p>{text.split(/(https?:\/\/[^\s]+)/g).map((part,i)=>/^https?:\/\//.test(part)?<a key={i} href={part} target="_blank" rel="noopener noreferrer" onClick={event=>event.stopPropagation()}>{part}</a>:part)}</p>}
 </div>;
}
