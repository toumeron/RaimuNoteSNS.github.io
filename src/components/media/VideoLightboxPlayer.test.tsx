import {cleanup,render,screen,waitFor,fireEvent} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({resolve:vi.fn()}));
vi.mock('@/lib/postVideoStorage',()=>({resolvePostVideo:(...args:unknown[])=>mocks.resolve(...args)}));
import {VideoLightboxPlayer} from './VideoLightboxPlayer';
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
