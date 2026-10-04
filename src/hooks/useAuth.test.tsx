import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { getSavedAccountTokens, readSavedAccounts, saveAccountSession } from '@/lib/savedAccounts';

const mock = vi.hoisted(() => ({ callback: null as null | ((event: string, session: Session | null) => void), from: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), setSession: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: { onAuthStateChange: mock.subscribe, signOut: mock.signOut, setSession: mock.setSession }, from: mock.from,
} }));
import { AuthProvider, useAuth } from './useAuth';
let currentAuth: ReturnType<typeof useAuth>;
function Probe() { const auth = useAuth(); currentAuth=auth; return <><div>{auth.user?.displayName || 'signed out'}</div><input aria-label="draft" defaultValue="" /></>; }
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  mock.subscribe.mockImplementation(callback => { mock.callback = callback; return { data: { subscription: { unsubscribe: mock.unsubscribe } } }; });
  mock.signOut.mockImplementation(async()=>{mock.callback?.('SIGNED_OUT',null);return {error:null};});
  mock.setSession.mockReset();
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

const otherSession={...session,user:{...session.user,id:'bob',user_metadata:{display_name:'Bob'}},access_token:'bob-access',refresh_token:'bob-refresh'} as Session;
function mountAccounts() {
  saveAccountSession(otherSession);
  const client=new QueryClient();
  render(<QueryClientProvider client={client}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>);
  act(()=>mock.callback?.('INITIAL_SESSION',session));
  return client;
}
it('switches using the saved tokens, remounts drafts and clears the previous viewer cache',async()=>{
  const client=mountAccounts();
  client.setQueryData(['private'],{body:'private to original account'});
  (screen.getByLabelText('draft') as HTMLInputElement).value='old draft';
  mock.setSession.mockImplementation(async()=>{mock.callback?.('SIGNED_IN',otherSession);return {data:{session:otherSession},error:null};});
  await act(async()=>{await currentAuth.switchAccount('bob');});
  expect(mock.setSession).toHaveBeenCalledWith({access_token:'bob-access',refresh_token:'bob-refresh'});
  expect(currentAuth.user?.id).toBe('bob');
  expect(client.getQueryData(['private'])).toBeUndefined();
  expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('');
  expect(getSavedAccountTokens(session.user.id)?.access_token).toBe('fixture');
});
it('restores the original account after the SDK signs it out for a revoked target refresh token',async()=>{
  mountAccounts();
  mock.setSession.mockImplementationOnce(async()=>{mock.callback?.('SIGNED_OUT',null);return {data:{session:null},error:{status:400}};})
    .mockImplementationOnce(async()=>{mock.callback?.('SIGNED_IN',session);return {data:{session},error:null};});
  await act(async()=>{await expect(currentAuth.switchAccount('bob')).rejects.toThrow('再ログイン');});
  expect(currentAuth.user?.id).toBe(session.user.id);
  expect(getSavedAccountTokens(session.user.id)).not.toBeNull();
  expect(getSavedAccountTokens('bob')).toBeNull();
  expect(readSavedAccounts().find(account=>account.id==='bob')?.needsLogin).toBe(true);
});
it('retains saved credentials on transient network errors and rejects overlapping switches',async()=>{
  mountAccounts();
  let finish!: (result:unknown)=>void;
  mock.setSession.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  let pending!: Promise<void>;
  act(()=>{pending=currentAuth.switchAccount('bob');});
  await expect(currentAuth.switchAccount('bob')).rejects.toThrow('切り替えています');
  expect(mock.setSession).toHaveBeenCalledOnce();
  await act(async()=>{finish({data:{session:null},error:{status:0}});await expect(pending).rejects.toThrow('通信状態');});
  expect(currentAuth.user?.id).toBe(session.user.id);
  expect(getSavedAccountTokens('bob')).not.toBeNull();
});
it('clears the authenticated UI when both the target and original sessions are invalid',async()=>{
  const client=mountAccounts();client.setQueryData(['private'],{body:'restricted post'});
  mock.setSession.mockImplementation(async()=>{mock.callback?.('SIGNED_OUT',null);return {data:{session:null},error:{status:400}};});
  await act(async()=>{await expect(currentAuth.switchAccount('bob')).rejects.toThrow('ログイン状態を復元できませんでした');});
  expect(currentAuth.user).toBeNull();expect(currentAuth.session).toBeNull();
  expect(client.getQueryData(['private'])).toBeUndefined();
  expect(getSavedAccountTokens(session.user.id)).toBeNull();
});
it('refreshes persisted tokens and logs out only the active session',async()=>{
  mountAccounts();
  act(()=>mock.callback?.('TOKEN_REFRESHED',{...session,refresh_token:'rotated-refresh'}));
  expect(getSavedAccountTokens(session.user.id)?.refresh_token).toBe('rotated-refresh');
  await act(async()=>{await currentAuth.logout();});
  expect(mock.signOut).toHaveBeenCalledWith({scope:'local'});
  expect(readSavedAccounts().map(account=>account.id)).toEqual(['bob']);
});

it('opens an expired local session in an offline PWA without waiting for token refresh',()=>{
 vi.spyOn(navigator,'onLine','get').mockReturnValue(false);
 Object.defineProperty(navigator,'standalone',{configurable:true,value:true});
 const project=new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split('.')[0];
 localStorage.setItem(`sb-${project}-auth-token`,JSON.stringify({...session,expires_at:1}));
 render(<QueryClientProvider client={new QueryClient()}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>);
 expect(screen.getByText('Metadata Name')).toBeTruthy();expect(currentAuth.user?.id).toBe('test-user');
 act(()=>mock.callback?.('INITIAL_SESSION',null));expect(currentAuth.user?.id).toBe('test-user');
 act(()=>mock.callback?.('SIGNED_OUT',null));expect(currentAuth.user).toBeNull();
 Object.defineProperty(navigator,'standalone',{configurable:true,value:false});vi.restoreAllMocks();
});
