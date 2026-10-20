import { supabase } from "@/lib/supabase";
import { PCM_SAMPLE_RATE, resolveVoiceId } from "./../../supabase/functions/_shared/chatContext.ts";
import { type IRemoteAudioTrack } from "agora-rtc-sdk-ng";
import { createSpaceMusic } from "@/lib/spaceMusic";

// callRecorder
// callRecorder
// microphone
/** Request recording permission from the call button's user gesture. */
async function requestMicrophonePermission(): Promise<void> {
  if (!window.isSecureContext) throw new Error('マイクを使うにはHTTPSでページを開いてください。');
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('この環境ではマイクを利用できません。端末のブラウザで開き直してください。');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  // SpeechRecognition captures its own audio. Do not keep a second microphone open.
  stream.getTracks().forEach(track => track.stop());
}

function microphoneErrorMessage(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'マイクの使用が許可されていません。端末の設定でこのPWAまたはブラウザのマイク許可を確認し、必要に応じてブラウザで同じサイトを開いて許可した後、もう一度発信してください。';
  }
  if (name === 'NotFoundError') return 'マイクが見つかりません。端末のマイクや接続を確認してください。';
  if (name === 'NotReadableError') return 'マイクを使用できません。他のアプリの録音や通話を終了してから再試行してください。';
  return error instanceof Error ? error.message : 'マイクの許可を確認できませんでした。もう一度お試しください。';
}

// callRecorder
type Handlers = {
  onFinal: (text: string) => void;
  onEnd: () => void;
  onError: (message: string) => void;
};

/** SpeechRecognition is unavailable in some installed PWAs. Record one turn,
 * detect a pause, and transcribe it using the authenticated server endpoint. */
class CallRecorder {
  private cancel: (() => void) | null = null;
  constructor(private transcribe: (audio: Blob, lang: string, signal: AbortSignal) => Promise<string>) {}

  start(lang: string, handlers: Handlers) {
    this.abort();
    const controller = new AbortController();
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let recorder: MediaRecorder | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    const release = () => {
      if (timer) clearInterval(timer);
      timer = null;
      stream?.getTracks().forEach(track => track.stop());
      context?.close().catch(() => {});
      context = null;
    };
    this.cancel = () => {
      cancelled = true;
      controller.abort();
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        recorder.stop();
      }
      release();
    };
    const run = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (cancelled) { release(); return; }
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        context = new Ctx();
        await context.resume();
        if (cancelled) { release(); return; }
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        context.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        const chunks: Blob[] = [];
        let voicedMs = 0;
        let lastVoice = Date.now();
        const started = Date.now();
        let previous = started;
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        recorder.onerror = () => {
          if (cancelled) return;
          this.abort();
          handlers.onError('マイクの録音に失敗しました。「マイクをオン」で再試行してください。');
        };
        recorder.onstop = async () => {
          release();
          if (cancelled) return;
          if (voicedMs < 250) { handlers.onEnd(); return; }
          try {
            // Some Safari versions leave recorder.mimeType empty, while chunks carry it.
            const type = recorder!.mimeType || chunks.find(chunk => chunk.type)?.type || mimeType || 'audio/mp4';
            const audio = new Blob(chunks, { type });
            if (!audio.size) throw new Error('録音データを取得できませんでした。マイクをオンにして再試行してください。');
            const text = await this.transcribe(audio, lang, controller.signal);
            if (cancelled) return;
            if (text.trim()) handlers.onFinal(text.trim());
            else handlers.onEnd();
          } catch (error) {
            if (!cancelled) handlers.onError(microphoneErrorMessage(error));
          }
        };
        recorder.start();
        timer = setInterval(() => {
          if (!analyser || recorder?.state !== 'recording') return;
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
          const now = Date.now();
          if (rms > 0.015) { voicedMs += Math.min(now - previous, 100); lastVoice = now; }
          previous = now;
          if ((voicedMs >= 250 && now - lastVoice > 1000) || now - started > 20000) {
            if (timer) clearInterval(timer);
            timer = null;
            recorder.stop();
          }
        }, 50);
      } catch (error) {
        release();
        if (!cancelled) handlers.onError(microphoneErrorMessage(error));
      }
    };
    void run();
  }
  abort() { this.cancel?.(); this.cancel = null; }
}

// callTranscription
/** Safari exposes SpeechRecognition even in installed apps where it cannot start reliably. */
function preferRecordedCallSpeech(): boolean {
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
    || window.matchMedia?.('(display-mode: standalone)').matches === true;
  return ios && standalone;
}

function callAudioFilename(type: string): string {
  if (/mp4|m4a/i.test(type)) return 'call.m4a';
  if (/wav/i.test(type)) return 'call.wav';
  if (/ogg/i.test(type)) return 'call.ogg';
  return 'call.webm';
}

type TranscriptionRequest = {
  url: string;
  apiKey: string;
  accessToken: string;
  audio: Blob;
  lang: string;
  signal: AbortSignal;
};

async function requestCallTranscription(request: TranscriptionRequest, fetcher = fetch): Promise<string> {
  if (!request.audio.size) throw new Error('録音データが空です。マイクをオンにしてもう一度話してください。');
  const audio = /^audio\/(?:x-)?m4a(?:;|$)/i.test(request.audio.type)
    ? new Blob([request.audio], { type: 'audio/mp4' }) : request.audio;
  const form = new FormData();
  form.append('audio', audio, callAudioFilename(audio.type));
  form.append('language', request.lang.split('-')[0]);
  const response = await fetcher(request.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${request.accessToken}`, apikey: request.apiKey },
    body: form,
    signal: request.signal,
  });
  const result: unknown = await response.json().catch(() => null);
  const data = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  if (!response.ok) {
    if (response.status === 404) throw new Error('通話の音声認識サーバーが見つかりません。管理者による設定が必要です。');
    if (response.status === 401 || response.status === 403) throw new Error('ログインの有効期限が切れています。ログインし直してから発信してください。');
    if (typeof data.error === 'string') throw new Error(data.error);
    if (response.status === 429) throw new Error('音声認識が混み合っています。少し待って再試行してください。');
    throw new Error(`音声認識サーバーとの通信に失敗しました（${response.status}）。もう一度お試しください。`);
  }
  if (typeof data.text !== 'string') throw new Error('音声認識サーバーから正しい応答を受け取れませんでした。');
  return data.text;
}

// audioPlayback
let context:AudioContext|undefined;
/** Use one output session for friend speech, ringing and call waiting. */
function configureAudioPlayback() {
  try {
    const session=(navigator as Navigator & {audioSession?:{type:string}}).audioSession;
    if(session&&session.type!=='playback')session.type='playback';
  } catch { /* Older Safari does not implement Audio Session. */ }
}
function getAudioPlaybackContext():AudioContext {
  configureAudioPlayback();
  const Constructor=window.AudioContext||(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
  if(!Constructor)throw new Error('このブラウザではAI音声を再生できません。');
  if(!context||context.state==='closed')context=new Constructor();
  return context;
}
/** Must run synchronously from a tap, before microphone/network awaits. */
function unlockAudioPlayback() {
  try {
    const ctx=getAudioPlaybackContext();
    if(ctx.state!=='running'&&typeof ctx.createBuffer==='function'){
      const source=ctx.createBufferSource();source.buffer=ctx.createBuffer(1,1,ctx.sampleRate||44100);
      source.connect(ctx.destination);source.onended=()=>source.disconnect();source.start(0);
    }
    void ctx.resume().catch(()=>{});
  } catch { /* Playback will report errors through the existing call UI. */ }
}

// aiSpeech
export { CALM_FEMALE_VOICE_ID, CALM_FEMALE_VOICE_NAME } from "./../../supabase/functions/_shared/chatContext.ts";

type VoiceOpts = {
  voiceURI?: string;
  gender?: 'female' | 'male';
  lang: string;
  rate: number;
  volume: number;
};
type SpeakHooks = {
  onChunkStart?: (chunk: string, offset: number) => void;
  onBoundary?: (charIndex: number) => void;
  onChunkEnd?: () => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
};
function ttsSupported() {
  return typeof window !== 'undefined' && !!(window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
}
function audioContext() {
  return getAudioPlaybackContext();
}
/** Call in the original click handler so Safari can authorize later AI replies. */
function unlockAiAudio() {
  unlockAudioPlayback();
}

function splitForSpeech(text: string, max = 600): string[] {
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

async function synthesizeSpeech(text: string, opts: VoiceOpts, signal: AbortSignal, onPcm?: (samples: Float32Array) => void): Promise<ArrayBuffer> {
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
      body: JSON.stringify({ text, rate: opts.rate, referenceId: resolveVoiceId(opts), format: onPcm ? 'pcm' : 'mp3' }),
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

class Speaker {
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

// spacePlayback
// spacePlayback
type AudioNavigator = Navigator & { audioSession?: { type: string } };
/** Native audio sinks and system controls survive minimization and route changes. */
class SpacePlayback {
  private players = new Map<string, HTMLAudioElement>();
  private paused = false;
  private closed = false;
  private metadata?: MediaMetadata;
  private previousType = (navigator as AudioNavigator).audioSession?.type;
  private assignedType?: string;
  constructor(private onBlocked: () => void, private pauseWaiting: () => void, private resumeWaiting: () => void) {}
  setCapturing(capturing: boolean) {
    const audioSession = (navigator as AudioNavigator).audioSession;
    if (!audioSession) return;
    try { this.assignedType = capturing ? 'play-and-record' : 'playback'; audioSession.type = this.assignedType; } catch { /* Unsupported browser. */ }
  }
  describe(title: string, host: string) {
    if (!navigator.mediaSession || typeof MediaMetadata === 'undefined' || this.closed) return;
    if (this.metadata?.title === title && this.metadata.artist === host) return;
    this.metadata = new MediaMetadata({ title, artist: host, album: 'LimeNote スペース' });
    navigator.mediaSession.metadata = this.metadata;
    for (const [action, handler] of [['play', () => this.resume()], ['pause', () => this.pause()], ['stop', () => this.pause()]] as const) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Platform-dependent controls. */ }
    }
    navigator.mediaSession.playbackState = this.paused ? 'paused' : 'playing';
  }
  attach(uid: string | number, track: IRemoteAudioTrack) {
    if (this.closed) return;
    this.remove(uid);
    const audio = new Audio();
    audio.hidden = true; audio.autoplay = false; audio.dataset.limeSpaceVoice = String(uid);
    audio.srcObject = new MediaStream([track.getMediaStreamTrack()]);
    document.body.append(audio); this.players.set(String(uid), audio);
    if (!this.paused) this.play(audio);
  }
  private play(audio: HTMLAudioElement) { void audio.play().catch(() => { if (!this.closed && !this.paused) this.onBlocked(); }); }
  remove(uid: string | number) {
    const audio = this.players.get(String(uid));
    if (!audio) return;
    audio.pause(); audio.srcObject = null; audio.remove(); this.players.delete(String(uid));
  }
  pause() {
    this.paused = true; this.pauseWaiting(); this.players.forEach(audio => audio.pause());
    if (navigator.mediaSession?.metadata === this.metadata) navigator.mediaSession.playbackState = 'paused';
  }
  resume() {
    if (this.closed) return;
    this.paused = false; this.resumeWaiting(); this.players.forEach(audio => this.play(audio));
    if (navigator.mediaSession?.metadata === this.metadata) navigator.mediaSession.playbackState = 'playing';
  }
  close() {
    if (this.closed) return;
    this.closed = true; [...this.players.keys()].forEach(uid => this.remove(uid));
    if (this.metadata && navigator.mediaSession?.metadata === this.metadata) {
      navigator.mediaSession.metadata = null;
      for (const action of ['play', 'pause', 'stop'] as const) try { navigator.mediaSession.setActionHandler(action, null); } catch { /* Unsupported control. */ }
      navigator.mediaSession.playbackState = 'none';
    }
    const audioSession = (navigator as AudioNavigator).audioSession;
    if (audioSession && this.previousType && audioSession.type === this.assignedType) try { audioSession.type = this.previousType; } catch { /* Unsupported mode. */ }
  }
}

// spaceWaitingAudio
/** Native playback avoids background timer/Web Audio suspension on mobile. */
class SpaceWaitingAudio {
  private url: string;
  private audio = new Audio();
  private ended = false;
  private audible = false;
  private paused = false;

  constructor(private onBlocked: () => void) {
    // A short synthesized silence unlocks this element in the tap. The large
    // keyboard score is loaded only after entering a space, never at startup.
    const silence = new ArrayBuffer(44 + 8000), header = new DataView(silence);
    const write = (offset: number, value: string) => [...value].forEach((char, index) => header.setUint8(offset + index, char.charCodeAt(0)));
    write(0, 'RIFF'); header.setUint32(4, silence.byteLength - 8, true); write(8, 'WAVE'); write(12, 'fmt ');
    header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true); header.setUint32(24, 16000, true); header.setUint32(28, 32000, true); header.setUint16(32, 2, true); header.setUint16(34, 16, true); write(36, 'data'); header.setUint32(40, 8000, true);
    this.url = URL.createObjectURL(new Blob([silence], { type: 'audio/wav' }));
    this.audio.src = this.url;
    this.audio.loop = true;
    this.audio.preload = 'auto';
    this.audio.hidden = true;
    this.audio.muted = true;
    this.audio.dataset.limeSpaceWaiting = 'true';
    document.body.append(this.audio);
    // Prime in the Start/Listen gesture, before permissions/network awaits.
    this.play();
    void createSpaceMusic().then(blob => {
      if (this.ended) return;
      const url = URL.createObjectURL(blob);
      URL.revokeObjectURL(this.url); this.url = url; this.audio.src = url;
      this.audio.dataset.limeSpaceReady = 'true'; this.play();
    }).catch(() => { if (!this.ended && this.audible) this.onBlocked(); });
  }
  private play() {
    if (this.ended || this.paused) return;
    void this.audio.play().catch(() => { if (this.audible && !this.ended) this.onBlocked(); });
  }
  setWaiting(waiting: boolean) {
    if (this.ended) return;
    if (!waiting) { this.stop(); return; }
    if (this.audible) return;
    this.audible = true;
    this.audio.muted = false;
    this.play();
  }
  pause() { this.paused = true; this.audio.pause(); }
  resume() { this.paused = false; if (this.audible) this.play(); }
  stop() {
    if (this.ended) return;
    this.ended = true;
    this.audible = false;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.audio.remove();
    URL.revokeObjectURL(this.url);
  }
}

// incomingRingtone
let music: Promise<AudioBuffer> | undefined;
function loadMusic(ctx: AudioContext): Promise<AudioBuffer> {
  music ??= createSpaceMusic()
    .then(blob => blob.arrayBuffer())
    .then(bytes => ctx.decodeAudioData(bytes))
    .catch(error => { music = undefined; throw error; });
  return music;
}
function unlockIncomingRingtone() {
  unlockAudioPlayback();
  // Start synthesis during chat interaction, not when the random call arrives.
  try { void loadMusic(getAudioPlaybackContext()).catch(() => {}); } catch { /* No audio support. */ }
}
/** Reuse the Spaces track and decoded buffer across incoming calls. */
function playIncomingRingtone(): () => void {
  let ctx:AudioContext;
  try { ctx=getAudioPlaybackContext(); } catch { return ()=>{}; }
  let cancelled = false;
  let source: AudioBufferSourceNode | undefined;
  const gain = ctx.createGain();
  gain.gain.value = .65;
  gain.connect(ctx.destination);
  const ready=()=>ctx.state==='running'?Promise.resolve():ctx.resume();
  let starting=false;
  const start=async()=>{
    if(cancelled||starting)return;
    starting=true;
    try {
      const [buffer]=await Promise.all([loadMusic(ctx),ready()]);
      if(cancelled||ctx.state!=='running')return;
      if(!source){source=ctx.createBufferSource();source.buffer=buffer;source.loop=true;source.connect(gain);source.start();}
    } catch { /* Retry in the next gesture if Safari interrupted playback. */ }
    finally {starting=false;}
  };
  const restore=()=>{if(!cancelled&&document.visibilityState==='visible')void start();};
  document.addEventListener('visibilitychange',restore);
  window.addEventListener('touchend',restore);
  window.addEventListener('click',restore);
  void start();
  return () => {
    if(cancelled)return;
    cancelled = true;
    document.removeEventListener('visibilitychange',restore);
    window.removeEventListener('touchend',restore);
    window.removeEventListener('click',restore);
    if (source) { source.stop(); source.disconnect(); }
    gain.disconnect();
  };
}

export { CallRecorder };
export { requestMicrophonePermission };
export { microphoneErrorMessage };
export { preferRecordedCallSpeech };
export { callAudioFilename };
export { requestCallTranscription };
export { configureAudioPlayback };
export { getAudioPlaybackContext };
export { unlockAudioPlayback };
export { ttsSupported };
export { unlockAiAudio };
export { splitForSpeech };
export { synthesizeSpeech };
export type { VoiceOpts };
export type { SpeakHooks };
export { Speaker };
export { SpacePlayback };
export { SpaceWaitingAudio };
export { unlockIncomingRingtone };
export { playIncomingRingtone };
