/** Re-synthesis of measured reference frequencies, phases and amplitudes, without recording samples. */
export const SPACE_MUSIC_RATE = 16000;
let cached: Blob | undefined;
export async function createSpaceMusic(): Promise<Blob> {
  const { SPACE_PARTIALS, SPACE_NOISE, SPACE_NOISE_HOP, SPACE_SCORE_DURATION } = await import('./spaceMusicScore');
  if (cached) return cached;
  const mix = new Float32Array(Math.round(SPACE_SCORE_DURATION * SPACE_MUSIC_RATE));
  // Cubic phase interpolation preserves the measured pitch and its harmonics.
  // Unlike piano-note detection, it does not invent quantized extra notes.
  for (const track of SPACE_PARTIALS) {
    for (let point = 1; point < track.length; point++) {
      const [t0, f0, amp0, phase0] = track[point - 1];
      const [t1, f1, amp1, phase1] = track[point];
      const duration = t1 - t0, start = Math.round(t0 * SPACE_MUSIC_RATE), end = Math.min(mix.length, Math.round(t1 * SPACE_MUSIC_RATE));
      const slope0 = 2 * Math.PI * f0 * duration, slope1 = 2 * Math.PI * f1 * duration;
      const a = 2 * phase0 - 2 * phase1 + slope0 + slope1, b = -3 * phase0 + 3 * phase1 - 2 * slope0 - slope1;
      for (let i = start; i < end; i++) {
        const u = (i / SPACE_MUSIC_RATE - t0) / duration;
        const phase = ((a * u + b) * u + slope0) * u + phase0;
        const time = i / SPACE_MUSIC_RATE;
        const fade = Math.min(1, (time - track[0][0]) / .012, (track[track.length - 1][0] - time) / .012);
        mix[i] += Math.sin(phase) * (amp0 + (amp1 - amp0) * u) * Math.max(0, fade);
      }
    }
  }
  let seed = 1583, previousNoise = 0;
  for (let i = 0; i < mix.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    const position = i / SPACE_MUSIC_RATE / SPACE_NOISE_HOP, frame = Math.floor(position), u = position - frame;
    const amplitude = (SPACE_NOISE[frame] || 0) * (1 - u) + (SPACE_NOISE[frame + 1] || 0) * u;
    mix[i] += (noise - previousNoise) * amplitude; previousNoise = noise;
  }
  let energy = 0, peak = 0;
  mix.forEach(value => { energy += value * value; peak = Math.max(peak, Math.abs(value)); });
  const gain = Math.min(.095 / Math.max(.001, Math.sqrt(energy / mix.length)), .8 / Math.max(.001, peak));
  const buffer = new ArrayBuffer(44 + mix.length * 2), view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SPACE_MUSIC_RATE, true); view.setUint32(28, SPACE_MUSIC_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, mix.length * 2, true);
  mix.forEach((value, i) => view.setInt16(44 + i * 2, Math.round(32767 * value * gain), true));
  cached = new Blob([buffer], { type: 'audio/wav' });
  return cached;
}
