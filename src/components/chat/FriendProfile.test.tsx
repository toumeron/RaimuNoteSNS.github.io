import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FriendProfile } from './FriendProfile';
import { findAssistant } from '@/lib/aiFriends';
afterEach(() => { cleanup(); localStorage.clear(); });
it('persists profile fields on the existing friend and invokes talk and call actions', () => {
  const friend = findAssistant('owner', 'builtin:km170')!;
  const onClose = vi.fn(), onTalk = vi.fn(), onCall = vi.fn();
  render(<FriendProfile friend={friend} uid="owner" avatars={{}} onClose={onClose} onTalk={onTalk} onCall={onCall}/>);
  expect(document.body.style.overflow).toBe('hidden');
  fireEvent.click(screen.getByRole('button', { name: 'お気に入り' }));
  fireEvent.click(screen.getByRole('button', { name: 'プロフィールを編集' }));
  fireEvent.change(screen.getByLabelText('誕生日'), { target: { value: '2000-09-29' } });
  expect(findAssistant('owner', friend.id)).toMatchObject({ favorite: true, birthday: '09-29' });
  expect(screen.getByText('9/29')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'トーク' }));
  expect(onTalk).toHaveBeenCalledWith(expect.objectContaining({ id: friend.id }));
  fireEvent.click(screen.getByRole('button', { name: '音声通話' }));
  expect(onCall).toHaveBeenCalledOnce(); expect(onClose).toHaveBeenCalledTimes(2);
});
it('closes with Escape and restores document scrolling', () => {
  const onClose = vi.fn();
  const { unmount } = render(<FriendProfile friend={findAssistant('owner', 'builtin:km170')!} uid="owner" avatars={{}} onClose={onClose} onTalk={vi.fn()} onCall={vi.fn()}/>);
  fireEvent.keyDown(document, { key: 'Escape' }); expect(onClose).toHaveBeenCalledOnce();
  unmount(); expect(document.body.style.overflow).not.toBe('hidden');
});
