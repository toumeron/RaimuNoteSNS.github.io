import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));
import { supabase } from './supabase';
import { Speaker, splitForSpeech, synthesizeSpeech, CALM_FEMALE_VOICE_ID } from './aiSpeech';

const getSession = vi.mocked(supabase.auth.getSession);
const fetchMock = vi.fn();
const sources: Array<{ onended: (() => void) | null; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
beforeEach(() => {
  sources.length = 0;
  getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } }, error: null } as never);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } }));
  vi.stubGlobal('AudioContext', class {
    state = 'running'; currentTime = 0;
    resume = vi.fn().mockResolvedValue(undefined);
    decodeAudioData = vi.fn().mockResolvedValue({ duration: 2 });
    createBuffer = (_channels: number, length: number, rate: number) => ({ duration: length / rate, copyToChannel: vi.fn() });
    createGain = () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() });
    createBufferSource = () => {
      const source = { onended: null as (() => void) | null, buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(() => source.onended?.()) };
      sources.push(source); return source;
    };
  });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const opts = { lang: 'ja-JP', rate: 1, volume: 1 };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

describe('Fish AI speech', () => {
  it('keeps long Japanese text and emoji intact while respecting the request limit', () => {
    const text = 'こんにちは。'.repeat(150) + '🙂'.repeat(350) + '！';
    const chunks = splitForSpeech(text);
    expect(chunks.join('')).toBe(text);
    expect(chunks.every(chunk => chunk.length <= 600)).toBe(true);
    expect(chunks.every(chunk => !/[\uD800-\uDBFF]$/.test(chunk))).toBe(true);
  });
  it('sends the authenticated request with voice ID and rate', async () => {
    await synthesizeSpeech('こんにちは', { ...opts, rate: 1.2, voiceURI: 'a'.repeat(32) }, new AbortController().signal);
    const [, request] = fetchMock.mock.calls[0];
    expect(request.headers.Authorization).toBe('Bearer test-token');
    expect(JSON.parse(request.body)).toMatchObject({ text: 'こんにちは', rate: 1.2, referenceId: 'a'.repeat(32) });
  });
  it('explicitly selects the calm female voice even for a male character', async () => {
    await synthesizeSpeech('こんにちは', { ...opts, gender: 'male' }, new AbortController().signal);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).referenceId).toBe(CALM_FEMALE_VOICE_ID);
  });
  it('starts streaming PCM before the response finishes and preserves sample boundaries', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    fetchMock.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ start: controller => { stream = controller; } }), { headers: { 'Content-Type': 'audio/pcm' } }));
    const speaker = new Speaker();
    const hooks = { onChunkStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
    speaker.speak('こんにちは', opts, hooks);
    await flush();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).format).toBe('pcm');
    stream.enqueue(new Uint8Array(6001));
    await flush();
    expect(sources[0].start).toHaveBeenCalledOnce();
    expect(hooks.onChunkStart).toHaveBeenCalledOnce();
    expect(hooks.onEnd).not.toHaveBeenCalled();
    stream.enqueue(new Uint8Array(5999)); stream.close();
    await flush();
    expect(sources.length).toBe(2);
    sources.forEach(source => source.onended?.());
    await flush();
    expect(hooks.onEnd).toHaveBeenCalledOnce();
    expect(hooks.onError).not.toHaveBeenCalled();
  });
  it('cancels both scheduled PCM and an unfinished stream without resuming playback', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ start: controller => { stream = controller; }, cancel }), { headers: { 'Content-Type': 'audio/pcm' } }));
    const speaker = new Speaker();
    const hooks = { onEnd: vi.fn(), onError: vi.fn() };
    speaker.speak('こんにちは', opts, hooks);
    await flush(); stream.enqueue(new Uint8Array(6000)); await flush();
    speaker.cancel(); await flush();
    expect(cancel).toHaveBeenCalled();
    expect(sources[0].stop).toHaveBeenCalledOnce();
    expect(hooks.onEnd).not.toHaveBeenCalled();
    expect(hooks.onError).not.toHaveBeenCalled();
  });
  it('requires login before sending text to the voice service', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null } as never);
    await expect(synthesizeSpeech('こんにちは', opts, new AbortController().signal)).rejects.toThrow('ログイン');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('shows a server configuration error without reverting to browser voices', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'APIキーが未設定です' }), { status: 503 }));
    const hooks = { onError: vi.fn(), onEnd: vi.fn() };
    const speaker = new Speaker();
    speaker.speak('こんにちは', opts, hooks);
    await flush();
    expect(hooks.onError).toHaveBeenCalledWith('APIキーが未設定です');
    expect(hooks.onEnd).not.toHaveBeenCalled();
    expect(speaker.speaking).toBe(false);
  });
  it('starts avatar callbacks only when audio plays and finishes on audio end', async () => {
    const speaker = new Speaker();
    const hooks = { onChunkStart: vi.fn(), onEnd: vi.fn() };
    speaker.speak('こんにちは', opts, hooks);
    expect(hooks.onChunkStart).not.toHaveBeenCalled();
    await flush();
    expect(sources[0].start).toHaveBeenCalledOnce();
    expect(hooks.onChunkStart).toHaveBeenCalledWith('こんにちは', 0);
    expect(hooks.onEnd).not.toHaveBeenCalled();
    sources[0].onended?.();
    await flush();
    expect(hooks.onEnd).toHaveBeenCalledOnce();
    expect(speaker.speaking).toBe(false);
  });
  it('stops active audio without firing completion callbacks', async () => {
    const speaker = new Speaker();
    const hooks = { onEnd: vi.fn(), onError: vi.fn() };
    speaker.speak('こんにちは', opts, hooks);
    await flush();
    const source = sources[sources.length - 1]!;
    speaker.cancel();
    await flush();
    expect(source.stop).toHaveBeenCalledOnce();
    expect(hooks.onEnd).not.toHaveBeenCalled();
    expect(hooks.onError).not.toHaveBeenCalled();
  });
  it('ignores generated audio arriving after cancellation', async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>(r => { resolve = r; }));
    const speaker = new Speaker();
    const hooks = { onChunkStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
    speaker.speak('こんにちは', opts, hooks);
    await flush();
    const signal = fetchMock.mock.calls[0][1].signal;
    speaker.cancel();
    expect(signal.aborted).toBe(true);
    resolve(new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'audio/mpeg' } }));
    await flush();
    expect(hooks.onChunkStart).not.toHaveBeenCalled();
    expect(hooks.onEnd).not.toHaveBeenCalled();
  });
});
