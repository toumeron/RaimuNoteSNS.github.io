import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  inserted: null as Record<string, unknown> | null,
  error: null as Error | null,
  count: 1 as number | null,
  userId: 'viewer' as string | null,
  pages: null as Record<string, unknown>[][] | null,
  cursors: [] as string[],
  uploads: vi.fn(), updates: vi.fn(),
}));
vi.mock('@/lib/currentUser', () => ({ getCurrentUserId: async () => state.userId }));
vi.mock('@/lib/uploadCommentImages', () => ({ uploadCommentImages: state.uploads }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => {
  let operation = 'read', head = false;
  const row = () => ({ id: 'reply', ...state.inserted, created_at: '2026-10-02T00:00:00Z', profiles: { id: 'viewer', username: 'viewer', display_name: 'Viewer' } });
  const builder = {
    insert: (input: Record<string, unknown>) => { state.inserted = input; operation = 'insert'; return builder; },
    select: (_columns: string, options?: { head?: boolean }) => { head = !!options?.head; return builder; },
    eq: () => builder,
    order: () => builder,
    range: () => builder,
    or: (value: string) => { state.cursors.push(value); return builder; },
    update: (input: unknown) => { state.updates(input); return builder; },
    single: () => builder,
    then: (resolve: (value: unknown) => void) => Promise.resolve({
      error: operation === 'insert' ? state.error : null,
      data: table === 'comments' ? operation === 'insert' ? { id: 'reply' } : head ? null : state.pages ? state.pages.shift() : row() : null,
      count: state.count,
    }).then(resolve),
  };
  return builder;
} } }));
import { createComment, getCommentsByPost } from './comments';
beforeEach(() => {
  state.inserted = null; state.error = null; state.count = 1; state.userId = 'viewer';
  state.pages = null; state.cursors = [];
  state.updates.mockReset(); state.uploads.mockReset().mockResolvedValue(['https://example.com/image.png']);
});
describe('reply persistence', () => {
  it('loads threads beyond the API response cap without dropping ancestors', async () => {
    const row = (i: number) => ({ id: String(i), post_id: 'original', user_id: 'author', content: 'reply', created_at: '2026-10-02T00:00:00Z', profiles: { id: 'author' } });
    state.pages = [Array.from({ length: 1000 }, (_, i) => row(i)), [row(1000)]];
    expect(await getCommentsByPost('original')).toHaveLength(1001);
    expect(state.cursors).toEqual(['created_at.gt.2026-10-02T00:00:00Z,and(created_at.eq.2026-10-02T00:00:00Z,id.gt.999)']);
  });
  it('stores the original post and selected reply parent separately', async () => {
    const result = await createComment('original', { content: ' reply ', parentCommentId: 'parent-reply', imageUrls: ['blob:preview'] });
    expect(state.inserted).toEqual({ post_id: 'original', user_id: 'viewer', content: 'reply', parent_comment_id: 'parent-reply', image_urls: ['https://example.com/image.png'], client_name: 'LimeNote for Web' });
    expect(result).toMatchObject({ postId: 'original', parentCommentId: 'parent-reply', imageUrls: ['https://example.com/image.png'], clientName: 'LimeNote for Web' });
  });
  it('records the posting device and returns it for the detail display', async () => {
    const agent = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla iPhone OS 18 like Mac OS X');
    try {
      const comment = await createComment('original', 'device reply');
      expect(state.inserted?.client_name).toBe('LimeNote for iPhone');
      expect(comment.clientName).toBe('LimeNote for iPhone');
    } finally { agent.mockRestore(); }
  });
  it('allows an image-only reply', async () => {
    await createComment('original', { content: '', imageUrls: ['blob:preview'] });
    expect(state.inserted?.content).toBe('');
  });
  it('keeps text-only callers compatible', async () => {
    state.uploads.mockResolvedValue([]);
    await createComment('original', 'text');
    expect(state.inserted).toMatchObject({ parent_comment_id: null, image_urls: [], content: 'text' });
  });
  it('does not insert a reply if an image upload fails', async () => {
    state.uploads.mockRejectedValue(new Error('upload failed'));
    await expect(createComment('original', { content: 'reply', imageUrls: ['blob:preview'] })).rejects.toThrow('upload failed');
    expect(state.inserted).toBeNull();
  });
  it('rejects blank and oversized replies before upload', async () => {
    await expect(createComment('original', ' ')).rejects.toThrow();
    await expect(createComment('original', 'a'.repeat(281))).rejects.toThrow();
    expect(state.uploads).not.toHaveBeenCalled();
  });
  it('does not overwrite the post reply count with zero when counting fails', async () => {
    state.count = null;
    await createComment('original', 'reply');
    expect(state.updates).not.toHaveBeenCalled();
  });
});
