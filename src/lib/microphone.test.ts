import { afterEach, describe, expect, it, vi } from 'vitest';
import { microphoneErrorMessage, requestMicrophonePermission } from './microphone';

afterEach(() => vi.unstubAllGlobals());
describe('microphone permission', () => {
  it('requests audio and releases the permission-check stream', async () => {
    vi.stubGlobal('isSecureContext', true);
    const stop = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    await requestMicrophonePermission();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stop).toHaveBeenCalledOnce();
  });
  it('explains permission denial to installed PWA users', async () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')) } });
    await expect(requestMicrophonePermission()).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(microphoneErrorMessage(new DOMException('Denied', 'NotAllowedError'))).toContain('PWA');
  });
  it('reports HTTPS requirement without requesting permission', async () => {
    vi.stubGlobal('isSecureContext', false);
    await expect(requestMicrophonePermission()).rejects.toThrow('HTTPS');
  });
});
