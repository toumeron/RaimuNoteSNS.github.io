import {useState,useEffect} from 'react';
import {useCachedChatImage} from '@/lib/chatImageCache';
import {type FriendPhoto as Photo,validFriendPhoto} from '../../../supabase/functions/_shared/friendImages';
import {openMediaViewer} from '@/components/media/openMediaViewer';
export function FriendPhoto({photo,account}:{photo:Photo|null;account?:string}){
 const src=useCachedChatImage(photo?.url??'',account);const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[photo?.url]);if(!photo||!validFriendPhoto(photo)||failed)return null;
 return <figure className="dm-friend-photo"><div className="dm-message-media"><button type="button" className="dm-media-image" aria-label="フレンドの画像を拡大" onClick={()=>openMediaViewer({url:src||photo.url,media:[{src:src||photo.url,type:'image'}]})}><img src={src||undefined} alt={photo.title} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/></button></div><figcaption><a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer">Wikimedia Commons</a>{photo.artist&&` · ${photo.artist}`} · {photo.license}</figcaption></figure>;
}
