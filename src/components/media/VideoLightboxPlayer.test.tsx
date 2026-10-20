vi.mock("@/lib/mediaThumbnail", async importOriginal => {
 const actual = await importOriginal<typeof import("@/lib/mediaThumbnail")>();
 return {...actual, ...await (async importOriginal => ({...await importOriginal<typeof import("@/lib/mediaThumbnail")>(), resolvePostVideo:(...args:unknown[])=>mocks.resolve(...args)}))(importOriginal)};
});


import {act,cleanup,render,screen,waitFor,fireEvent} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({resolve:vi.fn(),hls:vi.fn()}));
vi.mock('hls.js',()=>({
 FetchLoader:class{},
 default:class {
  static Events={MANIFEST_PARSED:'manifest',ERROR:'error'};
  static isSupported=()=>true;
  handlers=new Map<string,()=>void>();
  constructor(){mocks.hls();}
  on(event:string,callback:()=>void){this.handlers.set(event,callback);}
  attachMedia(media:HTMLVideoElement){media.src='blob:hls-engine';}
  loadSource(){this.handlers.get('manifest')?.();}
  destroy(){}
 }
}));

import { VideoLightboxPlayer } from "@/components/video/PostVideoPlayer";
let running=false;
const video={duration:16,width:1920,height:1080};
const prefs={muted:true,onMutedChange:vi.fn(),rate:1,onRateChange:vi.fn(),onSource:vi.fn()};
beforeEach(()=>{
 running=false;vi.clearAllMocks();vi.spyOn(HTMLMediaElement.prototype,'paused','get').mockImplementation(()=>!running);
 vi.spyOn(HTMLMediaElement.prototype,'play').mockImplementation(async function(this:HTMLMediaElement){running=true;this.dispatchEvent(new Event('play'));});
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(function(this:HTMLMediaElement){running=false;this.dispatchEvent(new Event('pause'));});
 vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});vi.stubGlobal('URL',{revokeObjectURL:vi.fn()});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('autoplays once, exposes real playback controls in the common footer, and releases private media on close',async()=>{
 mocks.resolve.mockResolvedValue({url:'blob:private',local:true});
 const host=document.createElement('div');document.body.append(host);
 const view=render(<VideoLightboxPlayer {...prefs} selection={{postId:'one',video}} host={host}/>);
 await screen.findByRole('button',{name:'動画を一時停止'});const media=view.container.querySelector('video')!;
 expect(media.play).toHaveBeenCalledTimes(1);expect(media.src).toBe('blob:private');expect(media.loop).toBe(true);
 fireEvent.change(screen.getByLabelText('動画の再生位置'),{target:{value:'6'}});expect(media.currentTime).toBe(6);
 fireEvent.click(screen.getByRole('button',{name:'動画の音声をオン'}));expect(prefs.onMutedChange).toHaveBeenCalledWith(false);
 view.unmount();expect(media.pause).toHaveBeenCalled();expect(media.getAttribute('src')).toBeNull();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private');expect(host.childElementCount).toBe(0);host.remove();
});
it('aborts a previous slide and never plays a private download that finishes after unmount',async()=>{
 let finish!:(value:{url:string;local:boolean})=>void;mocks.resolve.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const view=render(<VideoLightboxPlayer {...prefs} selection={{postId:'old',video}} host={null}/>);
 const signal=mocks.resolve.mock.calls[0][1] as AbortSignal;view.unmount();expect(signal.aborted).toBe(true);
 finish({url:'blob:late',local:true});await waitFor(()=>expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late'));expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
});

it('does not replace the saved sound-on choice when autoplay temporarily requires mute',async()=>{
 mocks.resolve.mockResolvedValue({url:'https://video.example/video.mp4',local:false});
 const observed:boolean[]=[];
 vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(async function(this:HTMLMediaElement){observed.push(this.muted);if(observed.length===1)throw new DOMException('Autoplay restricted','NotAllowedError');running=true;this.dispatchEvent(new Event('play'));});
 const view=render(<VideoLightboxPlayer {...prefs} muted={false} selection={{postId:'blocked',video}} host={null}/>);
 await waitFor(()=>expect(observed).toEqual([false,true]));expect(prefs.onMutedChange).not.toHaveBeenCalled();
 view.rerender(<VideoLightboxPlayer {...prefs} muted={false} selection={{postId:'next',video}} host={null}/>);
 await waitFor(()=>expect(observed).toEqual([false,true,false]));expect(prefs.onMutedChange).not.toHaveBeenCalled();
});

it('pauses the outgoing slide during a pending swipe and resumes if the transition is cancelled',async()=>{
 mocks.resolve.mockResolvedValue({url:'https://video.example/current.mp4',local:false});
 const props={...prefs,selection:{postId:'current',video},host:null};
 const view=render(<VideoLightboxPlayer {...props}/>);await waitFor(()=>expect(running).toBe(true));
 view.rerender(<VideoLightboxPlayer {...props} suspended/>);expect(running).toBe(false);
 view.rerender(<VideoLightboxPlayer {...props}/>);await waitFor(()=>expect(running).toBe(true));expect(prefs.onMutedChange).not.toHaveBeenCalled();
});
it('does not start late playback while the outgoing slide is suspended',async()=>{
 let finish!:(value:any)=>void;mocks.resolve.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const props={...prefs,selection:{postId:'late',video},host:null};
 const view=render(<VideoLightboxPlayer {...props}/>);view.rerender(<VideoLightboxPlayer {...props} suspended/>);
 finish({url:'https://video.example/late.mp4',local:false});await waitFor(()=>expect(screen.queryByLabelText('動画を読み込み中')).not.toBeInTheDocument());
 expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
});

it('does not show an error when a swipe interrupts pending autoplay and resumes after cancellation',async()=>{
 mocks.resolve.mockResolvedValue({url:'https://video.example/current.mp4',local:false});
 let rejectPlay!:(reason:unknown)=>void;
 vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(()=>new Promise((_,reject)=>{rejectPlay=reject;}));
 const props={...prefs,selection:{postId:'interrupted',video},host:null};
 const view=render(<VideoLightboxPlayer {...props}/>);
 await waitFor(()=>expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));
 view.rerender(<VideoLightboxPlayer {...props} suspended/>);
 await act(async()=>{rejectPlay(new DOMException('The play() request was interrupted by a call to pause().','AbortError'));});
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();expect(running).toBe(false);
 view.rerender(<VideoLightboxPlayer {...props}/>);
 await waitFor(()=>expect(running).toBe(true));expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('resumes if suspension is cancelled before an interrupted play promise settles',async()=>{
 mocks.resolve.mockResolvedValue({url:'https://video.example/current.mp4',local:false});
 let rejectPlay!:(reason:unknown)=>void;
 vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(()=>new Promise((_,reject)=>{rejectPlay=reject;}));
 const props={...prefs,selection:{postId:'quick-swipe',video},host:null};
 const view=render(<VideoLightboxPlayer {...props}/>);
 await waitFor(()=>expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));
 view.rerender(<VideoLightboxPlayer {...props} suspended/>);view.rerender(<VideoLightboxPlayer {...props}/>);
 await act(async()=>{rejectPlay(new DOMException('The play() request was interrupted by a call to pause().','AbortError'));});
 await waitFor(()=>expect(running).toBe(true));expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('keeps real playback errors visible and allows retry',async()=>{
 mocks.resolve.mockResolvedValue({url:'https://video.example/current.mp4',local:false});
 vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException('Unsupported video','NotSupportedError'));
 render(<VideoLightboxPlayer {...prefs} selection={{postId:'broken',video}} host={null}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('動画を読み込めませんでした');
 fireEvent.click(screen.getByRole('button',{name:'再試行'}));
 await waitFor(()=>expect(running).toBe(true));expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('falls back to an alternative stream when the primary video format cannot be played',async()=>{
 vi.spyOn(HTMLMediaElement.prototype,'canPlayType').mockReturnValue('probably');
 vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException('Failed to load because no supported source was found.','NotSupportedError'));
 const externalVideo={playlist:'https://video.example/main.mp4',format:'mp4' as const,fallback:{playlist:'https://video.example/alternative.m3u8',format:'hls' as const},...video};
 const view=render(<VideoLightboxPlayer {...prefs} selection={{postId:'alternate',video,externalVideo}} host={null}/>);
 await waitFor(()=>expect(running).toBe(true));
 expect(view.container.querySelector('video')).toHaveAttribute('src',externalVideo.fallback.playlist);
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();expect(mocks.resolve).not.toHaveBeenCalled();
});
it('uses the alternative source on a media error event instead of leaving an error overlay',async()=>{
 vi.spyOn(HTMLMediaElement.prototype,'canPlayType').mockReturnValue('probably');
 const externalVideo={playlist:'https://video.example/main.mp4',format:'mp4' as const,fallback:{playlist:'https://video.example/alternative.m3u8',format:'hls' as const},...video};
 const view=render(<VideoLightboxPlayer {...prefs} selection={{postId:'alternate-event',video,externalVideo}} host={null}/>);
 await waitFor(()=>expect(running).toBe(true));fireEvent.error(view.container.querySelector('video')!);
 await waitFor(()=>expect(view.container.querySelector('video')).toHaveAttribute('src',externalVideo.fallback.playlist));
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('recognizes an MP4 URL even if the external provider omitted its format',async()=>{
 const externalVideo={playlist:'https://video.example/without-format.mp4?tag=1',...video};
 const view=render(<VideoLightboxPlayer {...prefs} selection={{postId:'mp4-inferred',video,externalVideo}} host={null}/>);
 await waitFor(()=>expect(running).toBe(true));expect(view.container.querySelector('video')).toHaveAttribute('src',externalVideo.playlist);
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 expect(mocks.hls).not.toHaveBeenCalled();
});

it('switches from failing native HLS playback to the JavaScript HLS engine',async()=>{
 vi.spyOn(HTMLMediaElement.prototype,'canPlayType').mockReturnValue('probably');
 vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException('Failed to load because no supported source was found.','NotSupportedError'));
 const externalVideo={playlist:'https://video.example/native-failed.m3u8',format:'hls' as const,...video};
 const view=render(<VideoLightboxPlayer {...prefs} selection={{postId:'native-failed',video,externalVideo}} host={null}/>);
 await waitFor(()=>expect(mocks.hls).toHaveBeenCalledTimes(1));
 await waitFor(()=>expect(running).toBe(true));
 expect(view.container.querySelector('video')).toHaveAttribute('src','blob:hls-engine');expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('prepares the next source silently and reuses it immediately when it becomes active',async()=>{
 mocks.resolve.mockResolvedValue({url:'blob:next-ready',local:true});
 const props={...prefs,selection:{postId:'next-ready',video},host:null};
 const view=render(<VideoLightboxPlayer {...props} suspended/>);
 await waitFor(()=>expect(view.container.querySelector('video')).toHaveAttribute('src','blob:next-ready'));
 await waitFor(()=>expect(screen.queryByLabelText('動画を読み込み中')).not.toBeInTheDocument());
 expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();expect(prefs.onSource).not.toHaveBeenCalled();
 const prepared=view.container.querySelector('video');view.rerender(<VideoLightboxPlayer {...props}/>);
 await waitFor(()=>expect(running).toBe(true));expect(view.container.querySelector('video')).toBe(prepared);
 expect(mocks.resolve).toHaveBeenCalledTimes(1);expect(prefs.onSource).toHaveBeenCalledWith('blob:next-ready');
 view.unmount();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:next-ready');
});

it('handles unsupported playback discovered only when a preloaded video becomes active',async()=>{
 vi.spyOn(HTMLMediaElement.prototype,'canPlayType').mockReturnValue('probably');
 vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException('Unsupported source','NotSupportedError'));
 const externalVideo={playlist:'https://video.example/preloaded.mp4',format:'mp4' as const,fallback:{playlist:'https://video.example/preloaded.m3u8',format:'hls' as const},...video};
 const props={...prefs,selection:{postId:'preloaded-fallback',video,externalVideo},host:null};
 const view=render(<VideoLightboxPlayer {...props} suspended/>);
 await waitFor(()=>expect(screen.queryByLabelText('動画を読み込み中')).not.toBeInTheDocument());
 view.rerender(<VideoLightboxPlayer {...props}/>);
 await waitFor(()=>expect(view.container.querySelector('video')).toHaveAttribute('src',externalVideo.fallback.playlist));
 await waitFor(()=>expect(running).toBe(true));expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
