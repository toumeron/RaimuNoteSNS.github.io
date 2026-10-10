import {useCachedChatImage} from '@/lib/chatImageCache';
import {openMediaViewer} from '@/components/media/openMediaViewer';
export function CachedChatImage({url,account,alt,label,media}:{url:string;account?:string;alt:string;label:string;media?:string[]}){
 const src=useCachedChatImage(url,account);
 return <button type="button" className="dm-media-image" aria-label={label} onClick={()=>openMediaViewer({url:src||url,media:(media??[url]).map(item=>({src:item===url?src||url:item,type:'image'}))})}><img src={src||undefined} alt={alt} loading="lazy" referrerPolicy="no-referrer"/></button>;
}
