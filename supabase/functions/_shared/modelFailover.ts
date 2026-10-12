export const CLOUDFLARE_FALLBACK_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
export type CloudflareAIConfig = { token?: string; accountId?: string; model?: string };
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
/** Credentials stay on the server. Cloudflare is called only after a failed Groq response. */
export async function requestModelWithFailover(groqKey: string, input: Record<string, unknown>, cloudflare: CloudflareAIConfig, signal?: AbortSignal, validation: {acceptText?: (text:string)=>boolean} = {}): Promise<Response> {
  const run = async (url: string, token: string, body: Record<string, unknown>) => {
    const timeout = AbortSignal.timeout(45000);
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`AI provider HTTP ${response.status}`); }
    // Stage the response before publishing: a broken primary stream cannot mix with the fallback.
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024) throw new Error('AI response exceeded limit');
    if (body.stream) {
      let complete = false, answered = false, toolCall = false, answer='';
      for (const line of text.split('\n')) {
        if (!line.trim().startsWith('data:')) continue;
        const data = line.trim().slice(5).trim();
        if (data === '[DONE]') { complete = true; continue; }
        let event; try { event = JSON.parse(data); } catch { throw new Error('Invalid AI stream'); }
        if (event.error) throw new Error('AI stream error');
        for(const choice of event.choices??[]){if(typeof choice.delta?.content==='string')answer+=choice.delta.content;toolCall ||= Boolean(choice.delta?.tool_calls?.length);}
        answered ||= Boolean(event.choices?.some((choice: {delta?: {content?: string; tool_calls?: unknown[]}}) => choice.delta?.content || choice.delta?.tool_calls?.length));
      }
      if (!complete || !answered) throw new Error('Incomplete AI stream');
      if(validation.acceptText&&!toolCall&&!validation.acceptText(answer))throw new Error('AI response has no displayable answer');
    } else {
      const result = JSON.parse(text);
      if (result.error || !result.choices?.length) throw new Error('Invalid AI completion');
      if(validation.acceptText&&!result.choices.some((choice:any)=>choice.message?.tool_calls?.length||validation.acceptText!(typeof choice.message?.content==='string'?choice.message.content:'')))throw new Error('AI response has no displayable answer');
    }
    return new Response(text, { headers: { 'Content-Type': body.stream ? 'text/event-stream' : 'application/json' } });
  };
  try {
    return await run(GROQ_URL, groqKey, input);
  } catch (error) {
    signal?.throwIfAborted();
    if (!cloudflare.token || !cloudflare.accountId || !/^[a-f0-9]{32}$/i.test(cloudflare.accountId)) throw error;
    const body: Record<string, unknown> = { ...input, model: cloudflare.model || CLOUDFLARE_FALLBACK_MODEL };
    delete body.reasoning_effort;
    if (body.max_completion_tokens !== undefined) { body.max_tokens = body.max_completion_tokens; delete body.max_completion_tokens; }
    return await run(`https://api.cloudflare.com/client/v4/accounts/${cloudflare.accountId}/ai/v1/chat/completions`, cloudflare.token, body);
  }
}
