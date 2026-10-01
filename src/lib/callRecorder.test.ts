import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallRecorder } from './callRecorder';

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
