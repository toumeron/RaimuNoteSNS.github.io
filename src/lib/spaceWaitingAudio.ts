import { createSpaceMusic } from './spaceMusic';

/** Native playback avoids background timer/Web Audio suspension on mobile. */
export class SpaceWaitingAudio {
  private url: string;
  private audio = new Audio();
  private ended = false;
  private audible = false;
  private paused = false;

  constructor(private onBlocked: () => void) {
    // A short synthesized silence unlocks this element in the tap. The large
    // oscillator score is loaded only after entering a space, never at startup.
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
