import type {PostWithAuthor} from '@/types';
import type {MediaViewerSelection} from './openMediaViewer';
export function videoSelections(initial:MediaViewerSelection,pages:readonly {posts:PostWithAuthor[]}[]=[]):MediaViewerSelection[]{
 const seen=new Set<string>();
 return [initial,...pages.flatMap(page=>page.posts.filter(post=>post.video||post.externalVideo).map(post=>({post,postId:post.id,url:`video:${post.id}`,video:{postId:post.id,video:post.video??post.externalVideo!,...(post.externalVideo?{externalVideo:post.externalVideo}:{})}})))].filter(item=>{const key=item.video?.postId??item.url;if(seen.has(key))return false;seen.add(key);return true;});
}
/** A downward vertical gesture advances; a horizontal drag or short tap never does. */
export function videoSwipeDirection(dx:number,dy:number):1|-1|0 {
 return Math.abs(dy)>=64&&Math.abs(dy)>Math.abs(dx)*1.35?(dy>0?1:-1):0;
}
