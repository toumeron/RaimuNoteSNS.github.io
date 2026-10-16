import type {PostWithAuthor} from '@/types';
import type {MediaViewerSelection} from './openMediaViewer';
export function videoSelections(initial:MediaViewerSelection,pages:readonly {posts:PostWithAuthor[]}[]=[]):MediaViewerSelection[]{
 const seen=new Set<string>();
 return [initial,...pages.flatMap(page=>page.posts.filter(post=>post.video||post.externalVideo).map(post=>({post,postId:post.id,url:`video:${post.id}`,video:{postId:post.id,video:post.video??post.externalVideo!,...(post.externalVideo?{externalVideo:post.externalVideo}:{})}})))].filter(item=>{const key=item.video?.postId??item.url;if(seen.has(key))return false;seen.add(key);return true;});
}
/** Either vertical swipe advances; horizontal drags and short taps do not. */
export function videoSwipeDirection(dx:number,dy:number):1|0 {
 return Math.abs(dy)>=64&&Math.abs(dy)>Math.abs(dx)*1.35?1:0;
}
/** Late twitter results can enter the unvisited tail without moving watched slides. */
export function mergeVideoQueue(previous:MediaViewerSelection[],current:MediaViewerSelection,incoming:MediaViewerSelection[],watchedCount=0):MediaViewerSelection[]{
 const key=(item:MediaViewerSelection)=>item.video?.postId??item.url;
 const index=previous.findIndex(item=>key(item)===key(current));
 const seen=new Set<string>();
 const boundary=Math.max(watchedCount,Math.max(0,index)+1);
 return [...previous.slice(0,boundary),...incoming,...previous.slice(boundary)].filter(item=>{
  const id=key(item);if(seen.has(id))return false;seen.add(id);return true;
 });
}
