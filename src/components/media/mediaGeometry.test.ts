import { describe, it, expect } from 'vitest';
import { containSize, clampPan, focalPan, pinchZoom } from './mediaGeometry';
describe('image gesture geometry', () => {
  it('fits portrait and landscape images without mistaking the letterbox for image pixels', () => {
    expect(containSize(1000, 800, 400, 800)).toEqual({ width: 400, height: 800 });
    expect(containSize(390, 844, 1000, 500)).toEqual({ width: 390, height: 195 });
  });
  it('allows every edge of a highly zoomed landscape image to reach the viewport edge', () => {
    const size = containSize(390, 844, 1000, 500);
    expect(clampPan({ x: 99999, y: -99999 }, size, { width: 390, height: 844 }, 12)).toEqual({ x: 2145, y: -748 });
    expect(clampPan({ x: 99, y: 99 }, size, { width: 390, height: 844 }, 1)).toEqual({ x: 0, y: 0 });
  });
  it('keeps the image pixel under the fingers in place during pinch zoom', () => {
    expect(focalPan({ x: 20, y: 10 }, 2, 4, { x: 80, y: 50 })).toEqual({ x: -40, y: -30 });
  });
});

it('ignores pinch jitter, damps touch sensitivity, and retains the full zoom range', () => {
 expect(pinchZoom(2, 100, 104)).toBe(2);
 expect(pinchZoom(1, 20, 30)).toBe(1);
 expect(pinchZoom(1, 100, 200)).toBeCloseTo(Math.pow(2, .7));
 expect(pinchZoom(10, 100, 200)).toBe(12);
 expect(pinchZoom(2, 100, 10)).toBe(1);
});
