vi.mock("@/components/layout/AppLayout", async importOriginal => {
 const actual = await importOriginal<typeof import("@/components/layout/AppLayout")>();
 const overrides = [
  await (() => ({ SavedAccountList: () => null }))(),
  await (() => ({ Logo: () => <span>LimeNote</span> }))()
 ];
 return Object.assign({}, actual, ...overrides.map(values => Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== actual[key]))));
});

vi.mock("@/lib/accountSuspension", async importOriginal => ({...await importOriginal<typeof import("@/lib/accountSuspension")>(), ...await importOriginal<object>(), returnToCompany: mocks.return}));
vi.mock("@/hooks/useAuth", async importOriginal => ({...await importOriginal<typeof import("@/hooks/useAuth")>(), useAuth: () => ({ user: mocks.user, loading: mocks.loading, accounts: [] })}));

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ return: vi.fn(), signIn: vi.fn(), getUser: vi.fn(), user: null as null | { id: string }, loading: false }));


vi.mock('@/lib/supabase', () => ({ supabase: { auth: { signInWithPassword: mocks.signIn, getUser: mocks.getUser } } }));


vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import AuthPage from './Auth';
beforeEach(() => {
 vi.clearAllMocks(); mocks.user = null; mocks.loading = false;
 mocks.signIn.mockResolvedValue({ error: null });
 mocks.getUser.mockImplementation(async () => ({ data: { user: mocks.user }, error: null }));
 vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const target = '/LimeNoteJP/company/profile/';
function show(extra = '') { return render(<MemoryRouter initialEntries={['/auth?returnTo='+encodeURIComponent(target)+extra]}><AuthPage /></MemoryRouter>); }
it('uses the existing login form and returns to the original company page after login', async () => {
 show();
 fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'fixture@example.invalid' } });
 fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'fixture-password' } });
 fireEvent.submit(screen.getByLabelText('メールアドレス').closest('form')!);
 await waitFor(() => expect(mocks.return).toHaveBeenCalledWith(window.location.origin+target));
});
it('returns automatically if the SNS session is already present', async () => {
 mocks.user = { id: 'me' }; show();
 await waitFor(() => expect(mocks.return).toHaveBeenCalledWith(window.location.origin+target));
 expect(mocks.signIn).not.toHaveBeenCalled();
});
it('does not redirect during session initialisation', () => {
 mocks.user = { id: 'me' }; mocks.loading = true; show();
 expect(mocks.return).not.toHaveBeenCalled();
});
it('keeps add-account mode available', () => {
 mocks.user = { id: 'me' }; show('&add=1');
 expect(mocks.return).not.toHaveBeenCalled();
});
it('does not redirect after failed password login', async () => {
 mocks.signIn.mockResolvedValue({ error: new Error('invalid') }); show();
 fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'fixture@example.invalid' } });
 fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'fixture-password' } });
 fireEvent.submit(screen.getByLabelText('メールアドレス').closest('form')!);
 await waitFor(() => expect(mocks.signIn).toHaveBeenCalled());
 expect(mocks.return).not.toHaveBeenCalled();
});
it('does not loop back to the company site for an invalid cached session', async () => {
 mocks.user = { id: 'me' };
 mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
 show();
 await waitFor(() => expect(mocks.getUser).toHaveBeenCalled());
 expect(mocks.return).not.toHaveBeenCalled();
});
