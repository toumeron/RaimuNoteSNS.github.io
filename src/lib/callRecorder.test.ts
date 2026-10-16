import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallRecorder } from "@/lib/callRecorder";
import { microphoneErrorMessage, requestMicrophonePermission } from "@/lib/microphone";
import { callAudioFilename, preferRecordedCallSpeech, requestCallTranscription } from "@/lib/callTranscription";

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
