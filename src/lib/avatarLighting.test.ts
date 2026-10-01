import { describe, expect, it } from 'vitest';
import { animateAvatarLight, avatarBackgroundLightness, measureAvatarLuminance, nextAvatarExposure } from './avatarLighting';

const pixels = (levels: number[], alpha = 255) => new Uint8ClampedArray(levels.flatMap((v) => [v, v, v, alpha]));
const stats = (level: number) => measureAvatarLuminance(pixels(Array(100).fill(level)))!;

describe('automatic lighting from rendered pixels', () => {
  it('ignores transparent background and antialiased edges', () => {
    expect(measureAvatarLuminance(pixels(Array(100).fill(255), 0))).toBeNull();
    expect(measureAvatarLuminance(pixels(Array(100).fill(255), 128))).toBeNull();
    const mixed = new Uint8ClampedArray([...pixels(Array(100).fill(128)), ...pixels(Array(900).fill(255), 0)]);
    expect(measureAvatarLuminance(mixed)?.upper).toBeCloseTo(128 / 255);
  });
  it('raises dark exposure and lowers bright exposure including clipped highlights', () => {
    expect(nextAvatarExposure(0.8, stats(50))).toBeGreaterThan(0.8);
    expect(nextAvatarExposure(0.8, stats(255))).toBeLessThan(0.8);
    expect(nextAvatarExposure(1, { median: 0.4, upper: 0.68, highlight: 1, clipped: 0.2 })).toBeLessThan(1);
  });
  it('stays steady inside the dead band and bounds extreme correction', () => {
    expect(nextAvatarExposure(1, stats(189))).toBe(1);
    expect(nextAvatarExposure(3.5, stats(0))).toBe(3.5);
    expect(nextAvatarExposure(0.12, stats(255))).toBe(0.12);
  });
  it('adjusts the backdrop for model brightness and theme with bounded values', () => {
    expect(avatarBackgroundLightness(stats(210), false)).toBeLessThan(avatarBackgroundLightness(stats(70), false));
    expect(avatarBackgroundLightness(stats(210), true)).toBeLessThan(avatarBackgroundLightness(stats(70), true));
    expect(avatarBackgroundLightness(stats(255), false)).toBeLessThanOrEqual(0.40);
    expect(avatarBackgroundLightness(stats(0), true)).toBeGreaterThanOrEqual(0.08);
    expect(stats(189).upper - avatarBackgroundLightness(stats(189), false)).toBeGreaterThan(0.35);
  });
  it('animates exposure without jumps in either direction even after a delayed frame', () => {
    for (const [current, target] of [[0.2, 3], [3, 0.2]]) {
      const next = animateAvatarLight(current, target, 1, true);
      expect(Math.abs(Math.log(next / current))).toBeLessThanOrEqual(0.020001);
      expect(next).toBeGreaterThan(Math.min(current, target));
      expect(next).toBeLessThan(Math.max(current, target));
    }
    expect(animateAvatarLight(1, 1, 0.016, true)).toBe(1);
  });
  it('moves the background continuously and gives the same speed across frame rates', () => {
    expect(Math.abs(animateAvatarLight(0.4, 0.1, 1) - 0.4)).toBeLessThanOrEqual(0.004001);
    const advance = (fps: number) => {
      let value = 0.4;
      for (let i = 0; i < fps; i++) value = animateAvatarLight(value, 0.1, 1 / fps);
      return value;
    };
    expect(advance(30)).toBeCloseTo(advance(120), 5);
  });
});
