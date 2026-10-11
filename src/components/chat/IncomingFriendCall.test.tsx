import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { IncomingFriendCall } from './IncomingFriendCall';
const stop = vi.hoisted(() => vi.fn());
vi.mock('@/lib/incomingRingtone', () => ({ playIncomingRingtone: () => stop }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('answers the call and stops ringing when the owner dismisses the banner', async () => {
  const answer = vi.fn().mockResolvedValue(true);
  const decline = vi.fn();
  const view = render(<IncomingFriendCall name="なか" avatar="/avatar.png" onAnswer={answer} onDecline={decline}/>);
  expect(screen.getByRole('alertdialog', { name: 'なかから着信' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '着信に応答' }));
  await waitFor(() => expect(decline).toHaveBeenCalledOnce());
  expect(answer).toHaveBeenCalledOnce();
  view.unmount(); expect(stop).toHaveBeenCalledOnce();
});
it('leaves the banner answerable when microphone permission is denied', async () => {
  const decline = vi.fn();
  render(<IncomingFriendCall name="なか" avatar="/avatar.png" onAnswer={async () => false} onDecline={decline}/>);
  fireEvent.click(screen.getByRole('button', { name: '着信に応答' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '着信に応答' })).toBeEnabled());
  expect(decline).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '着信を拒否' }));
  expect(decline).toHaveBeenCalledOnce();
});
