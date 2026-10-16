import {memo} from 'react';
import {useInView} from 'react-intersection-observer';
import {PrivateMediaImage} from '@/components/media/PrivateMediaImage';
import {PostVideoThumbnail} from '@/components/video/PostVideoThumbnail';
import {mediaThumbnailUrl} from '@/lib/mediaThumbnail';
/** Preserve grid geometry, releasing decoded images/posters outside the nearby rows. */
export const ProfileMediaPreview=memo(function ProfileMediaPreview({src,postId,duration,thumbnail,external}:{src?:string;postId?:string;duration?:number;thumbnail?:string;external?:boolean}){
 const {ref,inView}=useInView({initialInView:false,rootMargin:'400px 0px'});
 return <div ref={ref} className="h-full w-full">{inView&&(duration!==undefined&&postId?<PostVideoThumbnail postId={postId} duration={duration} thumbnail={thumbnail} external={external}/>:src?<PrivateMediaImage src={mediaThumbnailUrl(src)} referrerPolicy={/^https:\/\/pbs[.]twimg[.]com\//.test(src)?'no-referrer':undefined} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async"/>:null)}</div>;
});
