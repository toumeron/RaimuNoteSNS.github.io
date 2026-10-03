import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ insert: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => {
  if (table === 'lime_drops') return { insert: state.insert };
  return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { is_official: true }, error: null }) }), neq: () => ({ order: async () => ({ data: [{ id: 'recipient', username: 'friend', display_name: 'Friend', avatar_url: '' }], error: null }) }) }) };
} } }));
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReplyShare } from './ReplyShare';
const comment = { id: 'child', postId: 'root', content: 'reply text', author: { id: 'author', username: 'author', displayName: 'Author' } };
beforeEach(() => { Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true }); state.insert.mockReset().mockResolvedValue({ error: null }); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } }); Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn().mockResolvedValue(undefined) }); });
afterEach(cleanup);
const open = () => { render(<QueryClientProvider client={new QueryClient()}><ReplyShare comment={comment} currentUserId="viewer" /></QueryClientProvider>); fireEvent.click(screen.getByRole('button', { name: '返信を共有' })); };
describe('reply sharing', () => {
  it('copies the selected reply URL rather than the root URL', async () => {
    open(); fireEvent.click(screen.getByRole('button', { name: 'リンクをコピー' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringMatching(/\/post\/root\?reply=child$/)));
  });
  it('uses the reply title and URL for native sharing', async () => {
    open(); fireEvent.click(screen.getByRole('button', { name: 'その他の方法でポストを送信' }));
    await waitFor(() => expect(navigator.share).toHaveBeenCalledWith({ title: 'Authorさんの返信', text: 'Authorさんの返信: reply text', url: expect.stringMatching(/\/post\/root\?reply=child$/) }));
  });
  it('preserves the selected reply URL in LimeDrop without root-post redirection', async () => {
    open(); fireEvent.click(screen.getByRole('button', { name: 'LimeDropで送信' }));
    fireEvent.click(await screen.findByRole('button', { name: /Friend/ }));
    await waitFor(() => expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({ post_id: null, post_url: expect.stringMatching(/\/post\/root\?reply=child$/), post_author_id: 'author', recipient_id: 'recipient' })));
  });
});
