import { describe, expect, it, vi } from 'vitest';
import { sendLimeDrop } from './supabase';
const sender = '11111111-1111-4111-8111-111111111111';
const recipient = '22222222-2222-4222-8222-222222222222';
const payload = { sender_id: sender, recipient_id: recipient, post_id: sender, post_author_id: recipient,
  post_url: 'https://example.com/post/native', post_author_username: 'artist', post_author_display_name: 'Artist',
  post_text: '共有する投稿', status: 'pending' as const };
describe('LimeDrop persistence', () => {
  it.each(['misskey:note', 'twitter:12345', 'bsky:at://did:plc:artist/post/one', 'reply:123'])('shares %s through the URL without invalid UUID foreign keys', async id => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
    await sendLimeDrop({ ...payload, post_id: id, post_author_id: 'remote:artist' }, { from } as any);
    expect(from).toHaveBeenCalledWith('lime_drops');
    expect(insert).toHaveBeenCalledWith({ ...payload, post_id: null, post_author_id: null });
  });
  it('retains native post and author references', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    await sendLimeDrop(payload, { from: () => ({ insert }) } as any);
    expect(insert).toHaveBeenCalledWith(payload);
  });
  it('propagates a rejected insert instead of reporting delivery', async () => {
    const error = { code: '42501', message: 'permission denied' };
    await expect(sendLimeDrop(payload, { from: () => ({ insert: async () => ({ error }) }) } as any)).rejects.toEqual(error);
  });
});
