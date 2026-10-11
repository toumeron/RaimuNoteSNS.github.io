import { expect, it, vi } from 'vitest';
vi.mock('./spaceMusic', () => ({ createSpaceMusic: vi.fn().mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(8) }) }));
import { createSpaceMusic } from './spaceMusic';
import { playIncomingRingtone, unlockIncomingRingtone } from './incomingRingtone';
it('reuses Spaces music, loops it, cancels pending playback and stops on dismissal', async () => {
  const voices: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; loop: boolean }[] = [];
  const decode = vi.fn().mockResolvedValue({});
  class Context {
    state = 'running'; destination = {};
    resume = vi.fn().mockResolvedValue(undefined);
    decodeAudioData = decode;
    createGain() { return { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0 } }; }
    createBufferSource() { const voice = { buffer: null, loop: false, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() }; voices.push(voice); return voice; }
  }
  vi.stubGlobal('AudioContext', Context);
  try {
    unlockIncomingRingtone();
    const cancel = playIncomingRingtone(); cancel();
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
    expect(voices).toHaveLength(0);
    const stop = playIncomingRingtone();
    await vi.waitFor(() => expect(voices).toHaveLength(1));
    expect(voices[0].loop).toBe(true); expect(voices[0].start).toHaveBeenCalledOnce();
    stop(); expect(voices[0].stop).toHaveBeenCalledOnce();
    expect(createSpaceMusic).toHaveBeenCalledOnce(); expect(decode).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});
