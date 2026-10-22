import {afterEach,expect,it,vi} from 'vitest';
import {Blob as NodeBlob} from 'node:buffer';
import {readSavedPreview,savePreview,savePreviewImage} from './mediaThumbnail';
const key='lime-link-previews-v1';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
it('parses unchanged preview metadata once while reflecting edits from other windows',()=>{
 const url='https://example.com/cached',preview={url,title:'Cached title',domain:'example.com',image:''};
 const raw=JSON.stringify({[url]:{preview,savedAt:Date.now(),version:6}});localStorage.setItem(key,raw);
 const parse=vi.spyOn(JSON,'parse');for(let i=0;i<30;i++)expect(readSavedPreview(url)?.preview?.title).toBe('Cached title');
 expect(parse.mock.calls.filter(call=>call[0]===raw)).toHaveLength(1);
 localStorage.setItem(key,JSON.stringify({[url]:{preview:{...preview,title:'Updated title'},savedAt:Date.now(),version:6}}));
 expect(readSavedPreview(url)?.preview?.title).toBe('Updated title');localStorage.removeItem(key);expect(readSavedPreview(url)).toBeUndefined();
});
it('does not mutate cached metadata when persistence fails',()=>{
 const url='https://example.com/original',preview={url,title:'Original title',domain:'example.com',image:''};savePreview(url,preview);
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});savePreview(url,{...preview,title:'Unsaved title'});
 expect(readSavedPreview(url)?.preview?.title).toBe('Original title');
});

function imageStore(count:number){
 const has=vi.fn(()=>{const request={result:count,onsuccess:null as null|(()=>void)};queueMicrotask(()=>request.onsuccess?.());return request;}),get=vi.fn(),put=vi.fn(),close=vi.fn();
 const db={transaction:()=>({objectStore:()=>({count:has,get,put})}),close};
 vi.stubGlobal('indexedDB',{open:()=>{const request={result:db,onsuccess:null as null|(()=>void)};queueMicrotask(()=>request.onsuccess?.());return request;}});
 return {has,get,put,close};
}
it('checks a cached image by key without reading its image bytes or fetching it again',async()=>{
 const store=imageStore(1),fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 await Promise.all([savePreviewImage('https://images.example/cached'),savePreviewImage('https://images.example/cached')]);
 expect(store.has).toHaveBeenCalledOnce();expect(store.get).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();expect(store.close).toHaveBeenCalledOnce();
});
it('cancels an oversized preview stream before buffering the complete image',async()=>{
 const store=imageStore(0),cancel=vi.fn();
 const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(8*1024*1024+1));},cancel});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(stream,{headers:{'content-type':'image/png'}})));
 await savePreviewImage('https://images.example/oversized');expect(cancel).toHaveBeenCalledOnce();expect(store.put).not.toHaveBeenCalled();
});

// A value cursor would materialize every cached ArrayBuffer. The eviction
// fixture deliberately rejects those reads after the one-time upgrade.
function indexedImages(initial:Array<{url:string;savedAt:number;size?:number;bytes?:ArrayBuffer}>,upgrade=false){
 const records=new Map(initial.map(record=>[record.url,record]));
 const deleted=vi.fn((url:string)=>records.delete(url)),put=vi.fn((record:any)=>records.set(record.url,record));
 const createIndex=vi.fn(),valueReads=vi.fn();let upgraded=!upgrade;
 const db={close:vi.fn(),transaction:()=>{
  const tx:any={objectStore:()=>store};
  const store={
   count:(url:string)=>{const request:any={};queueMicrotask(()=>{request.result=records.has(url)?1:0;request.onsuccess?.();});return request;},
   index:(name:string)=>{
    expect(name).toBe('by-saved-size-url');return {openKeyCursor:()=>{
     const keys=[...records.values()].sort((a,b)=>a.savedAt-b.savedAt).map(record=>[record.savedAt,record.size,record.url]);
     const request:any={};let index=0;const next=()=>queueMicrotask(()=>{
      const key=keys[index++];request.result=key?{key,get value(){throw Error('Eviction must not clone image bytes');},continue:next}:null;request.onsuccess?.();
     });next();return request;
    }};
   },
   delete:deleted,
   put:(record:any)=>{put(record);queueMicrotask(()=>tx.oncomplete?.());},
  };return tx;
 }};
 vi.stubGlobal('indexedDB',{open:vi.fn((_name:string,version:number)=>{
  expect(version).toBe(2);const request:any={result:db};
  queueMicrotask(()=>{
   if(upgraded){request.onsuccess?.();return;}upgraded=true;
   request.transaction={objectStore:()=>({createIndex,openCursor:()=>{
    const rows=[...records.values()];let index=0;const scan:any={};const next=()=>queueMicrotask(()=>{
     const row=rows[index++];scan.result=row?{get value(){valueReads();return row;},update:(record:any)=>records.set(row.url,record),continue:next}:null;
     scan.onsuccess?.();if(!row)request.onsuccess?.();
    });next();return scan;
   }})};request.onupgradeneeded?.({oldVersion:1});
  });return request;
 })});
 return {records,deleted,put,createIndex,valueReads};
}
it('evicts by indexed metadata, keeping the newest images within the byte budget without reading their buffers',async()=>{
 vi.stubGlobal('Blob',NodeBlob);const mib=1024*1024;
 const store=indexedImages([{url:'oldest',savedAt:1,size:20*mib},{url:'middle',savedAt:2,size:15*mib},{url:'newest',savedAt:3,size:5*mib}]);
 const bytes=new Uint8Array(mib);vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(bytes,{headers:{'content-type':'image/png'}})));
 await savePreviewImage('https://images.example/new');
 expect(store.deleted.mock.calls).toEqual([['oldest']]);expect(store.records.has('newest')).toBe(true);
 expect(store.put.mock.calls[0][0]).toMatchObject({size:mib});expect(store.valueReads).not.toHaveBeenCalled();
});
it('upgrades existing image metadata once and retains its offline image bytes without downloading again',async()=>{
 const bytes=new Uint8Array([1,2,3]).buffer,url='https://images.example/legacy';
 const store=indexedImages([{url,savedAt:10,bytes}],true),fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 await savePreviewImage(url);
 expect(store.createIndex).toHaveBeenCalledWith('by-saved-size-url',['savedAt','size','url']);
 expect(store.records.get(url)).toMatchObject({url,savedAt:10,size:3,bytes});expect(store.valueReads).toHaveBeenCalledOnce();expect(fetch).not.toHaveBeenCalled();
});
it('bounds PWA image-cache work to two concurrent fetches, deduplicates queued jobs and recovers after failures',async()=>{
 vi.stubGlobal('navigator',{standalone:true});imageStore(0);
 let first!:(response:Response)=>void,second!:(response:Response)=>void;
 const fetch=vi.fn().mockResolvedValue(new Response(null,{status:503}))
  .mockImplementationOnce(()=>new Promise<Response>(resolve=>{first=resolve;}))
  .mockImplementationOnce(()=>new Promise<Response>(resolve=>{second=resolve;}));vi.stubGlobal('fetch',fetch);
 const urls=Array.from({length:12},(_,index)=>`https://images.example/queued-${index}`),jobs=urls.map(url=>savePreviewImage(url));
 expect(savePreviewImage(urls[4])).toBe(jobs[4]);await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));
 first(new Response(null,{status:503}));await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(12));second(new Response(null,{status:503}));await Promise.all(jobs);
 await savePreviewImage(urls[0]);expect(fetch).toHaveBeenCalledTimes(13);
});
