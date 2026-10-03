import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';

const mock = vi.hoisted(() => ({ callback: null as null | ((event: string, session: Session | null) => void), from: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: { onAuthStateChange: mock.subscribe, signOut: vi.fn() }, from: mock.from,
} }));
import { AuthProvider, useAuth } from './useAuth';
function Probe() { const auth = useAuth(); return <div>{auth.user?.displayName || 'signed out'}</div>; }
beforeEach(() => {
  vi.useFakeTimers();
  mock.subscribe.mockImplementation(callback => { mock.callback = callback; return { data: { subscription: { unsubscribe: mock.unsubscribe } } }; });
  mock.from.mockReturnValue({ select: () => ({ eq: () => ({ single: async () => ({ data: { username: 'profile', display_name: 'Profile Name' }, error: null }) }) }) });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
const session = { user: { id: 'test-user', email: 'test@example.invalid', user_metadata: { display_name: 'Metadata Name' } }, access_token: 'fixture', refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600 } as unknown as Session;
it('defers profile requests until the auth callback returns and keeps one subscription', async () => {
  render(<QueryClientProvider client={new QueryClient()}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>);
  act(() => mock.callback?.('INITIAL_SESSION', session));
  expect(screen.getByText('Metadata Name')).toBeTruthy();
  expect(mock.from).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByText('Profile Name')).toBeTruthy();
  expect(mock.subscribe).toHaveBeenCalledOnce();
  act(() => mock.callback?.('TOKEN_REFRESHED', session));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(mock.subscribe).toHaveBeenCalledOnce();
  expect(mock.from).toHaveBeenCalledOnce();
  act(() => mock.callback?.('SIGNED_OUT', null));
  expect(screen.getByText('signed out')).toBeTruthy();
});

it('clears cached restricted posts when accounts change but retains them on token refresh', () => {
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>);
  act(() => mock.callback?.('INITIAL_SESSION', session));
  client.setQueryData(['feed', 'all'], { content: 'restricted post' });
  act(() => mock.callback?.('TOKEN_REFRESHED', session));
  expect(client.getQueryData(['feed', 'all'])).toBeDefined();
  act(() => mock.callback?.('SIGNED_IN', { ...session, user: { ...session.user, id: 'another-user' } }));
  expect(client.getQueryData(['feed', 'all'])).toBeUndefined();
});
