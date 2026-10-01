import { microphoneErrorMessage } from './microphone';

type Handlers = {
  onFinal: (text: string) => void;
  onEnd: () => void;
  onError: (message: string) => void;
};

/** SpeechRecognition is unavailable in some installed PWAs. Record one turn,
 * detect a pause, and transcribe it using the authenticated server endpoint. */
export class CallRecorder {
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
            const text = await this.transcribe(new Blob(chunks, { type: recorder!.mimeType }), lang, controller.signal);
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
