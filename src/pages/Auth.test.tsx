import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ signUp: vi.fn(), signIn: vi.fn(), upsert: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: { signUp: mocks.signUp, signInWithPassword: mocks.signIn },
  from: () => ({ upsert: mocks.upsert }),
} }));
vi.mock('@/components/layout/Logo', () => ({ Logo: () => <span>LimeNote</span> }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));
import AuthPage from './Auth';

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  mocks.signIn.mockResolvedValue({ error: null });
  mocks.signUp.mockResolvedValue({ data: { user: { id: 'fixture-user' } }, error: null });
  mocks.upsert.mockResolvedValue({ error: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

function renderForm(signup = false) {
  render(<MemoryRouter><AuthPage /></MemoryRouter>);
  if (signup) fireEvent.mouseDown(screen.getByRole('tab', { name: '新規登録' }), { button: 0, ctrlKey: false });
  fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'fixture@example.invalid' } });
  fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'fixture-password' } });
  if (signup) fireEvent.click(screen.getByRole('checkbox'));
}
function submitForm() { fireEvent.submit(screen.getByLabelText('メールアドレス').closest('form')!); }

it('keeps password login free of invitation fields and parameters', async () => {
  renderForm();
  expect(screen.queryByLabelText('招待コード')).toBeNull();
  submitForm();
  await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith({ email: 'fixture@example.invalid', password: 'fixture-password' }));
  expect(mocks.signUp).not.toHaveBeenCalled();
});

it('does not call signup without a code, even when form submission is forced', () => {
  renderForm(true);
  submitForm();
  expect(mocks.signUp).not.toHaveBeenCalled();
  expect(screen.getByText('招待コードを入力してください（128文字以内）')).toBeTruthy();
});

it('submits the entered code to server validation without embedding a correct value', async () => {
  renderForm(true);
  fireEvent.change(screen.getByLabelText('招待コード'), { target: { value: 'test-only-invitation' } });
  submitForm();
  await waitFor(() => expect(mocks.signUp).toHaveBeenCalledWith({
    email: 'fixture@example.invalid', password: 'fixture-password', options: { data: { invite_code: 'test-only-invitation' } },
  }));
  await waitFor(() => expect(mocks.success).toHaveBeenCalled());
  expect((screen.getByLabelText('招待コード') as HTMLInputElement).value).toBe('');
});

it('does not create a profile or report success when the server rejects signup', async () => {
  mocks.signUp.mockResolvedValue({ data: { user: null }, error: { message: 'Database error saving new user' } });
  renderForm(true);
  fireEvent.change(screen.getByLabelText('招待コード'), { target: { value: 'wrong' } });
  submitForm();
  await waitFor(() => expect(mocks.error).toHaveBeenCalled());
  expect(mocks.upsert).not.toHaveBeenCalled();
  expect(mocks.success).not.toHaveBeenCalled();
});
