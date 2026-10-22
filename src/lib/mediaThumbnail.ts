import { type PostWithAuthor } from "@/types/index";
import { supabase, allowAccountWrite } from "@/lib/supabase";
import { spaceLinkIn, randomUUID, isInstalledPwa, type CustomSticker } from "@/lib/utils";
import { privateMediaReference, MEDIA_PREFIX, POST_MEDIA_BUCKET, boundedResponseBlob, isDeferredPrivateMedia, resolvePrivateMediaUrl, retainPrivateMediaUrl, ResponseTooLarge } from "@/lib/privateMediaFetch";
import { getCurrentUserId } from "@/lib/currentUser";
import { type ContextType } from "react";
import { type OfflineBookmarkContext } from "@/components/feed/QuotedPost";
import { type LiveSpace } from "@/components/spaces/SpaceProvider";

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
/** Upward swipes advance; downward swipes return to the previous watched video. */
function videoSwipeDirection(dx:number,dy:number):-1|0|1 {
 return Math.abs(dy)>=64&&Math.abs(dy)>Math.abs(dx)*1.35?(dy<0?1:-1):0;
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
let previousPreviewJson:string|undefined,previousPreviewEntries:Record<string,Entry>={};
function entries():Record<string,Entry>{try{
 const raw=localStorage.getItem(KEY)||'{}';if(raw===previousPreviewJson)return previousPreviewEntries;
 previousPreviewJson=raw;previousPreviewEntries={};
 const value=JSON.parse(raw);if(value&&typeof value==='object'&&!Array.isArray(value))previousPreviewEntries=value;
 return previousPreviewEntries;
}catch{return {};}}
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
 try{const saved={...entries()};saved[url]={preview,savedAt:Date.now(),version:6};const keys=Object.keys(saved).sort((a,b)=>(saved[a]?.savedAt??0)-(saved[b]?.savedAt??0));for(const key of keys.slice(0,Math.max(0,keys.length-200)))delete saved[key];const raw=JSON.stringify(saved);localStorage.setItem(KEY,raw);previousPreviewJson=raw;previousPreviewEntries=saved;}catch{/* Preview rendering still works when storage is unavailable. */}
 if(preview?.image)void savePreviewImage(preview.image);
}
const IMAGE_DB='lime-link-preview-images';
type SavedImage={url:string;bytes:ArrayBuffer;type:string;savedAt:number;size:number};
const IMAGE_EVICTION_INDEX='by-saved-size-url';
function imageDb():Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(IMAGE_DB,2);
  request.onupgradeneeded=event=>{
   const store=event.oldVersion===0?request.result.createObjectStore('images',{keyPath:'url'}):request.transaction!.objectStore('images');
   store.createIndex(IMAGE_EVICTION_INDEX,['savedAt','size','url']);
   // Populate metadata once for existing images, retaining offline cache bytes.
   if(event.oldVersion>0){
    const scan=store.openCursor();
    scan.onsuccess=()=>{const cursor=scan.result;if(!cursor)return;const record=cursor.value as SavedImage;cursor.update({...record,size:record.bytes.byteLength});cursor.continue();};
   }
  };
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
}
async function writeImage(url:string,blob:Blob){
 const bytes=await blob.arrayBuffer(),db=await imageDb();
 try{await new Promise<void>((resolve,reject)=>{
  const tx=db.transaction('images','readwrite'),store=tx.objectStore('images');
  // Key cursors expose eviction metadata without cloning cached image buffers.
  const records:Array<{url:string;savedAt:number;size:number}>=[];
  const request=store.index(IMAGE_EVICTION_INDEX).openKeyCursor();
  request.onsuccess=()=>{
   const cursor=request.result;
   if(cursor){const [savedAt,size,key]=cursor.key as [number,number,string];if(key!==url)records.push({url:key,savedAt,size});cursor.continue();return;}
   let totalBytes=records.reduce((sum,record)=>sum+record.size,bytes.byteLength);
   while(records.length>=200||totalBytes>40*1024*1024){const oldest=records.shift();if(!oldest)break;totalBytes-=oldest.size;store.delete(oldest.url);}
   store.put({url,bytes,size:bytes.byteLength,type:blob.type,savedAt:Date.now()});
  };
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 });}finally{db.close();}
}
const imageRequests=new Map<string,Promise<void>>();
const imageJobs:Array<{run:()=>Promise<void>;resolve:()=>void}>=[];
let activeImageJobs=0;
function pumpImageJobs(){
 const limit=isInstalledPwa()?2:4;
 while(activeImageJobs<limit&&imageJobs.length){
  const job=imageJobs.shift()!;activeImageJobs++;
  void Promise.resolve().then(job.run).catch(()=>{}).finally(()=>{activeImageJobs--;job.resolve();pumpImageJobs();});
 }
}
/** Checking existence must not clone an entire cached image into JS memory. */
async function hasSavedPreviewImage(url:string):Promise<boolean>{
 try{
  const db=await imageDb();
  try{return await new Promise<boolean>((resolve,reject)=>{
   const request=db.transaction('images','readonly').objectStore('images').count(url);
   request.onsuccess=()=>resolve(request.result>0);request.onerror=()=>reject(request.error);
  });}finally{db.close();}
 }catch{return false;}
}
function savePreviewImage(url:string):Promise<void>{
 if(typeof indexedDB==='undefined'||!/^https?:\/\//.test(url))return Promise.resolve();
 const pending=imageRequests.get(url);if(pending)return pending;
 const run=async()=>{try{
  if(await hasSavedPreviewImage(url))return;
  const response=await fetch(url,{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});if(!response.ok)return;
  const blob=await boundedResponseBlob(response,8*1024*1024);if(!blob.size||blob.type.startsWith('text/'))return;
  await writeImage(url,blob);
 }catch{/* Sites that disallow CORS use the normal browser image cache. */}};
 const task=new Promise<void>(resolve=>imageJobs.push({run,resolve})).finally(()=>imageRequests.delete(url));
 imageRequests.set(url,task);pumpImageJobs();return task;
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


// openMediaViewer
export type ViewerMedia = { src: string; type?: 'image' | 'youtube' | 'video'; youtubeId?: string };
export type MediaViewerSelection = {
  video?: { video: Pick<PostVideo,'duration'|'width'|'height'>; postId?: string; previewUrl?: string; externalVideo?: import('@/types').ExternalVideo };
  offline?: ContextType<typeof OfflineBookmarkContext>;
  url: string;
  post?: PostWithAuthor;
  postId?: string;
  media?: ViewerMedia[];
};
export const MEDIA_VIEWER_EVENT = 'lime-open-media-viewer';
/** Open the same viewer from every timeline, thread and media grid. */
export function openMediaViewer(selection: MediaViewerSelection) {
  window.dispatchEvent(new CustomEvent(MEDIA_VIEWER_EVENT, { detail: selection }));
}


// offlineBookmarks
export {isInstalledPwa} from "@/lib/utils";
type OfflineSpaceCard = LiveSpace & {is_active:boolean};
type OfflineBookmarks = {userId:string; savedAt:string; posts:PostWithAuthor[]; emojis:CustomSticker[]; linkPreviews?:Record<string,LinkPreview|null>; spaces?:Record<string,OfflineSpaceCard|null>; assets:{url:string;bytes:ArrayBuffer;type:string}[]};
const DATABASE='lime-offline-bookmarks-v1';
function database():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE,2);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('accounts'))request.result.createObjectStore('accounts',{keyPath:'userId'});if(!request.result.objectStoreNames.contains('assets'))request.result.createObjectStore('assets',{keyPath:['userId','generation','url']});};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('オフライン保存を開けませんでした'));
  });
}
type StoredSnapshot=OfflineBookmarks & {generation?:string;assetUrls?:string[]};
async function readOfflineBookmarks(userId:string,includeAssets=true):Promise<OfflineBookmarks|null> {
 const db=await database();
 try{
  // Read the snapshot and its generation in one transaction so a concurrent
  // save cannot delete its image generation halfway through this read.
  return await new Promise<OfflineBookmarks|null>((resolve,reject)=>{
   const tx=db.transaction(['accounts','assets'],'readonly');
   let value:StoredSnapshot|null=null;const assets:OfflineBookmarks['assets']=[];
   const request=tx.objectStore('accounts').get(userId);
   request.onsuccess=()=>{
    value=request.result??null;
    if(!value||!includeAssets||!value.generation)return;
    for(const url of value.assetUrls??[]){
     const asset=tx.objectStore('assets').get([userId,value.generation,url]);
     asset.onsuccess=()=>{if(asset.result)assets.push({url:asset.result.url,bytes:asset.result.bytes,type:asset.result.type});};
    }
   };
   tx.oncomplete=()=>resolve(!value?null:{...value,assets:!includeAssets?[]:value.generation?assets:value.assets});
   tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
 }finally{db.close();}
}
async function deleteOfflineBookmarks(userId:string){
 const db=await database();try{await new Promise<void>((resolve,reject)=>{
  const tx=db.transaction(['accounts','assets'],'readwrite');tx.objectStore('accounts').delete(userId);
  const request=tx.objectStore('assets').openCursor(IDBKeyRange.bound([userId],[userId,'\uffff']));
  request.onsuccess=()=>{const cursor=request.result;if(cursor){cursor.delete();cursor.continue();}};
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 });}finally{db.close();}
}
async function writeOfflineBookmarks(value:OfflineBookmarks){
 const db=await database(),generation=randomUUID();
 try{
  // Individual asset records and the snapshot commit atomically. A failed save
  // retains the previous generation, even when another tab saves concurrently.
  await new Promise<void>((resolve,reject)=>{
   const tx=db.transaction(['accounts','assets'],'readwrite');const assets=tx.objectStore('assets');
   try {
   assets.openCursor(IDBKeyRange.bound([value.userId],[value.userId,'\uffff'])).onsuccess=event=>{
    const cursor=(event.target as IDBRequest<IDBCursorWithValue|null>).result;
    if(cursor){if(cursor.value.generation!==generation)cursor.delete();cursor.continue();}
   };
   for(const asset of value.assets)assets.put({...asset,userId:value.userId,generation});
   tx.objectStore('accounts').put({...value,assets:[],generation,assetUrls:value.assets.map(asset=>asset.url)});
   tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error??new Error('オフラインデータを保存できませんでした'));tx.onabort=()=>reject(tx.error??new Error('オフライン保存が中断されました'));
   } catch(error) { tx.abort(); reject(error); }
  });
 }finally{db.close();}
}

function bookmarkAssetUrls(posts:PostWithAuthor[]):string[] {
  const urls=new Set<string>();
  const visit=(value:unknown,key='')=>{
    if(typeof value==='string' && /image|avatar|cover|thumb/i.test(key) && (/^https?:\/\//.test(value)||isDeferredPrivateMedia(value)))urls.add(value);
    else if(Array.isArray(value))value.forEach(item=>visit(item,key));
    else if(value && typeof value==='object')Object.entries(value).forEach(([name,item])=>visit(item,name));
  };
  visit(posts);
  return [...urls];
}
async function downloadImage(url:string,signal:AbortSignal){
 try{
  const resolved=await resolvePrivateMediaUrl(url);if(!resolved)throw new Error('画像を取得できませんでした');
  const release=retainPrivateMediaUrl(resolved);
  try{
  const response=await fetch(resolved,{signal,credentials:'omit',referrerPolicy:'no-referrer'});
  if(!response.ok)throw new Error('画像を保存できませんでした。もう一度お試しください');
  if(!response.headers.get('content-type')?.startsWith('image/'))throw new Error('画像データを取得できませんでした');
  const blob=await boundedResponseBlob(response,16*1024*1024);
  return {bytes:await blob.arrayBuffer(),type:blob.type};
  }finally{release();}
 }catch(error){
  if(signal.aborted||error instanceof ResponseTooLarge)throw error;
  // Browser image tags may display an asset whose host denies fetch/CORS.
  // Request only supported public media through the authenticated image reader.
  const {data,error:proxyError,response}=await supabase.functions.invoke('link-preview',{body:{url,mode:'image'},signal});
  const type=response?.headers.get('x-lime-image-type')??data?.type??'';
  if(proxyError||!(data instanceof Blob)||!type.startsWith('image/'))throw new Error(`画像を保存できませんでした（${new URL(url).hostname}）`);
  if(data.size>16*1024*1024)throw new ResponseTooLarge();
  return {bytes:await data.arrayBuffer(),type};
 }
}
async function downloadBookmarkAssets(urls:string[],onProgress:(done:number,total:number)=>void):Promise<OfflineBookmarks['assets']> {
  const assets:OfflineBookmarks['assets']=[];
  let done=0,totalBytes=0;
  if(urls.length>2000)throw new Error('画像が多すぎます。保存対象を減らしてください');
  // Bound simultaneous downloads on iOS. A failed asset leaves the existing
  // snapshot intact, rather than reporting an incomplete download as saved.
  for(let start=0;start<urls.length;start+=2)await Promise.all(urls.slice(start,start+2).map(async url=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try{
      const {bytes,type}=await downloadImage(url,controller.signal);if(!bytes.byteLength)throw new Error('画像を保存できませんでした');
      totalBytes+=bytes.byteLength;if(totalBytes>256*1024*1024)throw new Error('画像の合計が256MBを超えています。保存対象を減らしてください');
      assets.push({url,bytes,type});onProgress(++done,urls.length);
    }finally{clearTimeout(timer);}
  }));
  return assets;
}
function openOfflineBookmarks(value:OfflineBookmarks) {
  const media=new Map(value.assets.map(asset=>[asset.url,URL.createObjectURL(new Blob([asset.bytes],{type:asset.type}))]));
  const replace=(input:unknown):unknown=>{
    if(typeof input==='string')return media.get(input)??input;
    if(Array.isArray(input))return input.map(replace);
    if(input && typeof input==='object')return Object.fromEntries(Object.entries(input).map(([key,item])=>[key,replace(item)]));
    return input;
  };
  return {userId:value.userId,bookmarkIds:value.posts.map(post=>post.id),posts:replace(value.posts) as PostWithAuthor[],spaces:replace(value.spaces??{}) as Record<string,OfflineSpaceCard|null>,linkPreviews:replace(value.linkPreviews??{}) as Record<string,LinkPreview|null>,emojis:value.emojis,media,release:()=>media.forEach(url=>URL.revokeObjectURL(url))};
}

// chatImageStore
type ImageRecord={account:string;bytes:ArrayBuffer;type:string;savedAt:number};
const key=(account:string,url:string)=>JSON.stringify([account,url]);
async function chatImageStoreDatabase(){return await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('lime-chat-images',1);r.onupgradeneeded=()=>r.result.createObjectStore('images').createIndex('age',['account','savedAt']);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});}
async function readChatImage(account:string,url:string):Promise<Blob|undefined>{
 const db=await chatImageStoreDatabase();return await new Promise((resolve,reject)=>{const tx=db.transaction('images','readonly'),r=tx.objectStore('images').get(key(account,url));let record:ImageRecord|undefined;r.onsuccess=()=>{record=r.result};tx.oncomplete=()=>{db.close();resolve(record?new Blob([record.bytes],{type:record.type}):undefined)};tx.onabort=()=>{db.close();reject(tx.error)}});
}
async function writeChatImage(account:string,url:string,blob:Blob){
 const record:ImageRecord={account,bytes:await blob.arrayBuffer(),type:blob.type,savedAt:Date.now()};const db=await chatImageStoreDatabase();return await new Promise<void>((resolve,reject)=>{const tx=db.transaction('images','readwrite'),s=tx.objectStore('images');s.put(record,key(account,url));const keys=s.index('age').getAllKeys(IDBKeyRange.bound([account,0],[account,Number.MAX_SAFE_INTEGER]));keys.onsuccess=()=>{for(const k of keys.result.slice(0,Math.max(0,keys.result.length-64)))s.delete(k)};tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>{db.close();reject(tx.error)}});
}

export { readOfflineBookmarks };
export { deleteOfflineBookmarks };
export { writeOfflineBookmarks };
export { bookmarkAssetUrls };
export { downloadBookmarkAssets };
export { openOfflineBookmarks };
export type { OfflineSpaceCard };
export type { OfflineBookmarks };
export { readChatImage };
export { writeChatImage };
