import {afterEach,expect,it,vi} from 'vitest';
import {loadChatImage} from './chatImageCache';
const records=vi.hoisted(()=>new Map<string,Blob>());
vi.mock('./chatImageStore',()=>({readChatImage:async(account:string,url:string)=>records.get(JSON.stringify([account,url])),writeChatImage:async(account:string,url:string,blob:Blob)=>{records.set(JSON.stringify([account,url]),blob)}}));
afterEach(()=>{vi.unstubAllGlobals();records.clear()});
it('deduplicates concurrent downloads and reuses saved bytes only within the same account',async()=>{
 const download=vi.fn(async()=>new Response(new Blob(['image'],{type:'image/png'}),{headers:{'content-type':'image/png'}}));vi.stubGlobal('fetch',download);const url='https://res.cloudinary.com/example/image/upload/photo.png';
 await Promise.all([loadChatImage(url,'a'),loadChatImage(url,'a')]);await loadChatImage(url,'a');expect(download).toHaveBeenCalledTimes(1);await loadChatImage(url,'b');expect(download).toHaveBeenCalledTimes(2);
});
it('does not retain failed responses and retries a later successful load',async()=>{
 const download=vi.fn().mockResolvedValueOnce(new Response('error',{status:503})).mockResolvedValueOnce(new Response('image',{headers:{'content-type':'image/jpeg'}}));vi.stubGlobal('fetch',download);const url='https://res.cloudinary.com/example/image/upload/retry.jpg';await expect(loadChatImage(url,'a')).rejects.toThrow();await loadChatImage(url,'a');await loadChatImage(url,'a');expect(download).toHaveBeenCalledTimes(2);
});
