import {expect,it,vi,afterEach} from 'vitest';
import {resolveExternalMp4} from './externalVideoSource';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('reads MP4/GIF without referrer information and passes cancellation',async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(new Blob(['movie'],{type:'video/mp4'})));vi.stubGlobal('fetch',fetcher);const create=vi.fn().mockReturnValue('blob:movie');vi.stubGlobal('URL',class extends URL{static createObjectURL=create;});const signal=new AbortController().signal;
 expect(await resolveExternalMp4('https://video.twimg.com/movie.mp4',signal)).toBe('blob:movie');expect(fetcher).toHaveBeenCalledWith('https://video.twimg.com/movie.mp4',{signal,referrerPolicy:'no-referrer'});expect(create).toHaveBeenCalledOnce();
});
it('never creates a blob URL for a cancelled download',async()=>{
 const abort=new AbortController();vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>{abort.abort();return new Response('movie');}));await expect(resolveExternalMp4('https://video.twimg.com/movie.mp4',abort.signal)).rejects.toMatchObject({name:'AbortError'});
});
