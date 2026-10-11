/** Synthesize the corrected Spaces track from its measured Fourier coefficients. */
export const SPACE_MUSIC_RATE = 22050;
let cached: Promise<Blob> | undefined;
export function createSpaceMusic(): Promise<Blob> {
  return cached ??= renderSpaceMusic().catch(error => { cached = undefined; throw error; });
}
async function renderSpaceMusic(): Promise<Blob> {
  const [score, { gunzipSync }] = await Promise.all([import('./spaceMusicScore'), import('fflate')]);
  const { SPACE_SCORE_SAMPLES: samples, SPACE_SCORE_FRAMES: frames, SPACE_SPECTRUM_SIZE: size, SPACE_SPECTRUM_HOP: hop } = score;
  const bytes = gunzipSync(Uint8Array.from(atob(score.SPACE_SPECTRUM_GZIP), c => c.charCodeAt(0)));
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const window = Float64Array.from({ length: size }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / size));
  const reverse = new Uint16Array(size);
  const bits = Math.log2(size);
  for (let i = 0; i < size; i++) {
    let value = i, result = 0;
    for (let bit = 0; bit < bits; bit++) { result = (result << 1) | (value & 1); value >>= 1; }
    reverse[i] = result;
  }
  const cosine = Float64Array.from({ length: size / 2 }, (_, i) => Math.cos(2 * Math.PI * i / size));
  const sine = Float64Array.from({ length: size / 2 }, (_, i) => Math.sin(2 * Math.PI * i / size));
  const left = new Float32Array(samples), right = new Float32Array(samples), weights = new Float32Array(samples);
  const real = new Float64Array(size), imaginary = new Float64Array(size);
  let offset = 0;
  for (let frame = 0; frame < frames; frame++) {
    const start = frame * hop - size / 2;
    for (let i = 0; i < size; i++) {
      const index = start + i;
      if (index >= 0 && index < samples) weights[index] += window[i] ** 2;
    }
    for (const output of [left, right]) {
      real.fill(0); imaginary.fill(0);
      const count = data.getUint16(offset, true), scale = data.getFloat32(offset + 2, true); offset += 6;
      for (let coefficient = 0; coefficient < count; coefficient++) {
        const bin = data.getUint16(offset, true);
        const re = data.getInt16(offset + 2, true) * scale, im = data.getInt16(offset + 4, true) * scale;
        offset += 6;
        real[reverse[bin]] = re; imaginary[reverse[bin]] = im;
        if (bin > 0 && bin < size / 2) {
          real[reverse[size - bin]] = re; imaginary[reverse[size - bin]] = -im;
        }
      }
      // Inverse FFT is the sum of the measured sinusoids, retaining their phase.
      for (let width = 2; width <= size; width *= 2) {
        const half = width / 2, step = size / width;
        for (let base = 0; base < size; base += width) {
          for (let j = 0; j < half; j++) {
            const a = base + j, b = a + half, c = cosine[j * step], s = sine[j * step];
            const re = real[b] * c - imaginary[b] * s, im = real[b] * s + imaginary[b] * c;
            real[b] = real[a] - re; imaginary[b] = imaginary[a] - im;
            real[a] += re; imaginary[a] += im;
          }
        }
      }
      for (let i = 0; i < size; i++) {
        const index = start + i;
        if (index >= 0 && index < samples) output[index] += real[i] / size * window[i];
      }
    }
    // Yield during synthesis so call controls and the rest of the UI remain usable.
    if (frame % 32 === 31) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  if (offset !== data.byteLength) throw new Error('Invalid Spaces music synthesis data');
  const buffer = new ArrayBuffer(44 + samples * 4), view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, SPACE_MUSIC_RATE, true); view.setUint32(28, SPACE_MUSIC_RATE * 4, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples * 4, true);
  for (let i = 0; i < samples; i++) {
    const fade = Math.min(1, i / (SPACE_MUSIC_RATE * .012), (samples - 1 - i) / (SPACE_MUSIC_RATE * .012));
    for (const [channel, output] of [left, right].entries()) {
      const value = Math.max(-1, Math.min(1, output[i] / Math.max(weights[i], 1e-12) * fade));
      view.setInt16(44 + i * 4 + channel * 2, Math.round(32767 * value), true);
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
