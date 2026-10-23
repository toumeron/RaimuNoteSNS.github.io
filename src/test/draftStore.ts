/** A durable, asynchronous IDB test adapter, independent of runtime URL memory. */
export function makeDraftStore(){
 const data=new Map<string,unknown>();
 const control={failWrites:false,reads:0,delay:0};
 let created=false;
 const db={createObjectStore:()=>{},transaction:()=>{
  const tx={error:null as Error|null,oncomplete:null as null|(()=>void),onerror:null as null|(()=>void),onabort:null as null|(()=>void),objectStore:()=>({
   get(key:string){const request={result:undefined as unknown,error:null,onsuccess:null as null|(()=>void),onerror:null as null|(()=>void)};control.reads++;setTimeout(()=>{request.result=data.get(key);request.onsuccess?.();},control.delay);return request;},
   put(value:unknown,key:string){queueMicrotask(()=>{if(control.failWrites){tx.error=new Error('Quota exceeded');tx.onerror?.();}else{data.set(key,value);tx.oncomplete?.();}});},
   delete(key:string){queueMicrotask(()=>{if(control.failWrites){tx.error=new Error('Quota exceeded');tx.onerror?.();}else{data.delete(key);tx.oncomplete?.();}});},
  })};return tx;
 }};
 const factory={open:()=>{const request={result:db,error:null,onsuccess:null as null|(()=>void),onerror:null as null|(()=>void),onupgradeneeded:null as null|(()=>void)};queueMicrotask(()=>{if(!created){created=true;request.onupgradeneeded?.();}request.onsuccess?.();});return request;}};
 return {data,control,factory};
}
