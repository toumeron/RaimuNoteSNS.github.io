import {Image as ImageIcon} from 'lucide-react';
import {ProfileMediaPreview} from '@/components/ui/avatar';
import {openMediaViewer} from '@/lib/mediaThumbnail';
import type {PostWithAuthor} from '@/types';

/** Use the profile's square previews and viewer, retaining the community post. */
export function CommunityMediaGrid({posts}:{posts:PostWithAuthor[]}){
 const seen=new Set<string>();
 const unique=posts.filter(post=>!seen.has(post.id)&&!!seen.add(post.id));
 return <div data-lime-profile-media-grid className="grid grid-cols-3 gap-1 px-0 sm:px-4 md:gap-2">{unique.flatMap(post=>{
  const video=post.video||post.externalVideo;
  if(video)return <button key={`${post.id}-video`} type="button" aria-label="動画を開く" className="relative aspect-square cursor-pointer overflow-hidden rounded-md bg-muted animate-float-up md:rounded-xl" onClick={()=>openMediaViewer({url:`video:${post.id}`,post,postId:post.id,video:{postId:post.id,video,externalVideo:post.externalVideo}})}><ProfileMediaPreview postId={post.id} duration={video.duration} thumbnail={post.externalVideo?.thumbnail} external={!!post.externalVideo}/></button>;
  const images=[...new Set(post.imageUrls??[])];
  return images.map((url,index)=><button key={`${post.id}-${url}`} type="button" aria-label={`画像${index+1}を開く`} className="relative aspect-square cursor-pointer overflow-hidden rounded-md bg-muted animate-float-up md:rounded-xl" onClick={()=>openMediaViewer({url,post})}><ProfileMediaPreview src={url}/>{images.length>1&&<span aria-hidden="true" className="absolute right-1.5 top-1.5 rounded-md bg-black/40 p-1 backdrop-blur-sm"><ImageIcon className="h-3.5 w-3.5 text-white"/></span>}</button>);
 })}</div>;
}
