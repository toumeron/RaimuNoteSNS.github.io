export const LOCAL_GEMMA_MODEL='gemma-3-270m' as const;
export type LimeChatModel='fast'|'advanced'|'flash'|typeof LOCAL_GEMMA_MODEL;
export const GEMMA_REPOSITORY='onnx-community/gemma-3-270m-it-ONNX';
export const GEMMA_REVISION='2dbbfdb1b59bd034eb959428c6a7da9dd7ea27f0';
export const GEMMA_CACHE='lime-gemma-270m-v1';
const base=`https://huggingface.co/${GEMMA_REPOSITORY}/resolve/${GEMMA_REVISION}/`;
export const GEMMA_RUNTIME='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';
export const GEMMA_FILES=['config.json','generation_config.json','tokenizer.json','tokenizer_config.json','special_tokens_map.json','onnx/model_q4.onnx','onnx/model_q4.onnx_data'].map(file=>base+file);
export const GEMMA_RESOURCES=[...GEMMA_FILES,GEMMA_RUNTIME+'ort-wasm-simd-threaded.jsep.mjs',GEMMA_RUNTIME+'ort-wasm-simd-threaded.jsep.wasm'];
export const GEMMA_READY_URL='https://lime-local.invalid/gemma-270m/ready-v2';
export const isLocalGemmaSession=(id:string|null|undefined)=>!!id?.startsWith('local-gemma:');
export function canChangeChatModel(current:LimeChatModel,messageCount:number,next:LimeChatModel){
 return current===next||current!==LOCAL_GEMMA_MODEL||messageCount===0;
}
export type LocalGemmaMessage={role:'user'|'assistant';content:string};
/** Keep instructions independent of history, so new chats carry them too. */
export function gemmaChatMessages(messages:LocalGemmaMessage[],instructions:string):LocalGemmaMessage[]{
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
