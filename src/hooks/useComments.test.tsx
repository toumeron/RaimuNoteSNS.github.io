import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CommentWithAuthor } from '@/types';
const db = vi.hoisted(() => ({
  comments: [] as CommentWithAuthor[],
  handlers: [] as { event: string; table: string; filter?: string; callback: () => void }[],
  reads: vi.fn(), removed: vi.fn(),
  statuses: [] as ((status: string) => void)[],
}));
vi.mock('@/api/comments', () => ({ getCommentsByPost: async () => { db.reads(); return db.comments.map(c => ({ ...c })); }, createComment: vi.fn() }));
vi.mock('@/lib/currentUser', () => ({ getCurrentUserId: async () => 'viewer' }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const builder = {
      select: () => builder, in: () => builder,
      then: (resolve: (value: unknown) => void) => Promise.resolve({ data: table === 'profiles' ? [{ id: 'author', username: 'author' }] : [], error: null }).then(resolve),
    };
    return builder;
  },
  channel: () => {
    const channel = { on: (_kind: string, config: { event: string; table: string; filter?: string }, callback: () => void) => { db.handlers.push({ ...config, callback }); return channel; }, subscribe: (callback: (status: string) => void) => { db.statuses.push(callback); return channel; } };
    return channel;
  },
  removeChannel: db.removed,
} }));
import { useComments } from './useComments';
const comment = (id: string, parentCommentId: string | null) => ({ id, postId: 'original', parentCommentId, content: id, userId: 'author', createdAt: '', imageUrls: ['https://example.com/image.png'], author: { id: 'author', username: 'author' } } as CommentWithAuthor);
beforeEach(() => {
  db.comments = [comment('first', null), comment('second', 'first'), comment('third', 'second')];
  db.handlers = []; db.statuses = []; db.reads.mockClear(); db.removed.mockClear();
});
afterEach(cleanup);
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => ({ ...useComments('original') }), { wrapper });
}
describe('live reply threads', () => {
  it('counts immediate replies per comment while retaining attachment metadata', async () => {
    const view = mount(); await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(view.result.current.data?.map(c => c.commentsCount)).toEqual([1, 1, 0]);
    expect(view.result.current.data?.[2]).toMatchObject({ parentCommentId: 'second', imageUrls: ['https://example.com/image.png'] });
  });
  it('refreshes replies and counts on a live insertion', async () => {
    const view = mount(); await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    db.comments.push(comment('fourth', 'second'));
    const handler = db.handlers.find(h => h.table === 'comments' && h.event === 'INSERT')!;
    expect(handler.filter).toBe('post_id=eq.original');
    act(() => handler.callback());
    await waitFor(() => expect(view.result.current.data?.find(c => c.id === 'second')?.commentsCount).toBe(2));
  });
  it('refreshes deleted replies without a filter that DELETE cannot satisfy', async () => {
    const view = mount(); await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    db.comments = db.comments.filter(c => c.id !== 'third');
    const handler = db.handlers.find(h => h.table === 'comments' && h.event === 'DELETE')!;
    expect(handler.filter).toBeUndefined();
    act(() => handler.callback());
    await waitFor(() => expect(view.result.current.data).toHaveLength(2));
    expect(view.result.current.data?.find(c => c.id === 'second')?.commentsCount).toBe(0);
  });
  it('preserves profile updates and releases its live channel on unmount', async () => {
    const view = mount(); await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(db.handlers.some(h => h.table === 'profiles' && h.event === 'UPDATE')).toBe(true);
    view.unmount(); expect(db.removed).toHaveBeenCalledTimes(1);
  });
  it('resynchronizes replies missed while the live channel was disconnected', async () => {
    const view = mount(); await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    db.comments.push(comment('missed', 'third'));
    act(() => db.statuses[0]('SUBSCRIBED'));
    await waitFor(() => expect(view.result.current.data?.find(c => c.id === 'third')?.commentsCount).toBe(1));
  });
});
