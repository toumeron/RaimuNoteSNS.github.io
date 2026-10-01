import { supabase } from './supabase';
import { CALM_FEMALE_VOICE_ID, PCM_SAMPLE_RATE } from '../../supabase/functions/_shared/aiVoice';
export { CALM_FEMALE_VOICE_ID, CALM_FEMALE_VOICE_NAME } from '../../supabase/functions/_shared/aiVoice';

export type VoiceOpts = {
  voiceURI?: string;
  gender?: 'female' | 'male';
  lang: string;
  rate: number;
  volume: number;
};
export type SpeakHooks = {
  onChunkStart?: (chunk: string, offset: number) => void;
  onBoundary?: (charIndex: number) => void;
  onChunkEnd?: () => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
};
let context: AudioContext | undefined;
export function ttsSupported() {
  return typeof window !== 'undefined' && !!(window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
}
function audioContext() {
  if (!ttsSupported()) throw new Error('このブラウザではAI音声を再生できません。');
  const Constructor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!context || context.state === 'closed') context = new Constructor();
  return context;
}
/** Call in the original click handler so Safari can authorize later AI replies. */
export function unlockAiAudio() {
  try { void audioContext().resume().catch(() => {}); } catch { /* reported on playback */ }
}

export function splitForSpeech(text: string, max = 600): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const sentence of text.match(/[^。！？!?\n]+[。！？!?\n]*|[。！？!?\n]+/g) || []) {
    if ((current + sentence).length > max && current) { chunks.push(current); current = ''; }
    // Iterate code points to avoid splitting emoji/surrogate pairs.
    for (const char of sentence) {
      if ((current + char).length > max) { chunks.push(current); current = ''; }
      current += char;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

export async function synthesizeSpeech(text: string, opts: VoiceOpts, signal: AbortSignal, onPcm?: (samples: Float32Array) => void): Promise<ArrayBuffer> {
  const { data: { session } } = await supabase.auth.getSession();
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!session) throw new Error('AI音声を使うにはログインしてください。');
  const requestController = new AbortController();
  const abortRequest = () => requestController.abort();
  signal.addEventListener('abort', abortRequest, { once: true });
  const timeout = setTimeout(() => requestController.abort(), 75000);
  try {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/synthesize-speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, rate: opts.rate, referenceId: opts.voiceURI || CALM_FEMALE_VOICE_ID, format: onPcm ? 'pcm' : 'mp3' }),
      signal: requestController.signal,
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || 'AI音声を生成できませんでした。サーバーの音声設定を確認してください。');
    }
    if (!response.headers.get('content-type')?.startsWith('audio/')) throw new Error('AI音声の応答形式が正しくありません。');
    if (onPcm && response.headers.get('content-type')?.startsWith('audio/pcm')) {
      if (!response.body) throw new Error('AI音声データが空でした。');
      const reader = response.body.getReader();
      const cancelReader = () => { void reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', cancelReader, { once: true });
      let carry = new Uint8Array(0);
      let received = 0;
      const emit = (bytes: Uint8Array) => {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const samples = new Float32Array(bytes.length / 2);
        for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
        received += samples.length;
        onPcm(samples);
      };
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          if (done) break;
          const bytes = new Uint8Array(carry.length + value.length);
          bytes.set(carry); bytes.set(value, carry.length);
          const aligned = bytes.length - bytes.length % 2;
          // Keep tiny transport packets together (120 ms of 24 kHz mono PCM).
          if (aligned >= PCM_SAMPLE_RATE * 0.12 * 2) { emit(bytes.subarray(0, aligned)); carry = bytes.slice(aligned); }
          else carry = bytes;
        }
        if (carry.length % 2) throw new Error('AI音声データが途中で途切れました。');
        if (carry.length) emit(carry);
        if (!received) throw new Error('AI音声データが空でした。');
      } finally { signal.removeEventListener('abort', cancelReader); await reader.cancel().catch(() => {}); reader.releaseLock(); }
      return new ArrayBuffer(0);
    }
    const audio = await response.arrayBuffer();
    if (!audio.byteLength) throw new Error('AI音声データが空でした。再試行してください。');
    return audio;
  } catch (error) {
    if (requestController.signal.aborted && !signal.aborted) throw new Error('AI音声の生成に時間がかかっています。もう一度お試しください。');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abortRequest);
  }
}

export class Speaker {
  private token = 0;
  private controller?: AbortController;
  private sources = new Set<AudioBufferSourceNode>();
  private gain?: GainNode;
  private frame = 0;
  private _speaking = false;
  get speaking() { return this._speaking; }

  speak(text: string, opts: VoiceOpts, hooks: SpeakHooks = {}) {
    this.cancel();
    unlockAiAudio();
    const token = this.token;
    const controller = new AbortController();
    this.controller = controller;
    this._speaking = true;
    void this.run(text, opts, hooks, token, controller.signal).catch((error: unknown) => {
      if (token !== this.token) return;
      this.cancel();
      hooks.onError?.(error instanceof Error ? error.message : 'AI音声を再生できませんでした。');
    });
  }

  private async run(text: string, opts: VoiceOpts, hooks: SpeakHooks, token: number, signal: AbortSignal) {
    const ctx = audioContext();
    await ctx.resume();
    if (token !== this.token) return;
    if (ctx.state !== 'running') throw new Error('音声の再生がブロックされました。再生ボタンをもう一度押してください。');
    const gain = ctx.createGain();
    this.gain = gain;
    gain.gain.value = Math.max(0, Math.min(1, opts.volume));
    gain.connect(ctx.destination);
    try {
      let offset = 0;
      for (const chunk of splitForSpeech(text)) {
        let nextStart = ctx.currentTime + 0.04;
        let startedAt = 0;
        let duration = 0;
        let complete = false;
        let started = false;
        const endings: Promise<void>[] = [];
        const tick = () => {
          if (token !== this.token) return;
          const elapsed = Math.max(0, ctx.currentTime - startedAt);
          const progress = complete && duration > 0 ? elapsed / duration * chunk.length : elapsed * 7.2 * opts.rate;
          hooks.onBoundary?.(offset + Math.min(chunk.length, progress));
          this.frame = requestAnimationFrame(tick);
        };
        const schedule = (buffer: AudioBuffer) => {
          if (token !== this.token) return;
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(gain);
          this.sources.add(source);
          const when = Math.max(ctx.currentTime + 0.025, nextStart);
          nextStart = when + buffer.duration;
          if (!started) startedAt = when;
          duration = nextStart - startedAt;
          endings.push(new Promise<void>(resolve => {
            source.onended = () => { this.sources.delete(source); source.disconnect(); resolve(); };
          }));
          source.start(when);
          if (!started) {
            started = true;
            hooks.onChunkStart?.(chunk, offset);
            tick();
          }
        };
        const data = await synthesizeSpeech(chunk, opts, signal, samples => {
          if (token !== this.token) return;
          const buffer = ctx.createBuffer(1, samples.length, PCM_SAMPLE_RATE);
          buffer.copyToChannel(new Float32Array(samples), 0);
          schedule(buffer);
        });
        if (token !== this.token) return;
        // Older deployed functions and browsers/tests may still return MP3/WAV.
        if (data.byteLength) {
          const buffer = await ctx.decodeAudioData(data);
          if (token !== this.token) return;
          schedule(buffer);
        }
        complete = true;
        await Promise.all(endings);
        if (token !== this.token) return;
        cancelAnimationFrame(this.frame);
        hooks.onChunkEnd?.();
        offset += chunk.length;
      }
      if (token !== this.token) return;
      this._speaking = false;
      this.controller = undefined;
      hooks.onEnd?.();
    } finally {
      gain.disconnect();
      if (this.gain === gain) this.gain = undefined;
    }
  }

  cancel() {
    this.token++;
    this._speaking = false;
    this.controller?.abort(); this.controller = undefined;
    cancelAnimationFrame(this.frame);
    for (const source of this.sources) {
      try { source.stop(); } catch { /* already ended */ }
      source.disconnect();
    }
    this.sources.clear();
    this.gain?.disconnect(); this.gain = undefined;
  }
}
