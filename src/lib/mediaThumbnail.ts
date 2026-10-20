import { type PostWithAuthor } from "@/types/index";
import { type MediaViewerSelection } from "@/components/media/openMediaViewer";
import { supabase } from "@/lib/supabase";
import { spaceLinkIn } from "@/lib/utils";
import { randomUUID } from "@/lib/utils";
import { privateMediaReference, MEDIA_PREFIX, POST_MEDIA_BUCKET } from "@/lib/privateMediaFetch";
import { getCurrentUserId } from "@/lib/currentUser";
import { allowAccountWrite } from "@/lib/accountSuspension";

// mediaThumbnail
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

/** Geometry is selected from post metadata before mounting media, never from playback. */
export function initialMediaSize(size?:{width?:number;height?:number}|null,src?:string){
 const saved=(src?privateMediaReference(src):undefined)?.match(/--(\d+)x(\d+)\.[a-z0-9]+(?:[?#].*)?$/i);
 const width=size?.width??(saved?Number(saved[1]):0),height=size?.height??(saved?Number(saved[2]):0);
 return Number.isFinite(width)&&Number.isFinite(height)&&(width??0)>0&&(height??0)>0?{width:width!,height:height!}:{width:16,height:9};
}
/** Legacy attachments have no dimensions. Remove portrait side gutters while
 * retaining the reserved height, so decoding cannot move the posts below. */
export function fitLegacyImageFrame(image:HTMLImageElement){
 const frame=image.closest<HTMLElement>('[data-lime-single-post-image][data-lime-media-fallback="true"]');
 if(!frame||!image.naturalWidth||!image.naturalHeight)return;
 const box=frame.getBoundingClientRect(),ratio=image.naturalWidth/image.naturalHeight;
 if(box.height<=0||ratio>=box.width/box.height-.01)return;
 frame.style.width=`${box.height*ratio}px`;
 frame.style.aspectRatio=`${image.naturalWidth}/${image.naturalHeight}`;
}
export function initialImageFrame(size:{width:number;height:number},mobile:boolean){
 const frame=(()=>{
    const naturalWidth = Math.max(1, size.width);
    const naturalHeight = Math.max(1, size.height);
    const ratio = naturalWidth / naturalHeight;

    const maxTimelineImageHeight = mobile ? 300 : 480;
    const minimumReadableWidth = mobile ? 88 : 110;
    const heightLimitedWidth = Math.max(
      minimumReadableWidth,
      Math.round(maxTimelineImageHeight * ratio)
    );
    const shouldLimitByHeight = ratio < (mobile ? 1.64 : 1.72);
    const shouldAvoidUpscale = naturalWidth >= 64 && naturalWidth <= (mobile ? 360 : 520);
    const shouldNarrowUltraWide = ratio >= 2.35;

    if (shouldLimitByHeight) {
      const width = shouldAvoidUpscale
        ? Math.min(naturalWidth, heightLimitedWidth)
        : heightLimitedWidth;

      return {
        width: `min(100%, ${Math.max(minimumReadableWidth, width)}px)`,
        maxWidth: '100%',
      };
    }

    if (shouldAvoidUpscale) {
      return {
        width: `${naturalWidth}px`,
        maxWidth: '100%',
      };
    }

    if (shouldNarrowUltraWide) {
      return {
        width: mobile ? '100%' : 'min(100%, 560px)',
        maxWidth: '100%',
      };
    }

    return {
      width: '100%',
      maxWidth: '100%',
    };
 })();
 return {...frame,aspectRatio:`${size.width}/${size.height}`};
}
async function attachmentDimensions(file:Blob):Promise<{width:number;height:number}|null>{
 try{
  if(typeof createImageBitmap==='function'){const bitmap=await createImageBitmap(file);const size={width:bitmap.width,height:bitmap.height};bitmap.close();return size;}
  const url=URL.createObjectURL(file);
  try{return await new Promise(resolve=>{const image=new Image();image.onload=()=>resolve({width:image.naturalWidth,height:image.naturalHeight});image.onerror=()=>resolve(null);image.src=url;});}finally{URL.revokeObjectURL(url);}
 }catch{return null;}
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

// postVideo
const MAX_VIDEO_SECONDS = 90;
const MAX_VIDEO_BYTES = 36 * 1024 * 1024;
type PostVideo = {key:string;duration:number;width:number;height:number;size:number;mimeType:'video/mp4';posterKey?:string};
type PreparedVideo = {file:File;poster?:Blob;url:string;duration:number;width:number;height:number};
function videoDimensions(width:number,height:number,maxLong=1920,maxShort=1080) {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('動画の解像度を読み取れませんでした');
  const scale=Math.min(1,maxLong/Math.max(width,height),maxShort/Math.min(width,height));
  return {width:Math.max(2,Math.floor(width*scale/2)*2),height:Math.max(2,Math.floor(height*scale/2)*2)};
}
function validateVideoDuration(duration:number) {
  if(!Number.isFinite(duration)||duration<=0)throw new Error('動画の長さを読み取れませんでした');
  if(duration>MAX_VIDEO_SECONDS)throw new Error('動画は90秒以内にしてください');
}
/** Transcode before upload; never send the original to a remote service. */
async function preparePostVideo(file:File,onProgress:(progress:number)=>void,signal?:AbortSignal):Promise<PreparedVideo> {
  if(file.size>512*1024*1024)throw new Error('元の動画は512MB以内にしてください');
  const {Input,BlobSource,ALL_FORMATS,Output,Mp4OutputFormat,BufferTarget,Conversion,Quality,CanvasSink}=await import('mediabunny');
  signal?.throwIfAborted();
  const input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
  let conversion:Awaited<ReturnType<typeof Conversion.init>>|undefined;
  const cancel=()=>{void conversion?.cancel();};signal?.addEventListener('abort',cancel,{once:true});
  try{
    const duration=await input.computeDuration();validateVideoDuration(duration);
    const track=await input.getPrimaryVideoTrack();if(!track)throw new Error('映像のある動画を選択してください');
    const candidates=[[1920,1080],[1280,720],[854,480]].map(([long,short])=>videoDimensions(track.displayWidth,track.displayHeight,long,short)).filter((size,index,all)=>all.findIndex(other=>other.width===size.width&&other.height===size.height)===index);
    let prepared:{file:File;width:number;height:number}|undefined,progress=0;
    for(const dimensions of candidates){
      const output=new Output({format:new Mp4OutputFormat({fastStart:'in-memory'}),target:new BufferTarget()});
      // Explicit bitrate, not a qualitative Quality number. Keep the encoded file within the storage limit.
      conversion=await Conversion.init({input,output,tracks:'primary',trim:{end:Math.min(duration,89.75)},video:{...dimensions,fit:'contain',codec:'avc',quality:new Quality({bitrate:2_000_000,bitrateMode:'constant'}),frameRate:30,forceTranscode:true,allowTransformationMetadata:false},audio:{codec:'aac',quality:new Quality({bitrate:96_000})}});
      signal?.throwIfAborted();
      if(!conversion.isValid||conversion.discardedTracks.some(t=>t.track.type==='video'||t.track.type==='audio'))throw new Error('このブラウザーでは動画を変換できません。MP4形式の動画を対応するブラウザーで選択してください');
      conversion.onProgress=value=>{progress=Math.max(progress,value*.9);onProgress(progress);};
      await conversion.execute();signal?.throwIfAborted();
      const buffer=output.target.buffer;if(!buffer)throw new Error('圧縮した動画を生成できませんでした。もう一度お試しください');
      if(buffer.byteLength>MAX_VIDEO_BYTES)continue;
      prepared={file:new File([buffer],file.name.replace(/\.[^.]+$/,'')+'.mp4',{type:'video/mp4'}),...dimensions};break;
    }
    if(!prepared)throw new Error('圧縮した動画が保存できるサイズを超えました');
    const {file:result,...dimensions}=prepared;
    const frame=await new CanvasSink(track,{width:Math.min(480,dimensions.width)}).getCanvas(0);
    let poster:Blob|undefined;
    if(frame){const canvas=frame.canvas;poster='convertToBlob' in canvas?await canvas.convertToBlob({type:'image/jpeg',quality:.7}):await new Promise<Blob>(resolve=>canvas.toBlob(blob=>resolve(blob!), 'image/jpeg',.7));}
    signal?.throwIfAborted();
    // AAC and frame boundaries may add padding: validate the actual encoded file too.
    const encoded=new Input({source:new BlobSource(result),formats:ALL_FORMATS});
    let encodedDuration:number;try{encodedDuration=await encoded.computeDuration();validateVideoDuration(encodedDuration);}finally{encoded.dispose();}
    onProgress(1);return {poster,file:result,url:URL.createObjectURL(result),duration:encodedDuration,...dimensions};
  }finally{signal?.removeEventListener('abort',cancel);input.dispose();}
}

// linkPreview
type LinkPreview={url:string;domain:string;title:string;image:string;description?:string};
function previewUrlMatches(first:string|null,second:string|undefined):boolean{
 try{return !!first&&!!second&&new URL(first).href===new URL(second).href;}catch{return false;}
}
function singlePreviewUrl(content:string):string|null {
  const urls=content.match(/https?:\/\/[^\s<>"\u3000]+/gi)??[];
  if(urls.length!==1)return null;
  const raw=urls[0].replace(/[.,!?:;、。！？」』）)]+$/,'');
  try{
    const url=new URL(raw);
    if(url.username||url.password||spaceLinkIn(raw)||/(^|\.)(youtube\.com|youtu\.be|spotify\.com)$/.test(url.hostname)||/\.(png|jpe?g|gif|webp|avif|svg)(?:$|\?)/i.test(url.pathname)||url.origin===window.location.origin&&/\/(post|posts|spaces)\//.test(url.pathname))return null;
    return url.href;
  }catch{return null;}
}
const pending=new Map<string,Promise<LinkPreview|null>>();
async function fetchLinkPreview(url:string,persist=true):Promise<LinkPreview|null> {
  if(persist){const saved=readSavedPreview(url);if(saved)return saved.preview;}
  const key=`${persist?'saved':'live'}:${url}`;
  const active=pending.get(key);if(active)return active;
  const request=(async()=>{
    try{
      const {data,error}=await supabase.functions.invoke('link-preview',{body:{url}});const value=data?.preview;
      if(error||data?.retryable)return null;
      const preview=value&&typeof value.title==='string'&&typeof value.image==='string'&&typeof value.domain==='string'&&(value.title.trim()||typeof value.description==='string'&&value.description.trim())&&(!value.image||/^https?:\/\//.test(value.image))?{...value,url} as LinkPreview:null;
      if(persist)savePreview(url,preview);
      return preview;
    }catch{return null;}
  })().finally(()=>pending.delete(key));
  pending.set(key,request);return request;
}

const KEY='lime-link-previews-v1';
type Entry={preview:LinkPreview|null;savedAt:number;version?:number};
function entries():Record<string,Entry>{try{const value=JSON.parse(localStorage.getItem(KEY)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}}
function readSavedPreview(url:string):Entry|undefined{
 const entry=entries()[url];
 if(!entry||typeof entry.savedAt!=='number')return;
 if(entry.preview===null)return entry.version===6&&Date.now()-entry.savedAt<900_000?entry:undefined;
 const p=entry.preview;
 // Old Amazon cards only retained the storefront title and lost the product image.
 if(p&&/(^|\.)amazon\.co\.jp$/.test(p.domain)&&(/^Amazon\.co\.jp\s*$/i.test(p.title)||!p.image&&(entry.version!==6||Date.now()-entry.savedAt>=900_000)))return;
 return p?.url===url&&typeof p.title==='string'&&typeof p.domain==='string'&&typeof p.image==='string'&&(!p.image||/^https?:\/\//.test(p.image))?entry:undefined;
}
function savePreview(url:string,preview:LinkPreview|null){
 try{const saved=entries();saved[url]={preview,savedAt:Date.now(),version:6};const keys=Object.keys(saved).sort((a,b)=>(saved[a]?.savedAt??0)-(saved[b]?.savedAt??0));for(const key of keys.slice(0,Math.max(0,keys.length-200)))delete saved[key];localStorage.setItem(KEY,JSON.stringify(saved));}catch{/* Preview rendering still works when storage is unavailable. */}
 if(preview?.image)void savePreviewImage(preview.image);
}
const IMAGE_DB='lime-link-preview-images';
type SavedImage={url:string;bytes:ArrayBuffer;type:string;savedAt:number};
function imageDb():Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(IMAGE_DB,1);
  request.onupgradeneeded=()=>request.result.createObjectStore('images',{keyPath:'url'});
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
}
async function writeImage(url:string,blob:Blob){
 const bytes=await blob.arrayBuffer(),db=await imageDb();
 try{await new Promise<void>((resolve,reject)=>{
  const tx=db.transaction('images','readwrite'),store=tx.objectStore('images');
  const request=store.getAll();
  request.onsuccess=()=>{
   const records=(request.result as SavedImage[]).filter(record=>record.url!==url).sort((a,b)=>a.savedAt-b.savedAt);
   let totalBytes=records.reduce((sum,record)=>sum+record.bytes.byteLength,bytes.byteLength);
   while(records.length>=200||totalBytes>40*1024*1024){const oldest=records.shift();if(!oldest)break;totalBytes-=oldest.bytes.byteLength;store.delete(oldest.url);}
   store.put({url,bytes,type:blob.type,savedAt:Date.now()});
  };
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 });}finally{db.close();}
}
const imageRequests=new Map<string,Promise<void>>();
function savePreviewImage(url:string):Promise<void>{
 if(typeof indexedDB==='undefined'||!/^https?:\/\//.test(url))return Promise.resolve();
 const pending=imageRequests.get(url);if(pending)return pending;
 const task=(async()=>{try{
  if(await savedPreviewImage(url))return;
  const response=await fetch(url,{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)return;
  const blob=await response.blob();if(blob.size>8*1024*1024||!blob.size||blob.type.startsWith('text/'))return;
  await writeImage(url,blob);
 }catch{/* Sites that disallow CORS use the normal browser image cache. */}})().finally(()=>imageRequests.delete(url));
 imageRequests.set(url,task);return task;
}
async function savedPreviewImage(url:string):Promise<Blob|null>{
 if(typeof indexedDB==='undefined')return null;
 try{
  const db=await imageDb();
  try{return await new Promise<Blob|null>((resolve,reject)=>{
   const tx=db.transaction('images','readonly'),request=tx.objectStore('images').get(url);
   request.onsuccess=()=>resolve(request.result?new Blob([request.result.bytes],{type:request.result.type}):null);request.onerror=()=>reject(request.error);
  });}finally{db.close();}
 }catch{return null;}
}

// uploadPostMedia
// uploadCommentImages
/** Safe compatibility helper for future callers. Actual replies supply their
 * parent audience through createComment. Default to private attachments. */
async function uploadCommentImages(urls:string[]):Promise<string[]> {
 if(urls.length>4)throw new Error('画像は4枚まで添付できます');
 if(!urls.length)return [];
 const owner=await getCurrentUserId();if(!owner)throw new Error('ログインしてください');
 return uploadPostMedia(urls,owner,randomUUID(),true);
}

// uploadPostMedia
const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
async function uploadPostMedia(urls: string[], ownerId: string, resourceId: string, restricted: boolean): Promise<string[]> {
  if (urls.length > 4) throw new Error('画像は4枚まで添付できます');
  // Validate the complete batch before sending any bytes outside this device.
  if (restricted && urls.some(url => /^https?:\/\//i.test(url))) throw new Error('限定投稿には端末から選んだ画像を添付してください。公開URLの画像は非公開にできません');
  if (urls.some(url => !url.startsWith('blob:') && !/^https?:\/\//i.test(url))) throw new Error('画像の形式が正しくありません');
  const uploaded: string[] = [];
  try {
    const results: string[] = [];
    for (const url of urls) {
      if (/^https?:\/\//i.test(url)) { results.push(url); continue; }
      const response = await fetch(url);
      if (!response.ok) throw new Error('添付画像を読み込めませんでした');
      const file = await response.blob(), ext = extensions[file.type];
      if (!ext || file.size > 10 * 1024 * 1024) throw new Error('画像はPNG・JPEG・WebP・GIF・AVIF形式、10MB以内にしてください');
      const dimensions=await attachmentDimensions(file);
      const path = `${ownerId}/${resourceId}/${randomUUID()}${dimensions?`--${dimensions.width}x${dimensions.height}`:""}.${ext}`;
      const {error} = await supabase.storage.from(POST_MEDIA_BUCKET).upload(path, file, {upsert: false, contentType: file.type, cacheControl: '0'});
      if (error) {
        const detail=error.message?.trim();
        throw new Error(detail ? `画像のアップロードに失敗しました（${detail}）` : '画像のアップロードに失敗しました', {cause:error});
      }
      uploaded.push(path);
      results.push(`${MEDIA_PREFIX}${path}`);
    }
    return results;
  } catch (error) {
    if (uploaded.length) await supabase.storage.from(POST_MEDIA_BUCKET).remove(uploaded);
    throw error;
  }
}

async function uploadProfileMedia(file: File,kind:'timeline-background'|'emoji'):Promise<{secure_url:string;public_id:string;format:string}> {
 const body=new FormData();body.set('file',file);body.set('kind',kind);
 const {data,error}=await supabase.functions.invoke('upload-profile-media',{body});
 if(error||!data?.secure_url||!data?.public_id)throw new Error(data?.error||'画像のアップロードに失敗しました');
 return data;
}

// postVideoStorage
function videoServiceUrl():string {
 const value=import.meta.env.VITE_VIDEO_WORKER_URL?.replace(/\/$/,'');
 if(!value)throw new Error('動画保存サービスがまだ設定されていません');
 const url=new URL(value);if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw new Error('動画保存先の設定が無効です');
 return value;
}
async function headers(){const {data}=await supabase.auth.getSession();return data.session?{Authorization:`Bearer ${data.session.access_token}`} : {};}
async function uploadPostVideo(video:PreparedVideo,postId:string):Promise<PostVideo> {
 if(!allowAccountWrite())throw new Error('凍結中は動画を投稿できません');
 const form=new FormData();form.set('video',video.file);if(video.poster)form.set('poster',video.poster,'poster.jpg');
 const response=await fetch(`${videoServiceUrl()}/uploads/${postId}`,{method:'POST',headers:await headers(),body:form});
 const body=await response.json();if(!response.ok)throw new Error(body.error||'動画を保存できませんでした');return body.video;
}
async function discardPostVideo(video:PostVideo):Promise<void>{
 await fetch(`${videoServiceUrl()}/uploads/${video.key}`,{method:'DELETE',headers:await headers()}).catch(()=>{});
}
/** The worker verifies ownership, removes both objects, then deletes the post using user RLS. */
async function deleteVideoPost(postId:string):Promise<void>{
 const response=await fetch(`${videoServiceUrl()}/posts/${encodeURIComponent(postId)}`,{method:'DELETE',headers:await headers()});
 const body=await response.json().catch(()=>null);
 if(!response.ok||body?.ok!==true)throw new Error(body?.error||'動画付き投稿を削除できませんでした');
}

/** Public media streams with Range. Restricted media remains a local blob, never a public URL. */
async function resolvePostVideo(postId:string,signal:AbortSignal):Promise<{url:string;local:boolean}>{
 const base=videoServiceUrl(),auth=await headers();
 const access=await fetch(`${base}/access/${encodeURIComponent(postId)}`,{headers:auth,signal,cache:'no-store'});
 if(!access.ok)throw new Error('この動画を閲覧できません');
 const {public:publicAccess}=await access.json();
 const url=`${base}/media/${encodeURIComponent(postId)}`;
 if(publicAccess)return {url,local:false};
 const response=await fetch(url,{headers:auth,signal,cache:'no-store'});
 if(!response.ok)throw new Error('動画を読み込めませんでした');
 return {url:URL.createObjectURL(await response.blob()),local:true};
}

async function resolvePostVideoPoster(postId:string,signal:AbortSignal):Promise<string>{
 const response=await fetch(`${videoServiceUrl()}/poster/${encodeURIComponent(postId)}`,{headers:await headers(),signal,cache:'no-store'});
 if(!response.ok)throw new Error('動画のプレビューを読み込めません');
 return URL.createObjectURL(await response.blob());
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
export { videoDimensions };
export { validateVideoDuration };
export { preparePostVideo };
export { MAX_VIDEO_SECONDS };
export { MAX_VIDEO_BYTES };
export type { PostVideo };
export type { PreparedVideo };
export { previewUrlMatches };
export { singlePreviewUrl };
export { fetchLinkPreview };
export { readSavedPreview };
export { savePreview };
export { savePreviewImage };
export { savedPreviewImage };
export type { LinkPreview };
export { uploadPostMedia };
export { uploadProfileMedia };
export { videoServiceUrl };
export { uploadPostVideo };
export { discardPostVideo };
export { deleteVideoPost };
export { resolvePostVideo };
export { resolvePostVideoPoster };
export { uploadCommentImages };
