

// localGemmaConfig
const LOCAL_GEMMA_MODEL='gemma-3-270m' as const;
type LimeChatModel='fast'|'advanced'|typeof LOCAL_GEMMA_MODEL;
function normalizeChatModel(value: unknown): LimeChatModel {
 return value==='advanced'||value===LOCAL_GEMMA_MODEL?value:'fast';
}
const GEMMA_REPOSITORY='onnx-community/gemma-3-270m-it-ONNX';
const GEMMA_REVISION='2dbbfdb1b59bd034eb959428c6a7da9dd7ea27f0';
const GEMMA_CACHE='lime-gemma-270m-v1';
const base=`https://huggingface.co/${GEMMA_REPOSITORY}/resolve/${GEMMA_REVISION}/`;
const GEMMA_RUNTIME='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';
const GEMMA_FILES=['config.json','generation_config.json','tokenizer.json','tokenizer_config.json','special_tokens_map.json','onnx/model_q4.onnx','onnx/model_q4.onnx_data'].map(file=>base+file);
const GEMMA_RESOURCES=[...GEMMA_FILES,GEMMA_RUNTIME+'ort-wasm-simd-threaded.jsep.mjs',GEMMA_RUNTIME+'ort-wasm-simd-threaded.jsep.wasm'];
const GEMMA_READY_URL='https://lime-local.invalid/gemma-270m/ready-v2';
const isLocalGemmaSession=(id:string|null|undefined)=>!!id?.startsWith('local-gemma:');
function canChangeChatModel(current:LimeChatModel,messageCount:number,next:LimeChatModel){
 return current===next||current!==LOCAL_GEMMA_MODEL||messageCount===0;
}
type LocalGemmaMessage={role:'user'|'assistant';content:string};
/** Keep instructions independent of history, so new chats carry them too. */
function gemmaChatMessages(messages:LocalGemmaMessage[],instructions:string):LocalGemmaMessage[]{
 const history:LocalGemmaMessage[]=[];
 // Failed/stopped generations can leave consecutive user turns. Gemma's
 // template requires alternating roles; merge content without changing storage.
 for(const message of messages){
  if(!message.content.trim()||(!history.length&&message.role==='assistant'))continue;
  const previous=history.at(-1);
  if(previous?.role===message.role)previous.content+='\n\n'+message.content;
  else history.push({...message});
 }
 if(history.length&&instructions.trim())history[0].content=`${instructions.trim()}\n\n${history[0].content}`;
 return history;
}

// localGemmaCache
const PART_HEADER='x-lime-gemma-parts';
const GEMMA_PART_BYTES=16*1024*1024;
const partUrl=(url:string,index:number)=>`${url}${url.includes('?')?'&':'?'}lime-gemma-part=${index}`;
/** Large streaming Cache.put() entries fail in some mobile/Chromium versions.
 * Keep each durable part small; commit the file marker only after every part. */
async function putGemmaResource(cache:Pick<Cache,'put'>,url:string,response:Response,partSize=GEMMA_PART_BYTES){
 const total=Number(response.headers.get('content-length'));
 if(total>0&&total<=partSize){await cache.put(url,response);return;}
 if(!response.body)throw new Error('モデルファイルが空です');
 const reader=response.body.getReader();let part=new Uint8Array(partSize),used=0,count=0,bytes=0;
 const write=async()=>{if(!used)return;await cache.put(partUrl(url,count++),new Response(part.slice(0,used)));bytes+=used;used=0;};
 try{
  while(true){const {done,value}=await reader.read();if(done)break;
   let offset=0;while(offset<value.length){const size=Math.min(partSize-used,value.length-offset);part.set(value.subarray(offset,offset+size),used);used+=size;offset+=size;if(used===partSize)await write();}
  }
  await write();
  if(total&&bytes!==total)throw new Error('モデルファイルのダウンロードが完了していません');
  const headers=new Headers(response.headers);headers.set(PART_HEADER,String(count));headers.set('content-length',String(bytes));
  // Marker content-length describes the reconstructed file, not this response.
  const markerHeaders=new Headers(headers);markerHeaders.delete('content-length');
  await cache.put(url,new Response(JSON.stringify({bytes}),{headers:markerHeaders}));
 }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}
async function getGemmaResource(cache:Pick<Cache,'match'>,url:RequestInfo|URL):Promise<Response|undefined>{
 const response=await cache.match(url);if(!response)return undefined;
 const count=Number(response.headers.get(PART_HEADER));if(!count)return response;
 const key=typeof url==='string'?url:url instanceof URL?url.href:url.url;
 const {bytes}=await response.json();let index=0;
 const headers=new Headers(response.headers);headers.delete(PART_HEADER);headers.set('content-length',String(bytes));
 return new Response(new ReadableStream<Uint8Array>({async pull(controller){
  if(index===count){controller.close();return;}
  try{const part=await cache.match(partUrl(key,index++));if(!part)throw new Error('モデルの保存データが不足しています。削除して再ダウンロードしてください');controller.enqueue(new Uint8Array(await part.arrayBuffer()));}
  catch(error){controller.error(error);}
 }}),{headers});
}

// localGemmaSessions
type LocalGemmaSession={id:string;title:string;messages:{id:string;role:'user'|'assistant';content:string}[];updatedAt:number};
const STORE='sessions';
function transaction<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
 return new Promise((resolve,reject)=>{
  const opening=indexedDB.open('limenote-local-chats',1);
  opening.onupgradeneeded=()=>opening.result.createObjectStore(STORE,{keyPath:['owner','id']});
  opening.onerror=()=>reject(opening.error);
  opening.onsuccess=()=>{
   const db=opening.result,tx=db.transaction(STORE,mode),request=run(tx.objectStore(STORE));let result:T;
   request.onsuccess=()=>{result=request.result;};
   tx.oncomplete=()=>{db.close();resolve(result);};
   tx.onabort=tx.onerror=()=>{db.close();reject(tx.error??request.error??new Error('端末内に履歴を保存できませんでした'));};
  };
 });
}
async function listLocalGemmaSessions(owner:string):Promise<LocalGemmaSession[]>{
 const rows=await transaction<any[]>('readonly',store=>store.getAll(IDBKeyRange.bound([owner,''],[owner,'\uffff'])));
 return rows.filter(row=>isLocalGemmaSession(row.id)).map(({owner:_,...session})=>session).sort((a,b)=>b.updatedAt-a.updatedAt);
}
function saveLocalGemmaSession(owner:string,session:LocalGemmaSession){
 if(!isLocalGemmaSession(session.id))throw new Error('ローカルチャットではありません');
 return transaction('readwrite',store=>store.put({owner,...session}));
}
const deleteLocalGemmaSession=(owner:string,id:string)=>transaction('readwrite',store=>store.delete([owner,id]));

export { normalizeChatModel };
export { canChangeChatModel };
export { gemmaChatMessages };
export { LOCAL_GEMMA_MODEL };
export type { LimeChatModel };
export { GEMMA_REPOSITORY };
export { GEMMA_REVISION };
export { GEMMA_CACHE };
export { GEMMA_RUNTIME };
export { GEMMA_FILES };
export { GEMMA_RESOURCES };
export { GEMMA_READY_URL };
export { isLocalGemmaSession };
export type { LocalGemmaMessage };
export { putGemmaResource };
export { getGemmaResource };
export { GEMMA_PART_BYTES };
export { listLocalGemmaSessions };
export { saveLocalGemmaSession };
export type { LocalGemmaSession };
export { deleteLocalGemmaSession };
