import { expect, it, vi, describe, beforeEach } from "vitest";
import { streamChatWithFallback } from "@/lib/chatModelFallback";
import { findChatPostLink } from "@/lib/chatImageCache";
import { runGroupFriendTurn, type FriendCallUtterance, listAssistants, findAssistant, saveCustomAssistant, type AssistantDraft } from "@/lib/aiFriends";

describe("chatModelFallback", () => {
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
});

describe("chatPostLink", () => {
const id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
describe('chat post links',()=>{
 it('recognizes deployed and local LimeNote post links within text',()=>{
  for(const base of ['https://toumeron.github.io/RaimuNoteSNS.github.io','http://localhost:8080/RaimuNoteSNS.github.io','http://127.0.0.1:8080'])expect(findChatPostLink(`見てください ${base}/post/${id}。`)?.id).toBe(id);
 });
 it('ignores external hosts, profile URLs and malformed post IDs',()=>{
  for(const url of [`https://example.com/post/${id}`,`https://toumeron.github.io.evil.example/post/${id}`,'https://toumeron.github.io/RaimuNoteSNS.github.io/u/cat','https://toumeron.github.io/post/bad-id'])expect(findChatPostLink(url)).toBeNull();
 });
});
});

describe("groupFriendCall", () => {
it('waits for completed speech before the next friend thinks and shares that speech', async () => {
  const friends = listAssistants('test'); const history: FriendCallUtterance[] = [];
  let finish!: () => void;
  const ask = vi.fn().mockResolvedValueOnce('一緒に行こう').mockResolvedValueOnce('[LISTEN]');
  const speak = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const turn = runGroupFriendTurn({ participants: friends, history, userName: 'ユーザー', text: '明日遊ぼう', signal: new AbortController().signal, ask, speak });
  await vi.waitFor(() => expect(speak).toHaveBeenCalledOnce());
  expect(ask).toHaveBeenCalledOnce(); expect(history).toEqual([{ name: 'ユーザー', content: '明日遊ぼう' }]);
  finish(); await turn;
  expect(ask).toHaveBeenCalledTimes(2);
  expect(ask.mock.calls[1][1]).toContainEqual({ name: friends[0].name, content: '一緒に行こう' });
  expect(speak).toHaveBeenCalledOnce(); expect(history).toHaveLength(2);
});
it('does not speak stale responses or advance to another participant after an interruption', async () => {
  const controller = new AbortController(); const history: FriendCallUtterance[] = [];
  const ask = vi.fn(async () => { controller.abort(); return '返答'; }); const speak = vi.fn();
  await runGroupFriendTurn({ participants: listAssistants('test'), history, userName: 'ユーザー', text: '質問', signal: controller.signal, ask, speak });
  expect(ask).toHaveBeenCalledOnce(); expect(speak).not.toHaveBeenCalled(); expect(history).toHaveLength(1);
});
it('stops the remaining queue if voice playback fails', async () => {
  const ask = vi.fn().mockResolvedValue('返答'); const speak = vi.fn().mockRejectedValue(Error('音声エラー')); const history: FriendCallUtterance[] = [];
  await expect(runGroupFriendTurn({ participants: listAssistants('test'), history, userName: 'ユーザー', text: '質問', signal: new AbortController().signal, ask, speak })).rejects.toThrow('音声エラー');
  expect(ask).toHaveBeenCalledOnce(); expect(history).toHaveLength(1);
});
});

describe("aiFriends", () => {
beforeEach(()=>localStorage.clear());
it('edits a built-in friend in the existing store without duplicating its ID or losing history identity',()=>{
 const friend=findAssistant('owner','builtin:km170')!;const draft={...friend,name:'更新した名前',description:'更新した紹介',systemPrompt:'更新した設定',gender:'female'} as AssistantDraft;
 saveCustomAssistant('owner',draft);
 const list=listAssistants('owner');expect(list.filter(item=>item.id===friend.id)).toHaveLength(1);expect(findAssistant('owner',friend.id)).toMatchObject({name:draft.name,description:draft.description,systemPrompt:draft.systemPrompt,slug:friend.slug});
 expect(findAssistant('another',friend.id)?.name).toBe(friend.name);
 saveCustomAssistant('owner',{...draft,name:'再編集'});expect(findAssistant('owner',friend.id)?.name).toBe('再編集');expect(listAssistants('owner').filter(item=>item.id===friend.id)).toHaveLength(1);
});
it('still saves edits to custom friends',()=>{const [friend]=saveCustomAssistant('owner',{name:'友達',description:'',systemPrompt:'設定',starter:'',greeting:'',gender:'female'});saveCustomAssistant('owner',{...friend,name:'新しい名前',gender:'female'});expect(findAssistant('owner',friend.id)?.name).toBe('新しい名前');});
it('reports storage failures instead of pretending an edit was saved',()=>{const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota')});try{expect(()=>saveCustomAssistant('owner',{...findAssistant('owner','builtin:km170')!,name:'新名',gender:'female'})).toThrow('quota');}finally{storage.mockRestore();}});
});
