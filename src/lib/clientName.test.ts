import { describe, expect, it } from 'vitest';
import { getClientName } from './clientName';
describe('posting client', () => {
  it.each([
    ['Mozilla iPhone OS 18 like Mac OS X', 5, 'iPhone'],
    ['Mozilla iPad CPU OS 18 like Mac OS X', 5, 'iPad'],
    ['Mozilla Macintosh Intel Mac OS X', 5, 'iPad'],
    ['Mozilla Macintosh Intel Mac OS X', 0, 'Mac'],
    ['Mozilla Linux Android 15', 5, 'Android'],
    ['Mozilla Windows NT 10.0', 0, 'Windows'],
    ['Mozilla X11 Linux x86_64', 0, 'Linux'],
    ['unknown', 0, 'Web'],
  ])('identifies %s without guessing the hardware model', (ua, touches, device) => {
    expect(getClientName(ua, touches)).toBe(`LimeNote for ${device}`);
  });
});
