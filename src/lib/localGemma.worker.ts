import { getGemmaResource } from "@/lib/localGemmaConfig";
// This alias isolates ORT 1.24.3 from the image models' older ORT dependency.
// The pinned Gemma graph requires uint8 GatherBlockQuantized zero-point support.
import {pipeline,TextStreamer,env,type TextGenerationPipeline} from '@huggingface/transformers-gemma';
import {GEMMA_CACHE,GEMMA_REPOSITORY,GEMMA_REVISION,GEMMA_RUNTIME,gemmaChatMessages,type LocalGemmaMessage} from './localGemmaConfig';
// A dedicated worker keeps WASM inference off the UI thread. Model resources
// must already be in the dedicated cache. No remote inference or tools exist.
env.allowLocalModels=true;env.allowRemoteModels=false;env.useBrowserCache=false;env.useFSCache=false;env.useCustomCache=true;
env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
let engine:TextGenerationPipeline|undefined,busy=false;
async function load(){
 if(engine)return engine;
 const cache=await caches.open(GEMMA_CACHE);
 env.customCache={match:async key=>getGemmaResource(cache,key),put:async()=>{throw new Error('読み取り専用モデルキャッシュ');}};
 const mjs=await getGemmaResource(cache,GEMMA_RUNTIME+'ort-wasm-simd-threaded.jsep.mjs'),wasm=await getGemmaResource(cache,GEMMA_RUNTIME+'ort-wasm-simd-threaded.jsep.wasm');
 if(!mjs||!wasm)throw new Error('モデルをダウンロードしてください');
 // Pass cached WASM bytes directly: no second fetch or Blob URL lifetime is required.
 env.backends.onnx.wasm.wasmBinary=await wasm.arrayBuffer();
 env.backends.onnx.wasm.wasmPaths={mjs:URL.createObjectURL(await mjs.blob())};
 // Even a missing model file must not turn a conversation into a network read.
 const nativeFetch=self.fetch.bind(self);
 self.fetch=async(input,init)=>{const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;if(url.startsWith('blob:'))return nativeFetch(input,init);throw new Error('端末内モデルのファイルが不足しています。再ダウンロードしてください');};
 const create=pipeline as unknown as (task:string,model:string,options:Record<string,unknown>)=>Promise<TextGenerationPipeline>;
 engine=await create('text-generation',GEMMA_REPOSITORY,{revision:GEMMA_REVISION,dtype:'q4',device:'wasm',local_files_only:true});
 return engine;
}
self.onmessage=async({data}:{data:{id:number;type:'load'|'generate';messages?:LocalGemmaMessage[];instructions?:string;maxNewTokens?:number}})=>{
 if(busy){self.postMessage({id:data.id,error:'端末内モデルは処理中です'});return;}busy=true;
 try{
  const generator=await load();
  if(data.type==='load'){self.postMessage({id:data.id});return;}
  const turns=[...(data.messages??[])];
  let history=gemmaChatMessages(turns,data.instructions??'');
  while(turns.length>2&&(generator.tokenizer.apply_chat_template(history,{tokenize:true,return_tensor:false,add_generation_prompt:true}) as number[]).length>4096){turns.splice(0,2);history=gemmaChatMessages(turns,data.instructions??'');}
  if((generator.tokenizer.apply_chat_template(history,{tokenize:true,return_tensor:false,add_generation_prompt:true}) as number[]).length>8192)throw new Error('入力と指示が長いため、この端末内モデルでは処理できません');
  let text='';
  const output=await generator(history,{max_new_tokens:Math.max(1,Math.min(256,data.maxNewTokens??256)),do_sample:false,repetition_penalty:1.1,streamer:new TextStreamer(generator.tokenizer,{skip_prompt:true,skip_special_tokens:true,callback_function:part=>{text+=part;self.postMessage({id:data.id,type:'text',text});}})});
  const generated=(output as unknown as {generated_text?:LocalGemmaMessage[]|string}[])[0]?.generated_text;
  if(!text.trim()&&Array.isArray(generated))text=String(generated.at(-1)?.content??'');
  if(!text.trim())throw new Error('返答を生成できませんでした');
  self.postMessage({id:data.id,text});
 }catch(error){self.postMessage({id:data.id,error:error instanceof Error?error.message:String(error),stack:import.meta.env.DEV&&error instanceof Error?error.stack:undefined});}finally{busy=false;}
};
