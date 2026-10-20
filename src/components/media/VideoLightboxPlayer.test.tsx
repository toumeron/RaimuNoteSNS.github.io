vi.mock("@/lib/mediaThumbnail", async importOriginal => {
 const actual = await importOriginal<typeof import("@/lib/mediaThumbnail")>();
 return {...actual, ...await (async importOriginal => ({...await importOriginal<typeof import("@/lib/mediaThumbnail")>(), resolvePostVideo:(...args:unknown[])=>mocks.resolve(...args)}))(importOriginal)};
});


import {cleanup,render,screen,waitFor,fireEvent} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({resolve:vi.fn()}));

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
