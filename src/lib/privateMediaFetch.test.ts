import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearPrivateMedia, createPrivateMediaFetch, MEDIA_PREFIX, resolvePrivateMediaUrl, isDeferredPrivateMedia } from "@/lib/privateMediaFetch";
import { boundedResponseBlob, ResponseTooLarge, createDevFunctionFetch } from "@/lib/devFunctionFetch";

describe("privateMediaFetch", () => {
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
});

describe("boundedResponse", () => {
it('stops and cancels oversized chunked images despite a forged Content-Length',async()=>{
 let cancelled=false,reads=0;
 const stream=new ReadableStream<Uint8Array>({pull(controller){reads++;controller.enqueue(new Uint8Array(8));},cancel(){cancelled=true;}});
 await expect(boundedResponseBlob(new Response(stream,{headers:{'content-type':'image/png','content-length':'1'}}),10)).rejects.toBeInstanceOf(ResponseTooLarge);
 expect(cancelled).toBe(true);expect(reads).toBeLessThanOrEqual(3);
});
it('preserves valid image bytes and MIME type',async()=>{
 const blob=await boundedResponseBlob(new Response('hello',{headers:{'content-type':'image/png'}}),10);
 expect(blob.size).toBe(5);expect(blob.type).toBe('image/png');
});
});

describe("devFunctionFetch", () => {
const devFunctionFetchTestDb = 'https://example.supabase.co';
const proxy = 'http://192.168.11.51:8080/RaimuNoteSNS.github.io/__lime-link-preview';
it('routes preview/Misskey requests through the local server, retaining authentication and body', async () => {
  const transport = vi.fn().mockResolvedValue(Response.json({ preview: null }));
  const options = { method: 'POST', headers: { authorization: 'Bearer viewer', apikey: 'public' }, body: '{"mode":"misskey"}' };
  await createDevFunctionFetch(devFunctionFetchTestDb, proxy, transport)(devFunctionFetchTestDb + '/functions/v1/link-preview', options);
  expect(transport).toHaveBeenCalledWith(proxy, options);
});
it('preserves Request inputs and query strings', async () => {
  const transport = vi.fn().mockResolvedValue(new Response('ok'));
  const input = new Request(devFunctionFetchTestDb + '/functions/v1/link-preview?test=1', { method: 'POST', headers: { authorization: 'Bearer viewer' }, body: 'payload' });
  await createDevFunctionFetch(devFunctionFetchTestDb, proxy, transport)(input);
  const request = transport.mock.calls[0][0] as Request;
  expect(request.url).toBe(proxy + '?test=1');
  expect(request.headers.get('authorization')).toBe('Bearer viewer');
  expect(await request.text()).toBe('payload');
});
it('does not proxy storage, database, other functions or other hosts', async () => {
  const transport = vi.fn().mockResolvedValue(new Response('ok'));
  const fetcher = createDevFunctionFetch(devFunctionFetchTestDb, proxy, transport);
  for (const url of [devFunctionFetchTestDb + '/rest/v1/posts', devFunctionFetchTestDb + '/storage/v1/object/file', devFunctionFetchTestDb + '/functions/v1/chat', 'https://other.example/functions/v1/link-preview']) {
    await fetcher(url);
    expect(transport).toHaveBeenLastCalledWith(url, undefined);
  }
});
});
