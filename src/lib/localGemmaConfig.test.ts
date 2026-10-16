import { expect, it } from "vitest";
import { canChangeChatModel, normalizeChatModel, gemmaChatMessages, LOCAL_GEMMA_MODEL, putGemmaResource, getGemmaResource } from "@/lib/localGemmaConfig";

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
