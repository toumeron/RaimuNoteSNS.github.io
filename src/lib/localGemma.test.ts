import {afterEach,expect,it,vi} from 'vitest';
import {GEMMA_CACHE,GEMMA_READY_URL,GEMMA_RESOURCES} from './localGemmaConfig';
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
 const local=await import('./localGemma');await local.downloadLocalGemma();
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
 const {GEMMA_FILES}=await import('./localGemmaConfig');
 for(const url of GEMMA_FILES)await cache.put(url,new Response('existing-model'));
 await cache.put('https://lime-local.invalid/gemma-270m/ready-v1',new Response('ready'));
 vi.stubGlobal('caches',{open:vi.fn(async()=>cache)});
 const fetch=vi.fn(async(_url:string)=>new Response('new-runtime',{headers:{'content-length':'11'}}));vi.stubGlobal('fetch',fetch);
 const local=await import('./localGemma');await local.checkLocalGemmaDownload();
 expect(local.getLocalGemmaState().downloaded).toBe(false);
 await local.downloadLocalGemma();
 expect(fetch.mock.calls.map(call=>call[0])).toEqual(GEMMA_RESOURCES.filter(url=>!GEMMA_FILES.includes(url)));
 expect(await (await cache.match(GEMMA_FILES.at(-1)!))!.text()).toBe('existing-model');
 expect(local.getLocalGemmaState().downloaded).toBe(true);
});
