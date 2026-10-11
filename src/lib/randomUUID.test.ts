import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from './randomUUID';

afterEach(() => vi.unstubAllGlobals());
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('UUID compatibility', () => {
  it('uses the native method when available', () => {
    const native = vi.fn(() => 'native-uuid');
    vi.stubGlobal('crypto', { randomUUID: native });
    expect(randomUUID()).toBe('native-uuid');
    expect(native).toHaveBeenCalledOnce();
  });
  it('uses random bytes when LAN HTTP omits randomUUID', () => {
    let sequence = 0;
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(++sequence);
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues });
    const first = randomUUID();
    const second = randomUUID();
    expect(first).toMatch(uuidV4);
    expect(second).toMatch(uuidV4);
    expect(second).not.toBe(first);
    expect(getRandomValues).toHaveBeenCalledTimes(2);
  });
  it('does not crash if crypto is unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    expect(randomUUID()).toMatch(uuidV4);
  });
});
