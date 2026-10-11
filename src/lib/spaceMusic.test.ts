import { expect, it } from 'vitest';
import { createSpaceMusic, SPACE_MUSIC_RATE } from './spaceMusic';
import { SPACE_SCORE_DURATION } from './spaceMusicScore';
it('generates and reuses a complete audible stereo loop from synthesis parameters', async () => {
  const pending = createSpaceMusic(); expect(createSpaceMusic()).toBe(pending);
  const blob = await pending; expect(await createSpaceMusic()).toBe(blob); expect(blob.type).toBe('audio/wav');
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
  const view = new DataView(buffer);
  expect(String.fromCharCode(...new Uint8Array(buffer, 0, 4))).toBe('RIFF');
  expect(view.getUint16(22, true)).toBe(2);
  expect(view.getUint32(24, true)).toBe(SPACE_MUSIC_RATE);
  const seconds = (buffer.byteLength - 44) / (4 * SPACE_MUSIC_RATE);
  expect(seconds).toBeCloseTo(SPACE_SCORE_DURATION, 4);
  expect(seconds).toBeCloseTo(226.22254, 4);
  expect(view.getInt16(44, true)).toBe(0);
  expect(view.getInt16(buffer.byteLength - 2, true)).toBe(0);
  let energy = 0, peak = 0, stereoDifference = 0;
  for (let offset = 44; offset < buffer.byteLength; offset += 4) {
    const left = view.getInt16(offset, true) / 32768, right = view.getInt16(offset + 2, true) / 32768;
    energy += left * left + right * right; peak = Math.max(peak, Math.abs(left), Math.abs(right));
    stereoDifference += (left - right) ** 2;
  }
  expect(Math.sqrt(energy / ((buffer.byteLength - 44) / 2))).toBeGreaterThan(.02);
  expect(peak).toBeLessThan(1);
  expect(stereoDifference).toBeGreaterThan(1);
}, 30000);
