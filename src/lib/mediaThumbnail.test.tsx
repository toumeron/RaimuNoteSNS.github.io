import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi, describe } from "vitest";
import { readVideoMuted, useVideoMutedPreference } from "@/components/video/PostVideoPlayer";
import { initialMediaSize, mediaThumbnailUrl, resolveExternalMp4, inlineVideoFrame, containSize, clampPan, focalPan, pinchZoom, videoSelections, videoSwipeDirection, videoDimensions, validateVideoDuration } from "@/lib/mediaThumbnail";
import { type PostWithAuthor } from "@/types/index";

describe("videoSoundPreference", () => {
beforeEach(()=>localStorage.clear());afterEach(cleanup);
it('shares the last explicit mute choice across players and reopening',()=>{
 const first=renderHook(()=>useVideoMutedPreference()),second=renderHook(()=>useVideoMutedPreference());
 expect(first.result.current[0]).toBe(true);
 act(()=>first.result.current[1](false));expect(second.result.current[0]).toBe(false);expect(readVideoMuted()).toBe(false);
 first.unmount();const reopened=renderHook(()=>useVideoMutedPreference());expect(reopened.result.current[0]).toBe(false);
 act(()=>reopened.result.current[1](true));expect(second.result.current[0]).toBe(true);reopened.unmount();expect(renderHook(()=>useVideoMutedPreference()).result.current[0]).toBe(true);
});
});

describe("mediaThumbnail", () => {
describe("mediaThumbnail", () => {
it('uses CDN grid thumbnails without changing attachment URLs elsewhere',()=>{
 expect(mediaThumbnailUrl('https://pbs.twimg.com/media/id?format=jpg&name=orig')).toBe('https://pbs.twimg.com/media/id?format=jpg&name=small');
 expect(mediaThumbnailUrl('https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:actor/cid@jpeg')).toContain('/img/feed_thumbnail/');
 for(const src of ['lime-private-media:token','blob:local','https://other.test/img/feed_fullsize/private.jpg','https://pbs.twimg.com/profile_images/avatar.jpg'])expect(mediaThumbnailUrl(src)).toBe(src);
});
});

describe("externalVideoSource", () => {
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('reads MP4/GIF without referrer information and passes cancellation',async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(new Blob(['movie'],{type:'video/mp4'})));vi.stubGlobal('fetch',fetcher);const create=vi.fn().mockReturnValue('blob:movie');vi.stubGlobal('URL',class extends URL{static createObjectURL=create;});const signal=new AbortController().signal;
 expect(await resolveExternalMp4('https://video.twimg.com/movie.mp4',signal)).toBe('blob:movie');expect(fetcher).toHaveBeenCalledWith('https://video.twimg.com/movie.mp4',{signal,referrerPolicy:'no-referrer'});expect(create).toHaveBeenCalledOnce();
});
it('never creates a blob URL for a cancelled download',async()=>{
 const abort=new AbortController();vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>{abort.abort();return new Response('movie');}));await expect(resolveExternalMp4('https://video.twimg.com/movie.mp4',abort.signal)).rejects.toMatchObject({name:'AbortError'});
});
});

describe("inlineVideoFrame", () => {
it('limits ordinary portrait heights but fills quoted cards independently of source resolution',()=>{
 expect(inlineVideoFrame(1080,1920,false).width).toBe('270px');
 expect(inlineVideoFrame(1080,1920,true).width).toBe('168px');
 for(const [width,height] of [[1080,1920],[360,640],[240,160],[16,9]]){
  for(const mobile of [true,false])expect(inlineVideoFrame(width,height,mobile,true)).toEqual({width:'100%',maxWidth:'100%'});
 }
});
it('does not enlarge small files or mistake aspect-only metadata for tiny files',()=>{
 expect(inlineVideoFrame(240,160,false).width).toBe('240px');
 expect(inlineVideoFrame(16,9,false).width).toBe('853px');
 expect(inlineVideoFrame(0,0,true).width).toBe('533px');
});
});

describe("postVideo", () => {
describe('post video limits',()=>{
 it('preserves landscape/portrait aspect ratio without upscaling',()=>{expect(videoDimensions(3840,2160)).toEqual({width:1920,height:1080});expect(videoDimensions(1920,1080)).toEqual({width:1920,height:1080});expect(videoDimensions(1080,1920)).toEqual({width:1080,height:1920});expect(videoDimensions(640,360)).toEqual({width:640,height:360});expect(videoDimensions(1000,1000)).toEqual({width:1000,height:1000});expect(videoDimensions(1920,800)).toEqual({width:1920,height:800});});
 it('rejects videos over 90 seconds, unknown duration and invalid dimensions',()=>{expect(()=>validateVideoDuration(90)).not.toThrow();for(const value of [90.001,Infinity,NaN,0,-1])expect(()=>validateVideoDuration(value)).toThrow();expect(()=>videoDimensions(0,720)).toThrow();});
});
});

describe("mediaGeometry", () => {
describe('image gesture geometry', () => {
  it('fits portrait and landscape images without mistaking the letterbox for image pixels', () => {
    expect(containSize(1000, 800, 400, 800)).toEqual({ width: 400, height: 800 });
    expect(containSize(390, 844, 1000, 500)).toEqual({ width: 390, height: 195 });
  });
  it('allows every edge of a highly zoomed landscape image to reach the viewport edge', () => {
    const size = containSize(390, 844, 1000, 500);
    expect(clampPan({ x: 99999, y: -99999 }, size, { width: 390, height: 844 }, 12)).toEqual({ x: 2145, y: -748 });
    expect(clampPan({ x: 99, y: 99 }, size, { width: 390, height: 844 }, 1)).toEqual({ x: 0, y: 0 });
  });
  it('keeps the image pixel under the fingers in place during pinch zoom', () => {
    expect(focalPan({ x: 20, y: 10 }, 2, 4, { x: 80, y: 50 })).toEqual({ x: -40, y: -30 });
  });
});

it('ignores pinch jitter, damps touch sensitivity, and retains the full zoom range', () => {
 expect(pinchZoom(2, 100, 104)).toBe(2);
 expect(pinchZoom(1, 20, 30)).toBe(1);
 expect(pinchZoom(1, 100, 200)).toBeCloseTo(Math.pow(2, .7));
 expect(pinchZoom(10, 100, 200)).toBe(12);
 expect(pinchZoom(2, 100, 10)).toBe(1);
});
});

describe("videoSequence", () => {
const video={duration:16,width:1920,height:1080};
it('preserves the selected video first and removes duplicate and non-video posts across pages',()=>{
 const post=(id:string,hasVideo=true)=>({id,video:hasVideo?video:null}) as PostWithAuthor;
 const items=videoSelections({url:'video:a',video:{postId:'a',video}},[{posts:[post('a'),post('b'),post('image',false)]},{posts:[post('b'),post('c')]}]);
 expect(items.map(item=>item.video?.postId)).toEqual(['a','b','c']);
});
it('advances upward, goes back downward and rejects taps and horizontal/diagonal gestures',()=>{
 expect(videoSwipeDirection(5,100)).toBe(-1);expect(videoSwipeDirection(5,-100)).toBe(1);
 for(const [x,y] of [[1,20],[110,90],[100,5]])expect(videoSwipeDirection(x,y)).toBe(0);
});

it('keeps twitter video sources in the sequence without requiring native storage metadata',()=>{
 const externalVideo={playlist:'https://video.example/tweet.m3u8',format:'hls' as const,...video};const post={id:'x:123',externalVideo} as PostWithAuthor;
 const items=videoSelections({url:'video:a',video:{postId:'a',video}},[{posts:[post,post]}]);expect(items).toHaveLength(2);expect(items[1].video?.externalVideo).toEqual(externalVideo);
});

it('places late twitter videos before unwatched native slides while preserving the active slide',async()=>{
 const {mergeVideoQueue}=await import("@/lib/mediaThumbnail");
 const item=(id:string)=>({url:'video:'+id,video:{postId:id,video}});
 const first=item('first'),native=item('native'),twitter=item('x:late');
 expect(mergeVideoQueue([first,native],first,[first,twitter,native]).map(item=>item.video?.postId)).toEqual(['first','x:late','native']);
 expect(mergeVideoQueue([first,native],native,[first,twitter,native]).map(item=>item.video?.postId)).toEqual(['first','native','x:late']);
});
});
});

 it('resolves initial geometry from metadata or stored attachment names with a safe fallback',()=>{
 expect(initialMediaSize({width:1080,height:1920})).toEqual({width:1080,height:1920});
 expect(initialMediaSize(undefined,'lime-private-media:owner/post/id--1200x800.webp')).toEqual({width:1200,height:800});
 for(const size of [undefined,{width:0,height:0},{width:NaN,height:50},{width:10,height:Infinity}])expect(initialMediaSize(size)).toEqual({width:16,height:9});
 });

it('uses the duration budget for video quality and retains higher bitrate audio',async()=>{
 const {postVideoEncodingBudget}=await import('./mediaThumbnail');
 const short=postVideoEncodingBudget(15),long=postVideoEncodingBudget(90);
 expect(short.videoBitrate).toBeGreaterThan(6_000_000);
 expect(short.audioBitrate).toBe(256_000);
 expect(long.videoBitrate).toBeGreaterThan(2_000_000);
 expect((long.videoBitrate+long.audioBitrate)*90/8).toBeLessThan(36*1024*1024);
});

const encoding=vi.hoisted(()=>({options:[] as any[],codec:'avc',audioCodec:'aac'}));
vi.mock('mediabunny',()=>({
 ALL_FORMATS:[],BlobSource:class{},BufferTarget:class{buffer:ArrayBuffer|null=null},Mp4OutputFormat:class{},Quality:class{constructor(readonly options:any){}},
 Input:class{dispose(){}async computeDuration(){return 20}async getPrimaryVideoTrack(){return {displayWidth:1920,displayHeight:1080,getCodec:async()=>encoding.codec}}async getPrimaryAudioTrack(){return {getCodec:async()=>encoding.audioCodec}}},
 Output:class{target:any;constructor(options:any){this.target=options.target}},CanvasSink:class{async getCanvas(){return null}},
 Conversion:{init:async(options:any)=>{encoding.options.push(options);return {isValid:true,discardedTracks:[],cancel:async()=>{},execute:async()=>{options.output.target.buffer=new ArrayBuffer(10)}}}}
}));
it('remuxes compatible picture and audio without reducing frame rate or encoding quality',async()=>{
 encoding.options=[];encoding.codec='avc';encoding.audioCodec='aac';
 const {preparePostVideo}=await import('./mediaThumbnail');
 const result=await preparePostVideo(new File(['video'],'original.mp4',{type:'video/mp4'}),vi.fn());
 expect(encoding.options[0].video).toEqual({codec:'avc'});
 expect(encoding.options[0].audio).toEqual({codec:'aac'});
 expect(encoding.options[0].trim).toBeUndefined();
 expect(result).toMatchObject({width:1920,height:1080,duration:20});URL.revokeObjectURL(result.url);
});
it('converts incompatible codecs at higher quality while preserving frame cadence and audio layout',async()=>{
 encoding.options=[];encoding.codec='vp9';encoding.audioCodec='opus';
 const {preparePostVideo}=await import('./mediaThumbnail');
 const result=await preparePostVideo(new File(['video'],'original.webm',{type:'video/webm'}),vi.fn());
 const options=encoding.options[0];expect(options.video.quality.options.bitrate).toBeGreaterThan(6_000_000);
 expect(options.video.frameRate).toBeUndefined();expect(options.audio.quality.options.bitrate).toBe(256_000);
 expect(options.audio.numberOfChannels).toBeUndefined();expect(options.audio.sampleRate).toBeUndefined();URL.revokeObjectURL(result.url);
});
