import { afterEach, beforeEach, expect, it, vi, describe } from "vitest";
import { retainPrivateMediaUrl, trimPrivateMedia, clearPrivateMedia, createSupabaseReadFetch, createPrivateMediaFetch, MEDIA_PREFIX, privateMediaReference, resolvePrivateMediaUrl, isDeferredPrivateMedia, boundedResponseBlob, ResponseTooLarge, createDevFunctionFetch } from "@/lib/privateMediaFetch";
import { randomUUID } from "@/lib/utils";

describe("privateMediaFetch", () => {
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
});

describe("randomUUID", () => {
afterEach(() => vi.unstubAllGlobals());
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('UUID compatibility', () => {
  it('uses the native method when available', () => {
    const native = vi.fn(() => 'native-uuid');
    vi.stubGlobal('crypto', { randomUUID: native });
    expect(randomUUID()).toBe('native-uuid');
    expect(native).toHaveBeenCalledOnce();
  });
  it('uses random bytes when LAN HTTP omits randomUUID', () => {
    let sequence = 0;
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(++sequence);
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues });
    const first = randomUUID();
    const second = randomUUID();
    expect(first).toMatch(uuidV4);
    expect(second).toMatch(uuidV4);
    expect(second).not.toBe(first);
    expect(getRandomValues).toHaveBeenCalledTimes(2);
  });
  it('does not crash if crypto is unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    expect(randomUUID()).toMatch(uuidV4);
  });
});
});

describe('Supabase usage without stale or shared private responses', () => {
 const db='https://example.supabase.co';
 it('shares overlapping reads, gives each reader a consumable body, and reads fresh data afterwards', async () => {
  let finish!:(response:Response)=>void;
  const transport=vi.fn().mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;})).mockImplementation(async()=>Response.json({version:2}));
  const fetcher=createSupabaseReadFetch(db,transport);
  const one=fetcher(db+'/rest/v1/posts'),two=fetcher(db+'/rest/v1/posts');
  await Promise.resolve();expect(transport).toHaveBeenCalledTimes(1);
  finish(Response.json({version:1}));
  expect(await (await one).json()).toEqual({version:1});expect(await (await two).json()).toEqual({version:1});
  expect(await (await fetcher(db+'/rest/v1/posts')).json()).toEqual({version:2});expect(transport).toHaveBeenCalledTimes(2);
 });
 it('isolates credentials, ranges and HEAD/GET, and leaves other origins untouched', async () => {
  const transport=vi.fn().mockImplementation(async()=>Response.json([])),fetcher=createSupabaseReadFetch(db,transport);
  const reads=[fetcher(db+'/rest/v1/posts',{headers:{authorization:'Bearer a'}}),fetcher(db+'/rest/v1/posts',{headers:{authorization:'Bearer b'}}),fetcher(db+'/rest/v1/posts',{headers:{authorization:'Bearer a',range:'0-19'}}),fetcher(db+'/rest/v1/posts',{method:'HEAD',headers:{authorization:'Bearer a'}}),fetcher('https://other.example/rest/v1/posts')];
  await Promise.all(reads);expect(transport).toHaveBeenCalledTimes(5);
 });
 it('keeps another consumer alive when only one reader is cancelled', async () => {
  let finish!:(response:Response)=>void;
  const transport=vi.fn().mockImplementation(()=>new Promise<Response>(resolve=>{finish=resolve;})),fetcher=createSupabaseReadFetch(db,transport);
  const first=new AbortController(),second=new AbortController();
  const one=fetcher(db+'/rest/v1/posts',{signal:first.signal}),two=fetcher(db+'/rest/v1/posts',{signal:second.signal});
  const cancelled=expect(one).rejects.toMatchObject({name:'AbortError'});
  await Promise.resolve();first.abort();await cancelled;
  expect(transport.mock.calls[0][1].signal.aborted).toBe(false);
  finish(Response.json({ok:true}));expect(await (await two).json()).toEqual({ok:true});
 });
 it('cancels the underlying read when its last consumer leaves, and permits a replacement read', async () => {
  const transport=vi.fn().mockImplementation((_input,init)=>new Promise<Response>((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))),fetcher=createSupabaseReadFetch(db,transport);
  const controller=new AbortController(),one=fetcher(db+'/rest/v1/posts',{signal:controller.signal});
  const rejected=expect(one).rejects.toMatchObject({name:'AbortError'});
  await Promise.resolve();controller.abort();await rejected;expect(transport.mock.calls[0][1].signal.aborted).toBe(true);
  transport.mockImplementationOnce(async()=>Response.json([]));await fetcher(db+'/rest/v1/posts');expect(transport).toHaveBeenCalledTimes(2);
 });
 it('does not share reads across an account reset or either side of a write', async () => {
  const pending:((response:Response)=>void)[]=[],transport=vi.fn().mockImplementation((_input,init)=>init.method==='POST'?Promise.resolve(Response.json({})):new Promise<Response>(resolve=>pending.push(resolve))),fetcher=createSupabaseReadFetch(db,transport);
  const one=fetcher(db+'/rest/v1/posts');await Promise.resolve();
  const write=fetcher(db+'/rest/v1/posts',{method:'POST',body:'{}'});
  const during=fetcher(db+'/rest/v1/posts');await Promise.resolve();await write;
  const after=fetcher(db+'/rest/v1/posts');await Promise.resolve();clearPrivateMedia();
  const account=fetcher(db+'/rest/v1/posts');await Promise.resolve();expect(transport).toHaveBeenCalledTimes(5);
  pending.forEach(resolve=>resolve(Response.json([])));await Promise.all([one,during,after,account]);
 });
 it('keeps error responses and failed reads retryable rather than caching them', async () => {
  const transport=vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockImplementationOnce(async()=>Response.json({error:'denied'},{status:403})).mockImplementationOnce(async()=>Response.json([])),fetcher=createSupabaseReadFetch(db,transport);
  await expect(fetcher(db+'/rest/v1/posts')).rejects.toThrow('offline');expect((await fetcher(db+'/rest/v1/posts')).status).toBe(403);expect((await fetcher(db+'/rest/v1/posts')).status).toBe(200);expect(transport).toHaveBeenCalledTimes(3);
 });
 it('revalidates an immutable cached image with HEAD and still honours subsequent RLS denial', async () => {
  clearPrivateMedia();URL.createObjectURL=vi.fn(()=> 'blob:quota-test');URL.revokeObjectURL=vi.fn();
  const path='11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.png',ref=MEDIA_PREFIX+path;
  const transport=vi.fn().mockResolvedValueOnce(Response.json({image_urls:[ref]})).mockResolvedValueOnce(new Response('image',{headers:{'content-type':'image/png'}})).mockResolvedValueOnce(Response.json({image_urls:[ref]})).mockResolvedValueOnce(new Response(null,{headers:{'content-type':'image/png'}})).mockResolvedValueOnce(Response.json({image_urls:[ref]})).mockResolvedValueOnce(new Response(null,{status:403}));
  try {
   const fetcher=createPrivateMediaFetch(db,transport);
   expect(await (await fetcher(db+'/rest/v1/posts')).json()).toEqual({image_urls:['blob:quota-test']});
   expect(await (await fetcher(db+'/rest/v1/posts')).json()).toEqual({image_urls:['blob:quota-test']});
   expect(transport.mock.calls[1][1].method).toBe('GET');expect(transport.mock.calls[3][1].method).toBe('HEAD');expect(URL.createObjectURL).toHaveBeenCalledOnce();
   expect(await (await fetcher(db+'/rest/v1/posts')).json()).toEqual({image_urls:[]});expect(transport.mock.calls[5][1].method).toBe('HEAD');
  } finally {clearPrivateMedia();}
 });
});

it('retains per-reader cancellation while a shared JSON body is still streaming',async()=>{
 const db='https://example.supabase.co';let source!:ReadableStreamDefaultController<Uint8Array>;
 const bytes=new TextEncoder();
 const transport=vi.fn().mockImplementation(async()=>new Response(new ReadableStream<Uint8Array>({start(controller){source=controller;controller.enqueue(bytes.encode('{"value":'));}}),{headers:{'content-type':'application/json'}}));
 const fetcher=createSupabaseReadFetch(db,transport),first=new AbortController();
 const [one,two]=await Promise.all([fetcher(db+'/rest/v1/posts',{signal:first.signal}),fetcher(db+'/rest/v1/posts')]);
 const stopped=expect(one.json()).rejects.toMatchObject({name:'AbortError'}),survivor=two.json();
 first.abort();await stopped;source.enqueue(bytes.encode('1}'));source.close();
 expect(await survivor).toEqual({value:1});expect(transport).toHaveBeenCalledTimes(1);
});

it('retains dimensioned attachment references before a deferred download',async()=>{
 const path='11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333--1200x800.png';
 const ref=MEDIA_PREFIX+path;
 const transport=vi.fn().mockResolvedValueOnce(Response.json({image_urls:[ref]})).mockResolvedValueOnce(new Response('png',{headers:{'content-type':'image/png'}}));
 URL.createObjectURL=vi.fn(()=> 'blob:dimensioned');
 const response=await createPrivateMediaFetch('https://example.supabase.co',transport,true)('https://example.supabase.co/rest/v1/posts');
 const {image_urls:[token]}=await response.json();
 expect(privateMediaReference(token)).toBe(ref);expect(transport).toHaveBeenCalledTimes(1);
 expect(await resolvePrivateMediaUrl(token)).toBe('blob:dimensioned');
 expect(transport.mock.calls[1][0]).toContain('--1200x800.png');clearPrivateMedia();
});

it('does not serialize an attachment-free feed just to detect private images',async()=>{
 const response=Response.json(Array.from({length:100},(_,i)=>({id:i,content:'長い投稿本文'.repeat(1000),image_urls:[],parent_post:{content:'引用 '+MEDIA_PREFIX+'is plain text',imageUrls:['https://images.example/photo.jpg']}})));
 const transport=vi.fn().mockResolvedValue(response),stringify=vi.spyOn(JSON,'stringify');
 try{
  const result=await createPrivateMediaFetch('https://example.supabase.co',transport,true)('https://example.supabase.co/rest/v1/posts');
  expect(result).toBe(response);expect(stringify).not.toHaveBeenCalled();expect(transport).toHaveBeenCalledOnce();
 }finally{stringify.mockRestore();}
});


describe('PWA private image retention',()=>{
 let sequence=0;
 const ref=(id:number)=>MEDIA_PREFIX+'11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/'+String(id).padStart(8,'0')+'-3333-4333-8333-333333333333.png';
 beforeEach(()=>{
  vi.useFakeTimers();sequence=0;vi.stubGlobal('navigator',{standalone:true});
  const NativeURL=globalThis.URL;
  vi.stubGlobal('URL',class extends NativeURL{static createObjectURL=vi.fn(()=>`blob:pwa-private-${++sequence}`);static revokeObjectURL=vi.fn();});
 });
 afterEach(()=>{clearPrivateMedia();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
 it('reclaims unused bytes while protecting visible images, then reloads an evicted token through Storage RLS',async()=>{
  const transport=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('/rest/v1/')?Response.json({image_urls:[ref(1),ref(2)]}):new Response('0123456789',{headers:{'content-type':'image/png'}}));
  const fetcher=createPrivateMediaFetch('https://example.supabase.co',transport,true);
  const {image_urls:[a,b]}=await(await fetcher('https://example.supabase.co/rest/v1/posts')).json();
  const first=await resolvePrivateMediaUrl(a);const release=retainPrivateMediaUrl(first!);const second=await resolvePrivateMediaUrl(b);
  await vi.advanceTimersByTimeAsync(31000);trimPrivateMedia(10,1);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(second);expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(first);
  expect(await resolvePrivateMediaUrl(a)).toBe(first);expect(transport).toHaveBeenCalledTimes(3);
  release();trimPrivateMedia(0,0,0);expect(URL.revokeObjectURL).toHaveBeenCalledWith(first);
  const reloaded=await resolvePrivateMediaUrl(a);expect(reloaded).not.toBe(first);expect(transport).toHaveBeenCalledTimes(4);
  expect(transport.mock.calls[3][0]).toContain('/storage/v1/object/authenticated/post-media/');
 });
 it('never revokes eager-response URLs which cannot be restored from a deferred token',async()=>{
  const transport=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('/rest/v1/')?Response.json({image_urls:[ref(3)]}):new Response('image',{headers:{'content-type':'image/png'}}));
  const response=await createPrivateMediaFetch('https://example.supabase.co',transport)('https://example.supabase.co/rest/v1/posts');const {image_urls:[url]}=await response.json();
  await vi.advanceTimersByTimeAsync(31000);trimPrivateMedia(0,0,0);expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(url);
 });
 it('keeps cached bytes alive during an overlapping Storage permission check',async()=>{
  let finish!:(value:Response)=>void;
  const transport=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>String(input).includes('/rest/v1/')?Response.json({image_urls:[ref(4)]}):init?.method==='HEAD'?await new Promise<Response>(resolve=>{finish=resolve;}):new Response('image',{headers:{'content-type':'image/png'}}));
  const fetcher=createPrivateMediaFetch('https://example.supabase.co',transport,true);
  const token=async()=>(await(await fetcher('https://example.supabase.co/rest/v1/posts')).json()).image_urls[0];
  const first=await resolvePrivateMediaUrl(await token());const second=resolvePrivateMediaUrl(await token());
  trimPrivateMedia(0,0,0);expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(first);
  finish(new Response(null,{headers:{'content-type':'image/png'}}));expect(await second).toBe(first);
 });
 it('retains browser behavior and tears down housekeeping and leases at account changes',async()=>{
  const transport=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('/rest/v1/')?Response.json({image_urls:[ref(5)]}):new Response('image',{headers:{'content-type':'image/png'}}));
  const token=(await(await createPrivateMediaFetch('https://example.supabase.co',transport,true)('https://example.supabase.co/rest/v1/posts')).json()).image_urls[0];
  const url=await resolvePrivateMediaUrl(token),release=retainPrivateMediaUrl(url!);clearPrivateMedia();release();
  expect(await resolvePrivateMediaUrl(token)).toBeNull();expect(vi.getTimerCount()).toBe(0);
  vi.stubGlobal('navigator',{standalone:false});const next=(await(await createPrivateMediaFetch('https://example.supabase.co',transport,true)('https://example.supabase.co/rest/v1/posts')).json()).image_urls[0];
  const fresh=await resolvePrivateMediaUrl(next);vi.mocked(URL.revokeObjectURL).mockClear();trimPrivateMedia(0,0,0);expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(fresh);expect(vi.getTimerCount()).toBe(0);
 });
});

it('uses current credentials when a deferred image is opened after its metadata token expires',async()=>{
 const path='11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.png';
 const credentials=vi.fn().mockResolvedValue('refreshed-access');
 const transport=vi.fn().mockResolvedValueOnce(Response.json({image_urls:[MEDIA_PREFIX+path]})).mockResolvedValue(new Response('image',{headers:{'content-type':'image/png'}}));
 const response=await createPrivateMediaFetch('https://example.supabase.co',transport,true,credentials)('https://example.supabase.co/rest/v1/posts',{headers:{authorization:'Bearer old-access',apikey:'public-key'}});
 const token=(await response.json()).image_urls[0];expect(credentials).not.toHaveBeenCalled();
 const original=URL.createObjectURL;URL.createObjectURL=vi.fn(()=> 'blob:refreshed');
 try{
  expect(await resolvePrivateMediaUrl(token)).toBe('blob:refreshed');
  expect(transport.mock.calls[1][1].headers.get('authorization')).toBe('Bearer refreshed-access');
  expect(transport.mock.calls[1][1].headers.get('apikey')).toBe('public-key');
 }finally{clearPrivateMedia();URL.createObjectURL=original;}
});

it('does not start an old image download if accounts change while credentials refresh',async()=>{
 let finish!:(token:string)=>void;
 const credentials=()=>new Promise<string>(resolve=>{finish=resolve;});
 const ref=MEDIA_PREFIX+'11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.png';
 const transport=vi.fn().mockResolvedValue(Response.json({image_urls:[ref]}));
 const response=await createPrivateMediaFetch('https://example.supabase.co',transport,true,credentials)('https://example.supabase.co/rest/v1/posts');
 const pending=resolvePrivateMediaUrl((await response.json()).image_urls[0]);
 clearPrivateMedia();finish('next-account-access');expect(await pending).toBeNull();expect(transport).toHaveBeenCalledOnce();
});
