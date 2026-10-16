import { type PostWithAuthor } from "@/types/index";
import { type MediaViewerSelection } from "@/components/media/openMediaViewer";

// mediaThumbnail
/** Grid previews use CDN thumbnails; viewer selections retain their original URLs. */
function mediaThumbnailUrl(src:string):string{
 try{
  const url=new URL(src);
  if(url.protocol!=='https:')return src;
  if(url.hostname==='pbs.twimg.com'&&url.pathname.startsWith('/media/')){
   url.searchParams.set('name','small');return url.href;
  }
  if(url.hostname==='cdn.bsky.app'&&url.pathname.startsWith('/img/feed_fullsize/')){
   url.pathname=url.pathname.replace('/img/feed_fullsize/','/img/feed_thumbnail/');return url.href;
  }
 }catch{}
 return src;
}

// externalVideoSource
/** MP4/GIF sources without HLS variants need a referrer-free read as well. */
async function resolveExternalMp4(url:string,signal:AbortSignal){
 const response=await fetch(url,{signal,referrerPolicy:'no-referrer'});
 if(!response.ok)throw new Error('動画を読み込めませんでした');
 const blob=await response.blob();
 if(signal.aborted)throw new DOMException('Aborted','AbortError');
 return URL.createObjectURL(blob);
}

// inlineVideoFrame
/** Fit inline videos just like post images. Small ratio-only metadata (16/9,
 * etc.) must not be mistaken for the video's natural pixel dimensions. */
function inlineVideoFrame(width:number,height:number,mobile:boolean,embedded=false):{width:string;maxWidth:string}{
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0){width=16;height=9;}
 // A quoted video belongs to the card width, independent of source resolution.
 if(embedded)return {width:'100%',maxWidth:'100%'};
 const maxHeight=mobile?300:480;
 const naturalLimit=width>=64&&height>=64?width:Infinity;
 const displayWidth=Math.max(1,Math.floor(Math.min(naturalLimit,maxHeight*width/height)));
 return {width:`${displayWidth}px`,maxWidth:'100%'};
}

// mediaGeometry
type Point = { x: number; y: number };
function containSize(width: number, height: number, naturalWidth: number, naturalHeight: number) {
  const ratio = Math.min(width / (naturalWidth || width), height / (naturalHeight || height));
  return { width: (naturalWidth || width) * ratio, height: (naturalHeight || height) * ratio };
}
function clampPan(point: Point, image: { width: number; height: number }, viewport: { width: number; height: number }, zoom: number): Point {
  const x = Math.max(0, (image.width * zoom - viewport.width) / 2);
  const y = Math.max(0, (image.height * zoom - viewport.height) / 2);
  return { x: Math.max(-x, Math.min(x, point.x)), y: Math.max(-y, Math.min(y, point.y)) };
}
function focalPan(pan: Point, oldZoom: number, newZoom: number, focal: Point): Point {
  const ratio = newZoom / oldZoom;
  return { x: focal.x - (focal.x - pan.x) * ratio, y: focal.y - (focal.y - pan.y) * ratio };
}

// Ignore finger jitter and soften scaling while retaining the full zoom range.
function pinchZoom(startZoom: number, startDistance: number, distance: number) {
  if (startDistance < 40 || Math.abs(distance - startDistance) < 6) return startZoom;
  return Math.min(12, Math.max(1, startZoom * Math.pow(distance / startDistance, .7)));
}

// videoSequence
function videoSelections(initial:MediaViewerSelection,pages:readonly {posts:PostWithAuthor[]}[]=[]):MediaViewerSelection[]{
 const seen=new Set<string>();
 return [initial,...pages.flatMap(page=>page.posts.filter(post=>post.video||post.externalVideo).map(post=>({post,postId:post.id,url:`video:${post.id}`,video:{postId:post.id,video:post.video??post.externalVideo!,...(post.externalVideo?{externalVideo:post.externalVideo}:{})}})))].filter(item=>{const key=item.video?.postId??item.url;if(seen.has(key))return false;seen.add(key);return true;});
}
/** Either vertical swipe advances; horizontal drags and short taps do not. */
function videoSwipeDirection(dx:number,dy:number):1|0 {
 return Math.abs(dy)>=64&&Math.abs(dy)>Math.abs(dx)*1.35?1:0;
}
/** Late twitter results can enter the unvisited tail without moving watched slides. */
function mergeVideoQueue(previous:MediaViewerSelection[],current:MediaViewerSelection,incoming:MediaViewerSelection[],watchedCount=0):MediaViewerSelection[]{
 const key=(item:MediaViewerSelection)=>item.video?.postId??item.url;
 const index=previous.findIndex(item=>key(item)===key(current));
 const seen=new Set<string>();
 const boundary=Math.max(watchedCount,Math.max(0,index)+1);
 return [...previous.slice(0,boundary),...incoming,...previous.slice(boundary)].filter(item=>{
  const id=key(item);if(seen.has(id))return false;seen.add(id);return true;
 });
}

export { mediaThumbnailUrl };
export { resolveExternalMp4 };
export { inlineVideoFrame };
export { containSize };
export { clampPan };
export { focalPan };
export { pinchZoom };
export type { Point };
export { videoSelections };
export { videoSwipeDirection };
export { mergeVideoQueue };
