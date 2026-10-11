import { createSpaceMusic } from './spaceMusic';
let context: AudioContext | null = null;
let music: Promise<AudioBuffer> | undefined;
export function unlockIncomingRingtone() {
  try {
    const Constructor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return;
    context ??= new Constructor();
    void context.resume().catch(() => {});
  } catch { /* Audio can be unavailable while the visual banner remains usable. */ }
}
/** Reuse the Spaces track and decoded buffer across incoming calls. */
export function playIncomingRingtone(): () => void {
  const ctx = context;
  if (!ctx || ctx.state !== 'running') return () => {};
  let cancelled = false;
  let source: AudioBufferSourceNode | undefined;
  const gain = ctx.createGain();
  gain.gain.value = .65;
  gain.connect(ctx.destination);
  music ??= createSpaceMusic().then(blob => blob.arrayBuffer()).then(bytes => ctx.decodeAudioData(bytes)).catch(error => { music = undefined; throw error; });
  void music.then(buffer => {
    if (cancelled) return;
    source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
    source.connect(gain); source.start();
  }).catch(() => { gain.disconnect(); });
  return () => {
    cancelled = true;
    if (source) { source.stop(); source.disconnect(); }
    gain.disconnect();
  };
}
