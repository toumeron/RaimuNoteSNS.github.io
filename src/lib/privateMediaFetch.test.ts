import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {clearPrivateMedia, createPrivateMediaFetch, MEDIA_PREFIX, resolvePrivateMediaUrl, isDeferredPrivateMedia} from './privateMediaFetch';
const path='11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.png';
const ref=MEDIA_PREFIX+path;
const db='https://example.supabase.co';
beforeEach(()=>{vi.stubGlobal('URL',URL); URL.createObjectURL=vi.fn(()=> 'blob:protected');URL.revokeObjectURL=vi.fn();});
afterEach(()=>{clearPrivateMedia();vi.restoreAllMocks();});
it('checks Storage with the viewer credentials for nested originals and replies without signed URLs',async()=>{
 const transport=vi.fn().mockResolvedValueOnce(Response.json([{parent_post:{image_urls:[ref]},parent_reply:{image_urls:[ref]}}])).mockResolvedValueOnce(new Response('png',{headers:{'content-type':'image/png'}}));
 const result=await createPrivateMediaFetch(db,transport)(db+'/rest/v1/posts',{headers:{authorization:'Bearer viewer',apikey:'public-key'}});
 expect(await result.json()).toEqual([{parent_post:{image_urls:['blob:protected']},parent_reply:{image_urls:['blob:protected']}}]);
 expect(transport).toHaveBeenCalledTimes(2);
 const [url,options]=transport.mock.calls[1];
 expect(url).toBe(db+'/storage/v1/object/authenticated/post-media/'+path);
 expect(options.headers.get('authorization')).toBe('Bearer viewer');
 expect(options.cache).toBe('no-store');expect(options.redirect).toBe('error');
});
it('does not display media denied by current RLS and never requests malformed paths',async()=>{
 const transport=vi.fn().mockResolvedValueOnce(Response.json({image_urls:[ref,MEDIA_PREFIX+'../../secret']})).mockResolvedValueOnce(new Response('',{status:403}));
 const result=await createPrivateMediaFetch(db,transport)(db+'/rest/v1/comments');
 expect(await result.json()).toEqual({image_urls:[]});expect(transport).toHaveBeenCalledTimes(2);
});
it('does not send credentials or rewrite responses from another origin',async()=>{
 const original=Response.json({image_urls:[ref]});const transport=vi.fn().mockResolvedValue(original);
 expect(await createPrivateMediaFetch(db,transport)('https://evil.example/rest/v1/posts')).toBe(original);
 expect(transport).toHaveBeenCalledTimes(1);
});
it('revokes viewer blobs at account changes',async()=>{
 const transport=vi.fn().mockResolvedValueOnce(Response.json({image_urls:[ref]})).mockResolvedValueOnce(new Response('png',{headers:{'content-type':'image/png'}}));
 await createPrivateMediaFetch(db,transport)(db+'/rest/v1/posts');clearPrivateMedia();
 expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:protected');
});
it('discards an in-flight private download when the account changes',async()=>{
 let finish!:(response:Response)=>void;
 const transport=vi.fn().mockResolvedValueOnce(Response.json({image_urls:[ref]})).mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;}));
 const pending=createPrivateMediaFetch(db,transport)(db+'/rest/v1/posts');
 await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
 clearPrivateMedia();finish(new Response('png',{headers:{'content-type':'image/png'}}));
 expect((await pending).status).toBe(409);expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it('rejects a delayed REST response from an account that is no longer active',async()=>{
 let finish!:(response:Response)=>void;
 const transport=vi.fn().mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;}));
 const pending=createPrivateMediaFetch(db,transport)(db+'/rest/v1/posts');
 clearPrivateMedia();finish(Response.json({content:'previous account secret',image_urls:[ref]}));
 expect((await pending).status).toBe(409);expect(transport).toHaveBeenCalledTimes(1);
});

it('revalidates storage permissions on refresh while reusing the same local image bytes',async()=>{
 const transport=vi.fn().mockImplementation(async input=>String(input).includes('/rest/v1/')?Response.json({image_urls:[ref]}):new Response('png',{headers:{'content-type':'image/png'}}));
 const fetcher=createPrivateMediaFetch(db,transport);
 await fetcher(db+'/rest/v1/posts');await fetcher(db+'/rest/v1/posts');
 expect(transport).toHaveBeenCalledTimes(4);expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
});

it('returns post metadata before downloading even one attachment, then checks RLS on demand',async()=>{
 let finish!:(response:Response)=>void;
 const transport=vi.fn().mockResolvedValueOnce(Response.json([{content:'ready',image_urls:[ref],parent_post:{image_urls:[ref]}}])).mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;}));
 const controller=new AbortController();
 const response=await createPrivateMediaFetch(db,transport,true)(db+'/rest/v1/posts',{signal:controller.signal,headers:{authorization:'Bearer viewer',apikey:'public-key'}});
 const rows=await response.json(),token=rows[0].image_urls[0];
 expect(rows[0].content).toBe('ready');expect(isDeferredPrivateMedia(token)).toBe(true);expect(rows[0].parent_post.image_urls[0]).toBe(token);expect(transport).toHaveBeenCalledTimes(1);
 // Completing/cancelling metadata does not cancel a later image request.
 controller.abort();const pending=resolvePrivateMediaUrl(token);
 expect(transport).toHaveBeenCalledTimes(2);expect(transport.mock.calls[1][1].signal.aborted).toBe(false);
 expect(transport.mock.calls[1][1].headers.get('authorization')).toBe('Bearer viewer');
 finish(new Response('png',{headers:{'content-type':'image/png'}}));expect(await pending).toBe('blob:protected');
});
it('invalidates deferred attachments at account changes before any old credentials can be used',async()=>{
 const transport=vi.fn().mockResolvedValue(Response.json({image_urls:[ref]}));
 const response=await createPrivateMediaFetch(db,transport,true)(db+'/rest/v1/posts');
 const {image_urls:[token]}=await response.json();clearPrivateMedia();
 expect(await resolvePrivateMediaUrl(token)).toBeNull();expect(transport).toHaveBeenCalledTimes(1);
});
it('does not expose a deferred image if Storage denies access',async()=>{
 const transport=vi.fn().mockResolvedValueOnce(Response.json({image_urls:[ref]})).mockResolvedValueOnce(new Response('',{status:403}));
 const {image_urls:[token]}=await (await createPrivateMediaFetch(db,transport,true)(db+'/rest/v1/posts')).json();
 expect(await resolvePrivateMediaUrl(token)).toBeNull();expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it('does not download an entire liked-image history while preparing recommendation preferences',async()=>{
 const transport=vi.fn().mockResolvedValue(Response.json(Array.from({length:200},(_,i)=>({id:i,posts:{image_urls:[ref]}}))));
 const rows=await (await createPrivateMediaFetch(db,transport,true)(db+'/rest/v1/likes')).json();
 expect(rows).toHaveLength(200);expect(isDeferredPrivateMedia(rows[0].posts.image_urls[0])).toBe(true);expect(transport).toHaveBeenCalledTimes(1);
});
