import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  count: 7 as number | null,
  error: null as Error | null,
  handlers: [] as { kind: string; table?: string; callback: (payload: unknown) => void }[],
  statuses: [] as ((status: string) => void)[],
  pending: null as Promise<{ count: number; error: null }> | null,
  removed: vi.fn(),
}));
vi.mock('@/lib/currentUser', () => ({ getCurrentUserId: async () => 'viewer' }));
vi.mock('@/hooks/useIsPWA', () => ({ useIsPWA: () => false }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: () => {
    let head = false;
    const builder = {
      select: (_: string, options?: { head?: boolean }) => { head = Boolean(options?.head); return builder; },
      eq: () => builder, match: () => builder, maybeSingle: () => builder,
      upsert: () => builder, delete: () => builder,
      then: (resolve: (value: unknown) => void) => {
        if (head && db.pending) { const pending = db.pending; db.pending = null; return pending.then(resolve); }
        return Promise.resolve(head ? { count: db.count, error: db.error } : { data: null, error: null }).then(resolve);
      },
    };
    return builder;
  },
  channel: () => {
    const channel = {
      on: (kind: string, config: { table?: string }, callback: (payload: unknown) => void) => {
        db.handlers.push({ kind, table: config.table, callback }); return channel;
      },
      subscribe: (callback?: (status: string) => void) => { if (callback) db.statuses.push(callback); return channel; },
      send: async () => undefined,
    };
    return channel;
  },
  removeChannel: (...args: unknown[]) => db.removed(...args),
} }));
import { LikeButton } from './LikeButton';

function mount(id = 'post-one', count = 0) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['feed', 'all'], { pages: [[{ id, likesCount: count }]], pageParams: [0] });
  const view = render(<QueryClientProvider client={client}><LikeButton postId={id} liked={false} count={count} /></QueryClientProvider>);
  return { client, ...view, change: (nextId: string, nextCount: number) => view.rerender(
    <QueryClientProvider client={client}><LikeButton postId={nextId} liked={false} count={nextCount} /></QueryClientProvider>,
  ) };
}
async function expectCount(count: number) {
  await waitFor(() => {
    const text = screen.getByRole('button').querySelector('.twitter-like-count-static')?.textContent;
    expect(text).toBe(count > 0 ? String(count) : '');
  });
}
function event(table: string, payload: unknown = {}) {
  const handler = db.handlers.find(handler => handler.table === table);
  if (!handler) throw new Error(`Missing subscription for ${table}`);
  act(() => handler.callback(payload));
}
beforeEach(() => { db.count = 7; db.error = null; db.handlers = []; db.statuses = []; db.pending = null; db.removed.mockClear(); });
afterEach(cleanup);

describe('live like counts without UI changes', () => {
  it('fetches actual count on mount and updates feed cache', async () => {
    const { client } = mount();
    await expectCount(7);
    expect(client.getQueryData(['feed', 'all'])).toMatchObject({ pages: [[{ likesCount: 7 }]] });
  });
  it('does not replace a live count with stale zero props', async () => {
    const view = mount('post-one', 1);
    await expectCount(7);
    view.change('post-one', 0);
    await expectCount(7);
  });
  it('fetches exact count on post updates with null/stale stored count', async () => {
    mount(); await expectCount(7);
    db.count = 8;
    event('posts', { new: { likes_count: null } });
    await expectCount(8);
  });
  it('follows inserts and deletes including a legitimate zero', async () => {
    mount(); await expectCount(7);
    db.count = 8; event('likes', { eventType: 'INSERT' }); await expectCount(8);
    db.count = 0; event('likes', { eventType: 'DELETE' }); await expectCount(0);
  });
  it('resyncs on reconnect to recover missed events', async () => {
    mount(); await expectCount(7);
    db.count = 12; act(() => db.statuses.forEach(callback => callback('SUBSCRIBED')));
    await expectCount(12);
  });
  it('retains count when a count request fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mount(); await expectCount(7);
    db.count = null; db.error = new Error('offline'); event('likes');
    await waitFor(() => expect(log).toHaveBeenCalled()); await expectCount(7);
    log.mockRestore();
  });
  it('ignores null broadcasts instead of treating them as zero', async () => {
    mount(); await expectCount(7);
    act(() => db.handlers.find(handler => handler.kind === 'broadcast')!.callback({ payload: { count: null } }));
    await expectCount(7);
  });
  it('ignores an older response that arrives after a newer real-time update', async () => {
    mount(); await expectCount(7);
    let finish!: (value: { count: number; error: null }) => void;
    db.pending = new Promise(resolve => { finish = resolve; });
    event('likes');
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    db.count = 9; event('likes'); await expectCount(9);
    await act(async () => { finish({ count: 0, error: null }); });
    await expectCount(9);
  });
  it('refreshes the count after unmounting and remounting a card', async () => {
    const view = mount(); await expectCount(7); view.unmount();
    expect(db.removed).toHaveBeenCalledTimes(3);
    db.count = 10; mount(); await expectCount(10);
  });
  it('does not apply a previous post response after the target changes', async () => {
    const view = mount(); await expectCount(7);
    let finish!: (value: { count: number; error: null }) => void;
    db.pending = new Promise(resolve => { finish = resolve; });
    event('likes');
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    db.count = 3; view.change('post-two', 0); await expectCount(3);
    await act(async () => { finish({ count: 50, error: null }); });
    await expectCount(3);
  });
  it('accepts broadcasts without allowing an older count response to undo them', async () => {
    mount(); await expectCount(7);
    let finish!: (value: { count: number; error: null }) => void;
    db.pending = new Promise(resolve => { finish = resolve; }); event('likes');
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    act(() => db.handlers.find(handler => handler.kind === 'broadcast')!.callback({ payload: { count: 11 } }));
    await expectCount(11);
    await act(async () => { finish({ count: 0, error: null }); }); await expectCount(11);
  });
  it('preserves optimistic click and confirms it with the live count', async () => {
    mount(); await expectCount(7);
    db.count = 8; fireEvent.click(screen.getByRole('button'));
    await expectCount(8);
  });
});

describe('review persistence using the existing like design', () => {
  it('uses the supplied persistence without subscribing to post likes', async () => {
    const persistLike = vi.fn(async () => ({liked:true,count:1}));
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><LikeButton postId="review-one" liked={false} count={0} persistLike={persistLike}/></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button',{name:/^いいね$/}));
    await waitFor(()=>expect(persistLike).toHaveBeenCalledWith(true));
    await expectCount(1);
    expect(db.handlers).toHaveLength(0);
    expect(screen.getByRole('button',{name:'いいねを取り消す'})).toHaveClass('text-pink-500');
  });
  it('restores the previous state when review persistence fails', async () => {
    const persistLike = vi.fn(async () => {throw new Error('unavailable');});
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><LikeButton postId="review-one" liked={false} count={2} persistLike={persistLike}/></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button',{name:/^いいね$/}));
    await waitFor(()=>expect(persistLike).toHaveBeenCalled());
    await expectCount(2);
    expect(screen.getByRole('button',{name:/^いいね$/})).not.toHaveClass('text-pink-500');
  });
});
