import { expect, it, vi } from 'vitest';
import { streamChatWithFallback } from './chatModelFallback';
const event = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
const answer = (content = '返答') => new Response(event(content) + 'data: [DONE]\n\n');
it('delivers the successful server response without changing the Groq model on the client', async () => {
  const request = vi.fn().mockResolvedValue(answer()); const onEvent = vi.fn();
  await streamChatWithFallback({ model: 'fast', retry: true, request, onEvent });
  expect(request).toHaveBeenCalledOnce(); expect(request).toHaveBeenCalledWith('fast'); expect(onEvent).toHaveBeenCalledOnce();
});
it('discards partial replies and lets the server own provider failover', async () => {
  const request = vi.fn().mockResolvedValue(new Response(event('途中の返答')+'data: {"type":"edge_error","publicMessage":"エラー"}\n\n'));
  const onEvent = vi.fn(); await expect(streamChatWithFallback({model:'advanced',retry:true,request,onEvent})).rejects.toThrow('エラー');
  expect(request).toHaveBeenCalledOnce();expect(onEvent).not.toHaveBeenCalled();
});
it('rejects incomplete responses and server error text', async () => {
  for(const response of [new Response(event('途中')),answer('一時的なエラーが発生しました。もう一度お試しください。')]) {
    const request=vi.fn().mockResolvedValue(response);
    await expect(streamChatWithFallback({model:'fast',retry:true,request,onEvent:vi.fn()})).rejects.toThrow();expect(request).toHaveBeenCalledOnce();
  }
});
it('does not retry authorization failures, cancellations, or requests with server actions', async () => {
  const forbidden = vi.fn().mockResolvedValue(new Response('', { status: 403 }));
  await expect(streamChatWithFallback({ model: 'fast', retry: true, request: forbidden, onEvent: vi.fn() })).rejects.toThrow('403'); expect(forbidden).toHaveBeenCalledOnce();
  const controller = new AbortController(); controller.abort(); const cancelled = vi.fn();
  await expect(streamChatWithFallback({ model: 'fast', retry: true, signal: controller.signal, request: cancelled, onEvent: vi.fn() })).rejects.toHaveProperty('name','AbortError'); expect(cancelled).not.toHaveBeenCalled();
  const action = vi.fn().mockResolvedValue(new Response('data: {"type":"agent_action_request"}\n\ndata: {"type":"edge_error"}\n\n'));
  await expect(streamChatWithFallback({ model: 'fast', retry: true, request: action, onEvent: vi.fn() })).rejects.toThrow(); expect(action).toHaveBeenCalledOnce();
});
it('does not issue a duplicate request after a server failure without delivering an error as a friend message', async () => {
  const request = vi.fn().mockRejectedValue(Error('offline')); const onEvent = vi.fn();
  await expect(streamChatWithFallback({ model: 'fast', retry: true, request, onEvent })).rejects.toThrow('offline'); expect(request).toHaveBeenCalledOnce(); expect(onEvent).not.toHaveBeenCalled();
});
