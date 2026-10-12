import { notifySuspendedAction } from './accountSuspension';
export type ChatModel = 'fast' | 'advanced';
type Event = Record<string, any>;
class ChatRequestError extends Error {
  constructor(message: string, readonly retryable = true) { super(message); }
}
/** Buffer friend replies so a failed partial reply is never delivered or duplicated. */
export async function streamChatWithFallback({ model, retry, signal, request, onEvent }: {
  model: ChatModel; retry: boolean; signal?: AbortSignal;
  request: (model: ChatModel) => Promise<Response>; onEvent: (event: Event) => void;
}) {
  // Provider failover is server-owned; never restart this conversation on another Groq model.
  const models: ChatModel[] = [model];
  for (let attempt = 0; attempt < models.length; attempt++) {
    const events: Event[] = [];
    let action = false;
    try {
      signal?.throwIfAborted();
      const response = await request(models[attempt]);
      if (!response.ok && response.status === 403) {
        const body = await response.clone().json().catch(() => null);
        if (body?.code === 'ACCOUNT_SUSPENDED') {notifySuspendedAction();throw new ChatRequestError(body.error, false);}
      }
      if (!response.ok) throw new ChatRequestError(`会話を取得できませんでした (${response.status})`, response.status === 429 || response.status >= 500);
      if (!response.body) throw new ChatRequestError('会話の応答が空でした');
      const reader = response.body.getReader(); const decoder = new TextDecoder();
      let buffer = '', doneMarker = false;
      const consume = (line: string) => {
        if (!line.trim().startsWith('data:')) return;
        const data = line.trim().slice(5).trim();
        if (data === '[DONE]') { doneMarker = true; return; }
        let event: Event; try { event = JSON.parse(data); } catch { return; }
        action ||= event.type === 'agent_action_request' || event.type === 'agent_action_result';
        if (retry && event.type === 'edge_error') throw new ChatRequestError(event.publicMessage || '会話モデルでエラーが発生しました');
        if (retry) events.push(event); else onEvent(event);
      };
      const cancel = () => { void reader.cancel().catch(() => {}); };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        while (true) {
          signal?.throwIfAborted();
          const { value, done } = await reader.read();
          signal?.throwIfAborted();
          if (done) { buffer += decoder.decode(); if (buffer.trim()) consume(buffer); break; }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n'); buffer = lines.pop() || '';
          for (const line of lines) consume(line);
        }
      } finally { signal?.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (retry) {
        const text = events.map(event => event.choices?.[0]?.delta?.content || '').join('').trim();
        // The current server's fatal-error handler also emits this as ordinary text.
        if (!doneMarker || !text || text === '一時的なエラーが発生しました。もう一度お試しください。') throw new ChatRequestError('会話モデルの応答が完了しませんでした');
      }
    } catch (error) {
      if (signal?.aborted || (error as Error).name === 'AbortError' || action || attempt === models.length - 1 || error instanceof ChatRequestError && !error.retryable) throw error;
      continue;
    }
    // Application callbacks are outside the retry block; side effects are not retried.
    if (retry) for (const event of events) onEvent(event);
    return;
  }
}
