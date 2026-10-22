import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SnowEffect } from './App';
import { setSnowEffect } from '@/components/ui/button';
let callbacks: Map<number, FrameRequestCallback>;
let nextFrame: number;
let context: any;
const tick = (time: number) => act(() => {
  const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(time));
});
beforeEach(() => {
  localStorage.removeItem('lime-snow-effect');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  callbacks = new Map(); nextFrame = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callbacks.set(++nextFrame, callback); return nextFrame; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { callbacks.delete(id); });
  context = Object.fromEntries(['setTransform','clearRect','save','restore','translate','rotate','scale','beginPath','moveTo','lineTo','closePath','fill','stroke','arc','drawImage'].map(key => [key, vi.fn()]));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
});
afterEach(() => { cleanup(); localStorage.removeItem('lime-snow-effect'); vi.restoreAllMocks(); });
it('draws irregular snow aggregates rather than icons, text or circles and removes them on disable', () => {
  render(<SnowEffect/>);
  expect(document.querySelector('.lime-snow')).toBeNull();
  act(() => setSnowEffect(true));
  const snow = document.querySelector('.lime-snow')!;
  expect(snow.getAttribute('aria-hidden')).toBe('true');
  expect(snow.textContent).toBe('');
  expect(snow.querySelector('canvas')).not.toBeNull();
  expect(snow.querySelector('svg')).toBeNull();
  tick(16); tick(66);
  expect(context.fill).toHaveBeenCalled();
  expect(context.lineTo.mock.calls.length).toBeGreaterThan(100);
  expect(new Set(context.moveTo.mock.calls.map((point: number[]) => point.join(','))).size).toBeGreaterThan(20);
  expect(context.arc).not.toHaveBeenCalled();
  expect(localStorage.getItem('lime-snow-effect')).toBe('true');
  act(() => setSnowEffect(false));
  expect(document.querySelector('.lime-snow')).toBeNull();
  expect(callbacks.size).toBe(0);
});
it('retains the appearance choice when the app remounts', () => {
  setSnowEffect(true);
  const view = render(<SnowEffect/>); view.unmount(); render(<SnowEffect/>);
  expect(document.querySelector('canvas')).not.toBeNull();
});
it('actually stops drawing while hidden and resumes without a large position jump', () => {
  setSnowEffect(true); render(<SnowEffect/>); tick(16); tick(66);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(document.querySelector('.lime-snow')?.getAttribute('data-paused')).toBe('true');
  expect(callbacks.size).toBe(0);
  const draws = context.drawImage.mock.calls.length;
  tick(9000); expect(context.drawImage.mock.calls).toHaveLength(draws);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  tick(10000); expect(context.drawImage.mock.calls).toHaveLength(draws);
  tick(10050); expect(context.drawImage.mock.calls.length).toBeGreaterThan(draws);
});
it('gives flakes independent trajectories and bounds drawing work to 30 frames per second', () => {
  setSnowEffect(true); render(<SnowEffect/>); tick(16); tick(66);
  const first = context.translate.mock.calls.map((point: number[]) => [...point]);
  context.translate.mockClear();
  tick(76); expect(context.translate).not.toHaveBeenCalled();
  tick(116);
  const second = context.translate.mock.calls;
  const velocities = first.map((point: number[], index: number) => [second[index][0] - point[0], second[index][1] - point[1]].map(n => n.toFixed(2)).join(','));
  expect(new Set(velocities).size).toBeGreaterThan(10);
});
it('responds to preference changes from another tab and releases all work on unmount', () => {
  const remove = vi.spyOn(window, 'removeEventListener');
  const view = render(<SnowEffect/>);
  localStorage.setItem('lime-snow-effect', 'true');
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'lime-snow-effect' })));
  expect(document.querySelector('.lime-snow')).not.toBeNull();
  view.unmount(); expect(callbacks.size).toBe(0);
  expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
});

it('reuses aggregate textures between frames and frees their backing stores on disable', () => {
  setSnowEffect(true); render(<SnowEffect/>); tick(16); tick(66);
  const generatedPaths = context.beginPath.mock.calls.length;
  const textures = [...new Set(context.drawImage.mock.calls.map((call: any[]) => call[0]))] as HTMLCanvasElement[];
  expect(textures.length).toBeGreaterThan(1);
  expect(textures.every(texture => texture.width === 64 && texture.height === 64)).toBe(true);
  const sizes = context.drawImage.mock.calls.map((call: any[]) => call[3].toFixed(1));
  expect(new Set(sizes).size).toBeGreaterThan(10);
  tick(116); tick(166);
  expect(context.beginPath.mock.calls).toHaveLength(generatedPaths);
  act(() => setSnowEffect(false));
  expect(textures.every(texture => texture.width === 0 && texture.height === 0)).toBe(true);
});
