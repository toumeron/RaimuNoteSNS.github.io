import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [] as any[], queries: 0, change: null as any, subscribed: null as any, remove: vi.fn(), viewer: 'recipient' as string | null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: state.viewer ? { id: state.viewer } : null }) }));
vi.mock('@/lib/supabase', async original => ({ ...await original<typeof import('@/lib/supabase')>(), supabase: {
  from: (table: string) => {
    if (table === 'profiles') return { select: () => ({ in: async () => ({ data: [{ id: 'sender', username: 'friend', display_name: 'Friend' }] }) }) };
    return {
      select: () => { const q: any = { eq: () => q, order: () => q, limit: async () => { state.queries++; return { data: state.rows.slice(0, 5), error: null }; } }; return q; },
      update: () => { let id = ''; const q: any = { eq: asyncOrChain }; function asyncOrChain(key: string, value: string) { if (key === 'id') { id = value; return q; } state.rows = state.rows.filter(row => row.id !== id); return Promise.resolve({ error: null }); } return q; },
    };
  },
  channel: () => { const c: any = { on: (_: any, __: any, callback: any) => { state.change = callback; return c; }, subscribe: (callback: any) => { state.subscribed = callback; return c; } }; return c; },
  removeChannel: state.remove,
} }));
import { LimeDropReceiver } from './App';
const drop = (id: string) => ({ id, sender_id: 'sender', recipient_id: 'recipient', status: 'pending', post_id: null, post_url: `${window.location.origin}/post/root?reply=${id}`, post_text: `text-${id}`, created_at: '2026-10-22' });
const Location = () => <output data-testid="location">{useLocation().pathname}{useLocation().search}</output>;
beforeEach(() => { state.rows = []; state.queries = 0; state.viewer = 'recipient'; state.remove.mockClear(); });
afterEach(cleanup);
const open = () => render(<MemoryRouter><LimeDropReceiver/><Location/></MemoryRouter>);
it('recovers missed deliveries on subscription, reconnect and foreground events without a timer', async () => {
  open(); await waitFor(() => expect(state.queries).toBe(1));
  state.rows = [drop('one')]; act(() => state.subscribed('SUBSCRIBED'));
  await screen.findByText('text-one');
  state.rows = [drop('two')]; fireEvent(window, new Event('online')); await screen.findByText('text-two');
  state.rows = [drop('three')]; fireEvent(window, new Event('focus')); await screen.findByText('text-three');
  state.rows = [drop('four')]; fireEvent(document, new Event('visibilitychange')); await screen.findByText('text-four');
});
it('refills the five-item batch and retains reply routing when accepting', async () => {
  state.rows = Array.from({ length: 7 }, (_, i) => drop(String(i)));
  open(); await screen.findByText('text-0');
  for (let i = 0; i < 6; i++) {
    fireEvent.click(screen.getAllByRole('button', { name: '辞退' })[0]);
    await screen.findByText(`text-${i + 1}`);
    await waitFor(() => expect(screen.getAllByRole('button', { name: '受け入れる' })[0]).not.toBeDisabled());
  }
  fireEvent.click(screen.getAllByRole('button', { name: '受け入れる' })[0]);
  await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/post/root?reply=6'));
  expect(state.rows).toHaveLength(0);
});
it('refreshes from realtime events and releases the channel on unmount', async () => {
  const view = open(); await waitFor(() => expect(state.queries).toBe(1));
  state.rows = [drop('event')]; act(() => state.change({ new: state.rows[0] })); await screen.findByText('text-event');
  view.unmount(); expect(state.remove).toHaveBeenCalledOnce();
  const queries = state.queries; fireEvent(window, new Event('focus')); expect(state.queries).toBe(queries);
});
