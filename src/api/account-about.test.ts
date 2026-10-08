import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, rpc: vi.fn(), table: '', columns: '' }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: (table:string) => { state.table=table; const q = { select: (columns:string) => {state.columns=columns;return q;}, eq: () => q, maybeSingle: async () => ({ data: state.row, error: null }) }; return q; },
  rpc: state.rpc,
} }));
import { countryName, detectCountry, syncAccountConnection, getAccountAbout } from './account-about';
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubEnv('VITE_ACCOUNT_COUNTRY_LOOKUP_ENABLED', 'true');
  state.row = null; state.rpc.mockReset().mockResolvedValue({ error: null });
  fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
});
it('stores only country and client, discarding the IP and any extra response data', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ country: 'JP', ip: '192.0.2.1', location: [35, 139], city: 'Tokyo' }) });
  await syncAccountConnection('owner');
  expect(fetchMock).toHaveBeenCalledWith('https://api.country.is/', expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }));
  expect(state.rpc).toHaveBeenCalledWith('update_account_connection', { expected_user_id: 'owner', country: 'JP', client: expect.stringMatching(/^LimeNote for /) });
  expect(countryName('JP')).toBe('日本');
});
it('does not guess country on invalid data or failed lookup', async () => {
  for (const country of ['Tokyo', 'jp', 'XX', null]) {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ country }) });
    expect(await detectCountry()).toBeNull();
  }
  fetchMock.mockResolvedValue({ ok: false });
  await expect(syncAccountConnection('owner')).rejects.toThrow();
  expect(state.rpc).not.toHaveBeenCalled();
  expect(countryName(null)).toBe('未取得');
});
it('avoids repeating country lookup within 24 hours', async () => {
  state.row = { connection_updated_at: new Date().toISOString() };
  expect(await syncAccountConnection('owner')).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
});
it('does not save after sign-out or switching away aborts the request', async () => {
  const controller = new AbortController();
  fetchMock.mockImplementation(async () => { controller.abort(); return { ok: true, json: async () => ({ country: 'JP' }) }; });
  expect(await syncAccountConnection('owner', controller.signal)).toBe(false);
  expect(state.rpc).not.toHaveBeenCalled();
});

it('does not contact the external service until its use is enabled', async () => {
  vi.stubEnv('VITE_ACCOUNT_COUNTRY_LOOKUP_ENABLED', '');
  expect(await detectCountry()).toBeNull();
  expect(await syncAccountConnection('owner')).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(state.rpc).not.toHaveBeenCalled();
});

it('reads account metadata from profiles instead of a separate table', async () => {
  await getAccountAbout('owner');
  expect(state.table).toBe('profiles');
  expect(state.columns).toContain('user_id:id');
  expect(state.columns).toContain('tracking_since:username_tracking_since');
  expect(state.columns).not.toContain('bot_prompt');
});
