import {Blob as WebBlob} from 'node:buffer';
import {afterEach,expect,it,vi} from 'vitest';
import {savePreviewImage} from './mediaThumbnail';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('evicts old images using cursor metadata without bulk-cloning the cached image bytes',async()=>{
 vi.stubGlobal('Blob',WebBlob);
 const rows=Array.from({length:21},(_,i)=>({url:`image-${i}`,savedAt:i,size:2*1024*1024}));
 const deleted=vi.fn(),put=vi.fn(),getAll=vi.fn(()=>{throw new Error('Bulk image read');});
 const db={close:vi.fn(),transaction:()=>{
  const tx:any={objectStore:()=>store};
  const store={count:()=>{const request:any={result:0};queueMicrotask(()=>request.onsuccess());return request;},getAll,delete:deleted,get:()=>{const request:any={result:undefined};queueMicrotask(()=>request.onsuccess());return request;},put:(value:unknown)=>{put(value);queueMicrotask(()=>tx.oncomplete());},index:()=>({openKeyCursor:()=>{
   let i=0;const request:any={};const next=()=>{request.result=i<rows.length?{key:[rows[i].savedAt,rows[i].size,rows[i].url],get value(){throw new Error('Image buffer read');},continue:()=>{i++;queueMicrotask(next);}}:null;request.onsuccess();};queueMicrotask(next);return request;
  }})};return tx;
 }};
 vi.stubGlobal('indexedDB',{open:()=>{const request:any={result:db};queueMicrotask(()=>request.onsuccess());return request;}});
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array(9),{headers:{'content-type':'image/png'}})));
 await savePreviewImage('https://example.com/new-image.png');
 expect(getAll).not.toHaveBeenCalled();expect(put).toHaveBeenCalledOnce();expect(deleted.mock.calls).toEqual([['image-0'],['image-1']]);expect(db.close).toHaveBeenCalledTimes(2);
});
