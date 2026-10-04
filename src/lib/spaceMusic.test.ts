import { expect, it } from 'vitest';
import { createSpaceMusic, SPACE_MUSIC_RATE } from './spaceMusic';
it('generates a cached, finite and audible PCM loop without an external recording', async () => {
  const blob = await createSpaceMusic(); expect(await createSpaceMusic()).toBe(blob); expect(blob.type).toBe('audio/wav');
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
  const view = new DataView(buffer);
  expect(String.fromCharCode(...new Uint8Array(buffer, 0, 4))).toBe('RIFF');
  expect(view.getUint32(24, true)).toBe(SPACE_MUSIC_RATE);
  const seconds = (buffer.byteLength - 44) / (2 * SPACE_MUSIC_RATE);
  expect(seconds).toBeGreaterThan(225); expect(seconds).toBeLessThan(235);
  let energy = 0, peak = 0;
  for (let offset = 44; offset < buffer.byteLength; offset += 2) { const sample = view.getInt16(offset, true) / 32768; energy += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
  expect(Math.sqrt(energy / ((buffer.byteLength - 44) / 2))).toBeGreaterThan(.02);
  expect(peak).toBeLessThan(.95);
});
