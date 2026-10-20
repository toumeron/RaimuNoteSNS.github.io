import { afterEach, expect, it, vi } from 'vitest';
import { requestModelWithFailover, CLOUDFLARE_FALLBACK_MODEL } from "./../../supabase/functions/_shared/chatContext.ts";
const config = { token: 'test-cf-token', accountId: 'a'.repeat(32) };
const json = () => new Response(JSON.stringify({choices:[{message:{content:'返答'}}]}));
const stream = (text='返答') => new Response(`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\n\ndata: [DONE]\n\n`);
afterEach(() => vi.unstubAllGlobals());
it('uses Groq normally without calling Cloudflare', async () => {
  const fetcher = vi.fn().mockResolvedValue(json());vi.stubGlobal('fetch',fetcher);
  await requestModelWithFailover('groq-key',{model:'groq-model',messages:[]},config);
  expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0][0]).toContain('api.groq.com');
});
it('uses Qwen only after Groq errors, preserving messages and keeping server tokens separate', async () => {
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('',{status:429})).mockResolvedValueOnce(json());vi.stubGlobal('fetch',fetcher);
  const messages=[{role:'user',content:'こんにちは'}];
  await requestModelWithFailover('groq-key',{model:'groq-model',messages,reasoning_effort:'low',max_completion_tokens:120},config);
  expect(fetcher).toHaveBeenCalledTimes(2);const [url,request]=fetcher.mock.calls[1];
  expect(url).toContain(`/accounts/${config.accountId}/ai/v1/chat/completions`);expect(request.headers.Authorization).toBe('Bearer test-cf-token');
  const body=JSON.parse(request.body);expect(body).toMatchObject({model:CLOUDFLARE_FALLBACK_MODEL,messages,max_tokens:120});expect(body).not.toHaveProperty('reasoning_effort');expect(body).not.toHaveProperty('max_completion_tokens');
});
it('replaces a truncated Groq stream instead of mixing it with Cloudflare output', async () => {
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('data: {"choices":[{"delta":{"content":"途中"}}]}\n\n')).mockResolvedValueOnce(stream('復旧'));vi.stubGlobal('fetch',fetcher);
  const result=await requestModelWithFailover('groq-key',{stream:true,messages:[]},config);
  const text=await result.text();expect(text).toContain('復旧');expect(text).not.toContain('途中');
});
it('does not loop or expose secrets if both providers fail, and honors cancellation', async () => {
  const fetcher=vi.fn().mockResolvedValue(new Response('',{status:503}));vi.stubGlobal('fetch',fetcher);
  await expect(requestModelWithFailover('groq-key',{},config)).rejects.toThrow('503');expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockClear();const controller=new AbortController();controller.abort();
  fetcher.mockRejectedValue(new DOMException('Aborted','AbortError'));
  await expect(requestModelWithFailover('groq-key',{},config,controller.signal)).rejects.toHaveProperty('name','AbortError');expect(fetcher).toHaveBeenCalledOnce();
});

import { parseFriendResponse } from "./../../supabase/functions/_shared/chatContext.ts";
const visibleAnswer={acceptText:(text:string)=>!!parseFriendResponse(text).reply.trim()};
it('fails over a completed tag-only stream before delivering it to LimeAI',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(stream('<image-query>fixture noodles</image-query>')).mockResolvedValueOnce(stream('<image-query>noodles</image-query>料理についての返答です。'));vi.stubGlobal('fetch',fetcher);
 const result=await requestModelWithFailover('groq-key',{stream:true,messages:[]},config,undefined,visibleAnswer);
 const text=await result.text();expect(text).toContain('料理についての返答です。');expect(text).not.toContain('fixture noodles');expect(fetcher).toHaveBeenCalledTimes(2);
});
it('fails over tag-only JSON completions but keeps legitimate tool calls',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({choices:[{message:{content:'<reaction>👍</reaction><image-query>noodles</image-query>'}}]})).mockResolvedValueOnce(json());vi.stubGlobal('fetch',fetcher);
 expect((await (await requestModelWithFailover('groq-key',{messages:[]},config,undefined,visibleAnswer)).json()).choices[0].message.content).toBe('返答');expect(fetcher).toHaveBeenCalledTimes(2);
 fetcher.mockReset().mockResolvedValue(Response.json({choices:[{message:{content:null,tool_calls:[{id:'call',type:'function',function:{name:'search',arguments:'{}'}}]}}]}));
 await requestModelWithFailover('groq-key',{messages:[]},config,undefined,visibleAnswer);expect(fetcher).toHaveBeenCalledOnce();
});
it('rejects metadata-only replies when both providers have no visible answer',async()=>{
 const fetcher=vi.fn().mockImplementation(()=>Promise.resolve(stream('<image-query>noodles</image-query>')));vi.stubGlobal('fetch',fetcher);
 await expect(requestModelWithFailover('groq-key',{stream:true,messages:[]},config,undefined,visibleAnswer)).rejects.toThrow('no displayable answer');expect(fetcher).toHaveBeenCalledTimes(2);
});

it('delivers a visible LimeAI reply through the real frontend SSE parser after server failover',async()=>{
 const {streamChatWithFallback}=await import("@/lib/aiFriends");
 const fetcher=vi.fn().mockResolvedValueOnce(stream('<image-query>noodles</image-query>')).mockResolvedValueOnce(stream('<image-query>noodles</image-query>麺料理の説明です。'));vi.stubGlobal('fetch',fetcher);
 let received='';await streamChatWithFallback({model:'fast',retry:false,request:()=>requestModelWithFailover('groq-key',{stream:true,messages:[]},config,undefined,visibleAnswer),onEvent:event=>{received+=event.choices?.[0]?.delta?.content??'';}});
 expect(parseFriendResponse(received).reply).toBe('麺料理の説明です。');expect(fetcher).toHaveBeenCalledTimes(2);
});
