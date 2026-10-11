import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { incomingCallDelay, useIncomingFriendCalls } from './useIncomingFriendCalls';
vi.mock('@/lib/incomingRingtone', () => ({ unlockIncomingRingtone: vi.fn() }));
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it('varies first and subsequent call times rather than using an interval', () => {
  expect(incomingCallDelay(true, () => 0)).toBe(3 * 60000);
  expect(incomingCallDelay(true, () => 1)).toBe(8 * 60000);
  expect(incomingCallDelay(false, () => 0)).toBe(8 * 60000);
  expect(incomingCallDelay(false, () => 1)).toBe(20 * 60000);
});
it('prepares one call, expires it, and preserves the next due time across remounts', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const prepare = vi.fn().mockResolvedValue({ name: 'friend', opening: '話したいことがあるんだ' });
  const options = { account: 'viewer', busy: () => false, prepare };
  const view = renderHook(() => useIncomingFriendCalls(options));
  await act(() => vi.advanceTimersByTimeAsync(3 * 60000));
  expect(view.result.current.incoming).toMatchObject({ name: 'friend' });
  const next = localStorage.getItem('limeai:viewer:next-incoming-call');
  await act(() => vi.advanceTimersByTimeAsync(45000));
  expect(view.result.current.incoming).toBeNull();
  view.unmount(); renderHook(() => useIncomingFriendCalls(options));
  expect(localStorage.getItem('limeai:viewer:next-incoming-call')).toBe(next);
  expect(prepare).toHaveBeenCalledOnce();
});
it('does not prepare while another call or generation is busy', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const prepare = vi.fn();
  renderHook(() => useIncomingFriendCalls({ account: 'viewer', busy: () => true, prepare }));
  await act(() => vi.advanceTimersByTimeAsync(3 * 60000));
  expect(prepare).not.toHaveBeenCalled();
});
it('does not call for guests or after unmount', async () => {
  const prepare = vi.fn();
  const view = renderHook(() => useIncomingFriendCalls({ account: null, busy: () => false, prepare }));
  await act(() => vi.advanceTimersByTimeAsync(100 * 60000));
  expect(prepare).not.toHaveBeenCalled();
  view.unmount();
});
it('hides the banner and aborts preparation when the app becomes hidden', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  let signal!: AbortSignal;
  const prepare = vi.fn((value: AbortSignal) => { signal = value; return new Promise<null>(resolve => value.addEventListener('abort', () => resolve(null))); });
  const view = renderHook(() => useIncomingFriendCalls({ account: 'viewer', busy: () => false, prepare }));
  await act(() => vi.advanceTimersByTimeAsync(3 * 60000));
  await act(async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(signal.aborted).toBe(true);
  expect(view.result.current.incoming).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(100 * 60000));
  expect(prepare).toHaveBeenCalledOnce();
});
it('does not offer an empty call after a failed AI request', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const view = renderHook(() => useIncomingFriendCalls({ account: 'viewer', busy: () => false, prepare: async () => { throw new Error('offline'); } }));
  await act(() => vi.advanceTimersByTimeAsync(3 * 60000));
  expect(view.result.current.incoming).toBeNull();
});

it('continues offering calls at separately randomized times while the chat stays open', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const prepare = vi.fn().mockResolvedValue({ name: 'friend' });
  const view = renderHook(() => useIncomingFriendCalls({ account: 'viewer', busy: () => false, prepare }));
  await act(() => vi.advanceTimersByTimeAsync(3 * 60000)); expect(prepare).toHaveBeenCalledTimes(1);
  act(() => view.result.current.dismiss());
  await act(() => vi.advanceTimersByTimeAsync(8 * 60000)); expect(prepare).toHaveBeenCalledTimes(2);
  act(() => view.result.current.dismiss());
  await act(() => vi.advanceTimersByTimeAsync(8 * 60000)); expect(prepare).toHaveBeenCalledTimes(3);
  view.unmount(); await act(() => vi.advanceTimersByTimeAsync(20 * 60000)); expect(prepare).toHaveBeenCalledTimes(3);
});
