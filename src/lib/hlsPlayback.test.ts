import {afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({instances:[] as any[]}));
vi.mock('hls.js',()=>({FetchLoader:class{},default:class{
 static isSupported(){return true;}static Events={MANIFEST_PARSED:'manifest',ERROR:'error'};
 handlers=new Map();destroy=vi.fn();loadSource=vi.fn();attachMedia=vi.fn();
 constructor(public config:any){state.instances.push(this);}on(event:string,fn:any){this.handlers.set(event,fn);}
}}));
import { attachHls } from "@/components/video/PostVideoPlayer";
afterEach(()=>{state.instances=[];vi.restoreAllMocks();});
it('loads HLS through MediaSource and destroys streaming requests on close',async()=>{
 const media=document.createElement('video'),abort=new AbortController();vi.spyOn(media,'canPlayType').mockReturnValue('');
 const ready=attachHls(media,'https://video.bsky.app/watch.m3u8',abort.signal,vi.fn());
 await vi.waitFor(()=>expect(state.instances).toHaveLength(1));const hls=state.instances[0];
 expect(hls.config.fetchSetup({url:'https://video.bsky.app/watch.m3u8'},{}).referrerPolicy).toBe('no-referrer');
 expect(hls.loadSource).toHaveBeenCalledWith('https://video.bsky.app/watch.m3u8');expect(hls.attachMedia).toHaveBeenCalledWith(media);
 hls.handlers.get('manifest')();await ready;abort.abort();expect(hls.destroy).toHaveBeenCalledTimes(1);
});
it('cancels pending manifest loading without allowing late playback',async()=>{
 const abort=new AbortController(),media=document.createElement('video');vi.spyOn(media,'canPlayType').mockReturnValue('');
 const ready=attachHls(media,'https://video.bsky.app/watch.m3u8',abort.signal,vi.fn());const rejected=expect(ready).rejects.toMatchObject({name:'AbortError'});
 await vi.waitFor(()=>expect(state.instances).toHaveLength(1));abort.abort();await rejected;expect(state.instances[0].destroy).toHaveBeenCalled();
});
it('reports fatal stream errors and releases the source',async()=>{
 const media=document.createElement('video'),error=vi.fn();vi.spyOn(media,'canPlayType').mockReturnValue('');
 const ready=attachHls(media,'https://video.bsky.app/watch.m3u8',new AbortController().signal,error);const rejected=expect(ready).rejects.toThrow('動画を読み込めませんでした');
 await vi.waitFor(()=>expect(state.instances).toHaveLength(1));state.instances[0].handlers.get('error')('error',{fatal:true});await rejected;expect(error).toHaveBeenCalled();expect(state.instances[0].destroy).toHaveBeenCalled();
});
