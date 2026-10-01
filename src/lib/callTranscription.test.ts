import { afterEach, describe, expect, it, vi } from 'vitest';
import { callAudioFilename, preferRecordedCallSpeech, requestCallTranscription } from './callTranscription';

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
