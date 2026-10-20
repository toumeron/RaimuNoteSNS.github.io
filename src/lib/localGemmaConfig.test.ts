import { expect, it, afterEach, vi } from "vitest";
import { canChangeChatModel, normalizeChatModel, gemmaChatMessages, LOCAL_GEMMA_MODEL, putGemmaResource, getGemmaResource, GEMMA_CACHE, GEMMA_READY_URL, GEMMA_RESOURCES } from "@/lib/localGemmaConfig";

describe("localGemmaConfig", () => {
describe("localGemmaConfig", () => {
it('locks Gemma conversations but allows choosing a model in a new empty chat',()=>{
 expect(canChangeChatModel(LOCAL_GEMMA_MODEL,1,'fast')).toBe(false);
 expect(canChangeChatModel(LOCAL_GEMMA_MODEL,1,'advanced')).toBe(false);
 expect(canChangeChatModel(LOCAL_GEMMA_MODEL,1,LOCAL_GEMMA_MODEL)).toBe(true);
 expect(canChangeChatModel(LOCAL_GEMMA_MODEL,0,'fast')).toBe(true);
 expect(canChangeChatModel('fast',20,LOCAL_GEMMA_MODEL)).toBe(true);
});
it('carries complete instructions into each fresh chat without mixing the old history',()=>{
 const instructions='呼び名: らいむ\nカスタム指示: 丁寧に答える\nメモリ: 好きな色は青';
 const original=[{role:'user' as const,content:'こんにちは'}];
 const first=gemmaChatMessages(original,instructions),second=gemmaChatMessages([{role:'user',content:'新しい会話'}],instructions);
 expect(first[0].content).toBe(instructions+'\n\nこんにちは');expect(second[0].content).toBe(instructions+'\n\n新しい会話');
 expect(second[0].content).not.toContain('こんにちは');expect(original[0].content).toBe('こんにちは');
});
it('normalizes retries, interrupted responses and repeated roles without losing content',()=>{
 const original=[{role:'assistant' as const,content:'welcome'},{role:'user' as const,content:'first failed request'},{role:'assistant' as const,content:''},{role:'user' as const,content:'retry'},{role:'assistant' as const,content:'part one'},{role:'assistant' as const,content:'part two'},{role:'user' as const,content:'next'}];
 expect(gemmaChatMessages(original,'keep instructions')).toEqual([
  {role:'user',content:'keep instructions\n\nfirst failed request\n\nretry'},
  {role:'assistant',content:'part one\n\npart two'},
  {role:'user',content:'next'},
 ]);
 expect(original[1].content).toBe('first failed request');
});

it('restores supported models and falls back safely for retired or invalid saved models',()=>{
 expect(normalizeChatModel('fast')).toBe('fast');
 expect(normalizeChatModel('advanced')).toBe('advanced');
 expect(normalizeChatModel(LOCAL_GEMMA_MODEL)).toBe(LOCAL_GEMMA_MODEL);
 for(const value of ['flash','unknown',null,undefined])expect(normalizeChatModel(value)).toBe('fast');
});
});

describe("localGemmaCache", () => {
it('reconstructs large files byte-for-byte from small durable parts and detects missing parts',async()=>{
 const rows=new Map<string,Response>();
 const cache={put:async(key:string,response:Response)=>{rows.set(key,new Response(await response.arrayBuffer(),{headers:response.headers}));},match:async(key:RequestInfo|URL)=>rows.get(String(key))?.clone()} as any;
 const bytes=Uint8Array.from({length:103},(_,i)=>i),url='https://example.test/model.onnx_data';
 await putGemmaResource(cache,url,new Response(bytes,{headers:{'content-length':String(bytes.length)}}),16);
 expect(rows.size).toBe(8);
 expect(new Uint8Array(await (await getGemmaResource(cache,url))!.arrayBuffer())).toEqual(bytes);
 rows.delete(url+'?lime-gemma-part=4');
 await expect((await getGemmaResource(cache,url))!.arrayBuffer()).rejects.toThrow('保存データが不足');
});
it('never marks an incomplete download as a complete model file',async()=>{
 const rows=new Map<string,Response>();const cache={put:async(key:string,response:Response)=>{rows.set(key,response);}} as any;
 await expect(putGemmaResource(cache,'https://example.test/file',new Response(new Uint8Array(18),{headers:{'content-length':'30'}}),16)).rejects.toThrow('ダウンロードが完了していません');
 expect(rows.has('https://example.test/file')).toBe(false);
});
});
});

describe("localGemma", () => {
class MemoryCache{
 entries=new Map<string,Response>();
 async match(key:string){return this.entries.get(key)?.clone();}
 async put(key:string,response:Response){const body=await response.arrayBuffer();this.entries.set(key,new Response(body,{headers:response.headers}));}
}
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
it('downloads only fixed model assets, sends prompts only to a worker, and deletes only its own cache',async()=>{
 const cache=new MemoryCache(),other=new MemoryCache(),buckets=new Map([[GEMMA_CACHE,cache],['another-model',other]]);
 vi.stubGlobal('caches',{open:vi.fn(async(name:string)=>{if(!buckets.has(name))buckets.set(name,new MemoryCache());return buckets.get(name)!;}),delete:vi.fn(async(name:string)=>buckets.delete(name))});
 const fetch=vi.fn(async(_url:string,_options?:RequestInit)=>new Response('fixture',{headers:{'content-length':'7'}}));vi.stubGlobal('fetch',fetch);
 const posted:any[]=[];let lastWorker:any;
 vi.stubGlobal('Worker',class{onmessage:(event:any)=>void;onerror:()=>void;terminate=vi.fn();constructor(){lastWorker=this;}postMessage(data:any){posted.push(data);if(data.messages?.[0]?.content==='STOP')return;queueMicrotask(()=>this.onmessage?.({data:{id:data.id,...(data.type==='generate'?{text:'端末内の回答'}:{})}}));}});
 const local=await import("@/lib/localGemma");await local.downloadLocalGemma();
 expect(fetch.mock.calls.map(call=>call[0])).toEqual(GEMMA_RESOURCES);expect(local.getLocalGemmaState().downloaded).toBe(true);expect(await cache.match(GEMMA_READY_URL)).toBeTruthy();
 fetch.mockClear();const onText=vi.fn();
 expect(await local.generateLocalGemma([{role:'user',content:'秘密の会話'}],'秘密の指示',new AbortController().signal,onText)).toBe('端末内の回答');
 expect(fetch).not.toHaveBeenCalled();expect(posted.at(-1)).toMatchObject({type:'generate',instructions:'秘密の指示',messages:[{content:'秘密の会話'}]});
 const abort=new AbortController();
 const stopped=local.generateLocalGemma([{role:'user',content:'STOP'}],'指示',abort.signal,()=>{});
 const rejected=expect(stopped).rejects.toMatchObject({name:'AbortError'});
 await vi.waitFor(()=>expect(posted.at(-1)?.messages?.[0]?.content).toBe('STOP'));
 abort.abort();await rejected;expect(local.getLocalGemmaState()).toMatchObject({status:'ready',downloaded:true});
 expect(await local.generateLocalGemma([{role:'user',content:'再開'}],'指示',new AbortController().signal,()=>{})).toBe('端末内の回答');
 expect(fetch).not.toHaveBeenCalled();
 await local.deleteLocalGemma();expect(lastWorker.terminate).toHaveBeenCalled();expect(buckets.has(GEMMA_CACHE)).toBe(false);expect(buckets.has('another-model')).toBe(true);expect(local.getLocalGemmaState().downloaded).toBe(false);
});
it('updates an older downloaded runtime without redownloading model weights',async()=>{
 const cache=new MemoryCache();
 const {GEMMA_FILES}=await import("@/lib/localGemmaConfig");
 for(const url of GEMMA_FILES)await cache.put(url,new Response('existing-model'));
 await cache.put('https://lime-local.invalid/gemma-270m/ready-v1',new Response('ready'));
 vi.stubGlobal('caches',{open:vi.fn(async()=>cache)});
 const fetch=vi.fn(async(_url:string)=>new Response('new-runtime',{headers:{'content-length':'11'}}));vi.stubGlobal('fetch',fetch);
 const local=await import("@/lib/localGemma");await local.checkLocalGemmaDownload();
 expect(local.getLocalGemmaState().downloaded).toBe(false);
 await local.downloadLocalGemma();
 expect(fetch.mock.calls.map(call=>call[0])).toEqual(GEMMA_RESOURCES.filter(url=>!GEMMA_FILES.includes(url)));
 expect(await (await cache.match(GEMMA_FILES.at(-1)!))!.text()).toBe('existing-model');
 expect(local.getLocalGemmaState().downloaded).toBe(true);
});
});
