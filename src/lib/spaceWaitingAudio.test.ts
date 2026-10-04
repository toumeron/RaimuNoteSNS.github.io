import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const music = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('./spaceMusic', () => ({ createSpaceMusic: music.load }));
import { SpaceWaitingAudio } from './spaceWaitingAudio';

describe('space waiting audio', () => {
  let play: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    music.load.mockImplementation(() => new Promise(() => {}));
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:generated-music'), revokeObjectURL: vi.fn() });
  });
  afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('primes silently, loops generated music, stops permanently after the first microphone', () => {
    const player = new SpaceWaitingAudio(vi.fn());
    const audio = document.querySelector('audio')!;
    expect(audio.getAttribute('src')).toBe('blob:generated-music'); expect(audio.muted).toBe(true);
    expect(audio.loop).toBe(true);
    player.setWaiting(true); expect(audio.muted).toBe(false);
    player.setWaiting(false);
    expect(document.querySelector('audio')).toBeNull();
    const calls = play.mock.calls.length;
    player.setWaiting(true); player.resume(); player.stop();
    expect(play).toHaveBeenCalledTimes(calls);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
  it('respects system pause even when waiting status is refreshed', () => {
    const player = new SpaceWaitingAudio(vi.fn()); player.setWaiting(true); player.pause();
    const calls = play.mock.calls.length;
    player.setWaiting(true); player.setWaiting(true);
    expect(play).toHaveBeenCalledTimes(calls);
    player.resume(); expect(play).toHaveBeenCalledTimes(calls + 1); player.stop();
  });
  it('supports an explicit retry after autoplay is blocked', async () => {
    const blocked = vi.fn(); const player = new SpaceWaitingAudio(blocked);
    play.mockRejectedValueOnce(new Error('Autoplay blocked')); player.setWaiting(true);
    await Promise.resolve(); expect(blocked).toHaveBeenCalledTimes(1);
    player.resume(); expect(play).toHaveBeenCalledTimes(3); player.stop();
  });
  it('discards primed music if joining fails', () => {
    const player = new SpaceWaitingAudio(vi.fn()); player.stop(); player.setWaiting(true);
    expect(document.querySelector('audio')).toBeNull(); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
  it('keeps the generated audio paused if the user pauses during loading', async () => {
    let resolve!: (blob: Blob) => void;
    music.load.mockImplementation(() => new Promise<Blob>(done => { resolve = done; }));
    const player = new SpaceWaitingAudio(vi.fn()); player.setWaiting(true); player.pause();
    const count = play.mock.calls.length;
    resolve(new Blob(['generated waveform'])); await Promise.resolve();
    expect(document.querySelector('audio')?.dataset.limeSpaceReady).toBe('true');
    expect(play).toHaveBeenCalledTimes(count); player.stop();
  });
  it('cannot recreate audio when synthesis finishes after leaving the space', async () => {
    let resolve!: (blob: Blob) => void;
    music.load.mockImplementation(() => new Promise<Blob>(done => { resolve = done; }));
    const player = new SpaceWaitingAudio(vi.fn()); player.stop();
    const count = play.mock.calls.length;
    resolve(new Blob(['generated waveform'])); await Promise.resolve();
    expect(document.querySelector('audio')).toBeNull(); expect(play).toHaveBeenCalledTimes(count);
  });

});
