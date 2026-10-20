import {afterEach,expect,it,vi} from 'vitest';
import {savePreviewImage} from './mediaThumbnail';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('evicts old images using cursor metadata without bulk-cloning the cached image bytes',async()=>{
 const rows=Array.from({length:21},(_,i)=>({url:`image-${i}`,savedAt:i,bytes:{byteLength:2*1024*1024}}));
 const deleted=vi.fn(),put=vi.fn(),getAll=vi.fn(()=>{throw new Error('Bulk image read');});
 const db={close:vi.fn(),transaction:()=>{
  const tx:any={objectStore:()=>store};
  const store={getAll,delete:deleted,get:()=>{const request:any={result:undefined};queueMicrotask(()=>request.onsuccess());return request;},put:(value:unknown)=>{put(value);queueMicrotask(()=>tx.oncomplete());},openCursor:()=>{
   let i=0;const request:any={};const next=()=>{request.result=i<rows.length?{value:rows[i],continue:()=>{i++;queueMicrotask(next);}}:null;request.onsuccess();};queueMicrotask(next);return request;
  }};return tx;
 }};
 vi.stubGlobal('indexedDB',{open:()=>{const request:any={result:db};queueMicrotask(()=>request.onsuccess());return request;}});
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,blob:async()=>({size:9,type:'image/png',arrayBuffer:async()=>new ArrayBuffer(9)})})));
 await savePreviewImage('https://example.com/new-image.png');
 expect(getAll).not.toHaveBeenCalled();expect(put).toHaveBeenCalledOnce();expect(deleted.mock.calls).toEqual([['image-0'],['image-1']]);expect(db.close).toHaveBeenCalledTimes(2);
});
