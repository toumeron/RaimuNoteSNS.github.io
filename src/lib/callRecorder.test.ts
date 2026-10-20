import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallRecorder, microphoneErrorMessage, requestMicrophonePermission, callAudioFilename, preferRecordedCallSpeech, requestCallTranscription } from "@/lib/callRecorder";
import { streamChatWithFallback } from "@/lib/aiFriends";
import { findChatPostLink } from "@/lib/aiFriends";
import { runGroupFriendTurn, type FriendCallUtterance, listAssistants, findAssistant, saveCustomAssistant, type AssistantDraft } from "@/lib/aiFriends";

describe("callRecorder", () => {
describe("callRecorder", () => {
let amplitude = 0;
let stopTrack: ReturnType<typeof vi.fn>;
let closeContext: ReturnType<typeof vi.fn>;
let recordedType = 'audio/webm';
let chunkType = 'audio/webm';
class Recorder {
  static isTypeSupported = () => true;
  mimeType = recordedType;
  state = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio'], { type: chunkType }) });
    void this.onstop?.();
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  amplitude = 0;
  recordedType = chunkType = 'audio/webm';
  stopTrack = vi.fn();
  closeContext = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) } });
  vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('AudioContext', class {
    resume = vi.fn().mockResolvedValue(undefined);
    close = closeContext;
    createMediaStreamSource = () => ({ connect: vi.fn() });
    createAnalyser = () => ({ fftSize: 2048, getFloatTimeDomainData: (samples: Float32Array) => samples.fill(amplitude) });
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const handlers = () => ({ onFinal: vi.fn(), onEnd: vi.fn(), onError: vi.fn() });
describe('recorded call speech', () => {
  it('uses the Safari chunk MIME type when recorder.mimeType is empty', async () => {
    recordedType = '';
    chunkType = 'audio/mp4';
    const transcribe = vi.fn().mockResolvedValue('iOSの音声');
    const listener = new CallRecorder(transcribe);
    const h = handlers();
    listener.start('ja-JP', h);
    await vi.advanceTimersByTimeAsync(0);
    amplitude = 0.1;
    await vi.advanceTimersByTimeAsync(500);
    amplitude = 0;
    await vi.advanceTimersByTimeAsync(1100);
    expect(transcribe.mock.calls[0][0].type).toBe('audio/mp4');
    expect(h.onFinal).toHaveBeenCalledWith('iOSの音声');
    expect(h.onError).not.toHaveBeenCalled();
    listener.abort();
  });
  it('transcribes a spoken turn after a pause and releases audio resources', async () => {
    const transcribe = vi.fn().mockResolvedValue('こんにちは');
    const listener = new CallRecorder(transcribe);
    const h = handlers();
    listener.start('ja-JP', h);
    await vi.advanceTimersByTimeAsync(0);
    amplitude = 0.1;
    await vi.advanceTimersByTimeAsync(500);
    amplitude = 0;
    await vi.advanceTimersByTimeAsync(1100);
    expect(transcribe).toHaveBeenCalledOnce();
    expect(transcribe.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(h.onFinal).toHaveBeenCalledWith('こんにちは');
    expect(stopTrack).toHaveBeenCalled();
    expect(closeContext).toHaveBeenCalledOnce();
    listener.abort();
  });
  it('retries silence without sending ambient audio for transcription', async () => {
    const transcribe = vi.fn();
    const listener = new CallRecorder(transcribe);
    const h = handlers();
    listener.start('ja-JP', h);
    await vi.advanceTimersByTimeAsync(20100);
    expect(transcribe).not.toHaveBeenCalled();
    expect(h.onEnd).toHaveBeenCalledOnce();
    listener.abort();
  });
  it('cancels pending transcription when muted or ended', async () => {
    let finish!: (text: string) => void;
    const transcribe = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const listener = new CallRecorder(transcribe);
    const h = handlers();
    listener.start('ja-JP', h);
    await vi.advanceTimersByTimeAsync(0);
    amplitude = 0.1;
    await vi.advanceTimersByTimeAsync(500);
    amplitude = 0;
    await vi.advanceTimersByTimeAsync(1100);
    listener.abort();
    expect(transcribe.mock.calls[0][2].aborted).toBe(true);
    finish('late reply');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.onFinal).not.toHaveBeenCalled();
    expect(h.onEnd).not.toHaveBeenCalled();
  });
  it('releases a stream granted after the call was already ended', async () => {
    let grant!: (stream: unknown) => void;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(new Promise(resolve => { grant = resolve; }));
    const listener = new CallRecorder(vi.fn());
    const h = handlers();
    listener.start('ja-JP', h);
    listener.abort();
    grant({ getTracks: () => [{ stop: stopTrack }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(h.onFinal).not.toHaveBeenCalled();
  });
});
});

describe("microphone", () => {
afterEach(() => vi.unstubAllGlobals());
describe('microphone permission', () => {
  it('requests audio and releases the permission-check stream', async () => {
    vi.stubGlobal('isSecureContext', true);
    const stop = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    await requestMicrophonePermission();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stop).toHaveBeenCalledOnce();
  });
  it('explains permission denial to installed PWA users', async () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')) } });
    await expect(requestMicrophonePermission()).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(microphoneErrorMessage(new DOMException('Denied', 'NotAllowedError'))).toContain('PWA');
  });
  it('reports HTTPS requirement without requesting permission', async () => {
    vi.stubGlobal('isSecureContext', false);
    await expect(requestMicrophonePermission()).rejects.toThrow('HTTPS');
  });
});
});

describe("callTranscription", () => {
afterEach(() => vi.unstubAllGlobals());
describe('iOS installed call recognition', () => {
  it.each([
    ['iPhone', 'iPhone', 5, true, false, true],
    ['iPad', 'iPad', 5, false, true, true],
    ['Mozilla Macintosh', 'MacIntel', 5, true, false, true],
    ['iPhone', 'iPhone', 5, false, false, false],
    ['Android', 'Linux', 5, true, true, false],
    ['Macintosh', 'MacIntel', 0, true, false, false],
  ])('selects recording for %s / %s / standalone %s', (userAgent, platform, maxTouchPoints, standalone, displayMode, expected) => {
    vi.stubGlobal('navigator', { userAgent, platform, maxTouchPoints, standalone });
    vi.stubGlobal('matchMedia', () => ({ matches: displayMode }));
    expect(preferRecordedCallSpeech()).toBe(expected);
  });
  it.each([
    ['audio/mp4;codecs=mp4a.40.2', 'call.m4a'], ['audio/x-m4a', 'call.m4a'],
    ['audio/webm;codecs=opus', 'call.webm'], ['audio/wav', 'call.wav'], ['audio/ogg', 'call.ogg'],
  ])('matches %s to its filename', (type, filename) => expect(callAudioFilename(type)).toBe(filename));
});

describe('authenticated call transcription', () => {
  const request = () => ({ url: 'https://example.test/transcribe-call', apiKey: 'test-key', accessToken: 'test-session',
    audio: new Blob(['audio'], { type: 'audio/mp4' }), lang: 'ja-JP', signal: new AbortController().signal });
  it('uploads a Safari recording with m4a filename, language and auth; returns text', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: 'こんにちは' }) });
    const input = request();
    await expect(requestCallTranscription(input, fetcher)).resolves.toBe('こんにちは');
    const options = fetcher.mock.calls[0][1];
    expect(options.headers.Authorization).toBe('Bearer test-session');
    expect(options.signal).toBe(input.signal);
    expect(options.body.get('audio').name).toBe('call.m4a');
    expect(options.body.get('language')).toBe('ja');
  });
  it.each([[404, '管理者'], [401, 'ログイン'], [502, '502']])('explains HTTP %s even for a non-JSON response', async (status, message) => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status, json: async () => { throw new Error('HTML'); } });
    await expect(requestCallTranscription(request(), fetcher)).rejects.toThrow(message);
  });
  it('retains actionable server errors and rejects malformed successful responses', async () => {
    await expect(requestCallTranscription(request(), vi.fn().mockResolvedValue({ ok: false, status: 503,
      json: async () => ({ error: 'サーバー設定が完了していません。' }) }))).rejects.toThrow('サーバー設定');
    await expect(requestCallTranscription(request(), vi.fn().mockResolvedValue({ ok: true,
      json: async () => ({ message: 'wrong response' }) }))).rejects.toThrow('正しい応答');
  });
  it('does not upload empty recordings', async () => {
    const fetcher = vi.fn();
    await expect(requestCallTranscription({ ...request(), audio: new Blob([]) }, fetcher)).rejects.toThrow('空');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('normalizes Safari m4a MIME aliases to the server-supported mp4 MIME type', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: '音声' }) });
    await requestCallTranscription({ ...request(), audio: new Blob(['audio'], { type: 'audio/x-m4a' }) }, fetcher);
    expect(fetcher.mock.calls[0][1].body.get('audio').type).toBe('audio/mp4');
    expect(fetcher.mock.calls[0][1].body.get('audio').name).toBe('call.m4a');
  });
});
});
});

describe("chatModelFallback", () => {
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
});
