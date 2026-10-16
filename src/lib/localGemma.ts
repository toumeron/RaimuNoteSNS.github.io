import { putGemmaResource } from "@/lib/localGemmaConfig";
import {GEMMA_CACHE,GEMMA_READY_URL,GEMMA_RESOURCES,type LocalGemmaMessage} from './localGemmaConfig';
export type GemmaState={status:'missing'|'downloading'|'loading'|'ready'|'error';downloaded:boolean;progress:number;error?:string};
let state:GemmaState={status:'missing',downloaded:false,progress:0};
const listeners=new Set<()=>void>();
const publish=(patch:Partial<GemmaState>)=>{state={...state,...patch};listeners.forEach(listener=>listener());};
export const subscribeLocalGemma=(listener:()=>void)=>{listeners.add(listener);return()=>listeners.delete(listener);};
export const getLocalGemmaState=()=>state;
let epoch=0;
let downloadJob:Promise<void>|undefined,worker:Worker|undefined,loadJob:Promise<void>|undefined,sequence=0;
const requests=new Map<number,{resolve:(text:string)=>void;reject:(error:Error)=>void;onText?:(text:string)=>void}>();
function terminate(){
 epoch++;
 worker?.terminate();worker=undefined;loadJob=undefined;
 for(const request of requests.values())request.reject(new DOMException('停止しました','AbortError'));
 requests.clear();
 if(state.downloaded)publish({status:'ready',error:undefined});
}
export const releaseLocalGemma=()=>terminate();
function getWorker(){
 if(!worker){
  worker=new Worker(new URL('./localGemma.worker.ts',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
   const request=requests.get(data.id);if(!request)return;
   if(data.type==='text'){request.onText?.(data.text);return;}
   requests.delete(data.id);
   if(data.error)request.reject(new Error(data.error));else request.resolve(data.text??'');
  };
  worker.onerror=()=>{const error=new Error('端末内モデルを実行できませんでした');for(const request of requests.values())request.reject(error);requests.clear();worker?.terminate();worker=undefined;loadJob=undefined;publish({status:'error',error:error.message});};
 }
 return worker;
}
function request(type:'load'|'generate',payload:object={},onText?:(text:string)=>void){
 const id=++sequence;
 return new Promise<string>((resolve,reject)=>{requests.set(id,{resolve,reject,onText});try{getWorker().postMessage({id,type,...payload});}catch(error){requests.delete(id);reject(error);}});
}
export async function checkLocalGemmaDownload(){
 if(downloadJob)return;
 try{
  const cache=await caches.open(GEMMA_CACHE);
  const ready=!!await cache.match(GEMMA_READY_URL)&& (await Promise.all(GEMMA_RESOURCES.map(url=>cache.match(url)))).every(Boolean);
  if(!downloadJob&&state.status!=='loading')publish({downloaded:ready,status:ready?'ready':'missing',progress:ready?100:0});
 }catch{publish({status:'missing',downloaded:false});}
}
/** Only fixed model/runtime URLs are downloaded; no messages enter this path. */
export function downloadLocalGemma():Promise<void>{
 if(downloadJob)return downloadJob;
 if(state.downloaded)return Promise.resolve();
 downloadJob=(async()=>{
  publish({status:'downloading',progress:0,error:undefined});
  try{
   if(!('caches' in globalThis))throw new Error('このブラウザーではモデルを端末内に保存できません');
   const cache=await caches.open(GEMMA_CACHE);let completed=0,lastUpdate=0;
   for(const url of GEMMA_RESOURCES){
    if(!await cache.match(url)){
     const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer'});
     if(!response.ok||!response.body)throw new Error(`モデルのダウンロードに失敗しました (${response.status})`);
     const total=Number(response.headers.get('content-length'));let loaded=0;
     const stream=response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){
      loaded+=chunk.byteLength;controller.enqueue(chunk);
      if(Date.now()-lastUpdate>120){lastUpdate=Date.now();publish({progress:Math.min(99,(completed+(total?Math.min(1,loaded/total):0))/GEMMA_RESOURCES.length*100)});}
     }}));
     try{await putGemmaResource(cache,url,new Response(stream,{headers:response.headers,status:response.status}));}catch(error){throw new Error(`モデルを端末内に保存できませんでした (${url.split('/').at(-1)}): ${error instanceof Error?error.message:String(error)}`);}
    }
    completed++;publish({progress:completed/GEMMA_RESOURCES.length*100});
   }
   await cache.put(GEMMA_READY_URL,new Response('ready'));
   // Persistence is best-effort; absence never enables a server fallback.
   void navigator.storage?.persist?.().catch(()=>{});
   publish({status:'ready',downloaded:true,progress:100});
  }catch(error){publish({status:'error',downloaded:false,error:error instanceof Error?error.message:'モデルを保存できませんでした'});throw error;}
 })().finally(()=>{downloadJob=undefined;});
 return downloadJob;
}
export async function loadLocalGemma(){
 await downloadLocalGemma();
 if(!loadJob){const jobEpoch=epoch;loadJob=(async()=>{publish({status:'loading',error:undefined});await request('load');if(jobEpoch===epoch)publish({status:'ready'});})().catch(error=>{if(jobEpoch===epoch){loadJob=undefined;publish({status:'error',error:error.message});}throw error;});}
 return loadJob;
}
export async function deleteLocalGemma(){
 if(downloadJob)throw new Error('ダウンロードが完了してから削除してください');
 terminate();await caches.delete(GEMMA_CACHE);publish({status:'missing',downloaded:false,progress:0,error:undefined});
}
export async function generateLocalGemma(messages:LocalGemmaMessage[],instructions:string,signal:AbortSignal,onText:(text:string)=>void,maxNewTokens=256){
 const abort=()=>terminate();signal.addEventListener('abort',abort,{once:true});
 try{
  if(signal.aborted)throw signal.reason;
  await loadLocalGemma();if(signal.aborted)throw signal.reason;
  return await request('generate',{messages,instructions,maxNewTokens},onText);
 }finally{signal.removeEventListener('abort',abort);}
}
