import { supabase } from './supabase';

export type ExternalProvider = 'bluesky' | 'misskey';
type ExternalAccount = { provider: ExternalProvider; handle: string };
let owner: string | null = null;
let accounts: ExternalAccount[] = [];
let generation = 0;
let revision = 0;
let loading: Promise<void> | null = null;

function notify() {
  window.dispatchEvent(new Event('lime-bluesky-handles-changed'));
  window.dispatchEvent(new Event('lime-misskey-changed'));
}
export function setExternalAccountOwner(id: string | null) {
  if (owner === id) return;
  owner = id; accounts = []; loading = null; generation++; revision++;
  notify();
}
export function cloudExternalHandles(provider: ExternalProvider): string[] | null {
  return owner ? accounts.filter(row => row.provider === provider).map(row => row.handle) : null;
}
function legacyAccounts(): ExternalAccount[] {
  const rows: ExternalAccount[] = [];
  for (const provider of ['bluesky', 'misskey'] as const) {
    try {
      const values: unknown = JSON.parse(localStorage.getItem(`lime_${provider}_author_handles`) ?? '[]');
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        if (typeof value !== 'string') continue;
        const handle = value.trim().replace(/^@+/, '').replace(/\/$/, '').toLowerCase();
        if (!handle || handle.length > 253 || /[\s/]/.test(handle)) continue;
        if (provider === 'misskey' && !/^[^@]+@[^@]+$/.test(handle)) continue;
        if (!rows.some(row => row.provider === provider && row.handle === handle)) rows.push({ provider, handle });
      }
    } catch { /* Invalid legacy data should not prevent loading cloud data. */ }
  }
  return rows;
}
async function refresh(id: string, version: number) {
  const readRevision = revision;
  const { data, error } = await supabase.from('external_account_users').select('provider,handle')
    .eq('user_id', id).order('created_at', { ascending: true }).order('handle');
  if (error) throw error;
  if (owner !== id || generation !== version || revision !== readRevision) return;
  const next = (data ?? []) as ExternalAccount[];
  if (accounts.length === next.length && accounts.every((row, index) => row.provider === next[index].provider && row.handle === next[index].handle)) return;
  accounts = next;
  notify();
}
export async function initialiseExternalAccounts(): Promise<void> {
  if (!owner) throw new Error('ログインしてください');
  if (loading) return loading;
  const id = owner, version = generation, legacy = legacyAccounts();
  const promise = (async () => {
    // A server-side marker makes import one-time across ALL devices. A removed
    // account cannot return because another browser still has an old local list.
    const { error } = await supabase.rpc('import_external_account_users', { legacy });
    if (error) throw error;
    if (owner !== id || generation !== version) return;
    await refresh(id, version);
    if (owner !== id || generation !== version) return;
    for (const provider of ['bluesky', 'misskey']) {
      try { localStorage.removeItem(`lime_${provider}_author_handles`); } catch { /* Optional legacy cleanup. */ }
    }
  })();
  loading = promise;
  try { await promise; }
  catch (error) { if (loading === promise) loading = null; throw error; }
}
export async function refreshExternalAccounts() {
  await initialiseExternalAccounts();
  if (owner) await refresh(owner, generation);
}
export async function setExternalAccountAdded(provider: ExternalProvider, handle: string, added: boolean) {
  const id = owner, version = generation;
  if (!id) throw new Error('ログインしてください');
  await initialiseExternalAccounts();
  if (owner !== id || generation !== version) throw new Error('アカウントが切り替わりました');
  const normal = handle.trim().replace(/^@+/, '').replace(/\/$/, '').toLowerCase();
  if (!normal || normal.length > 253 || /[\s/]/.test(normal)) throw new Error('ユーザー名が正しくありません');
  const result = added
    ? await supabase.from('external_account_users').upsert({ user_id: id, provider, handle: normal }, { onConflict: 'user_id,provider,handle', ignoreDuplicates: true })
    : await supabase.from('external_account_users').delete().eq('user_id', id).eq('provider', provider).eq('handle', normal);
  if (result.error) throw result.error;
  if (owner !== id || generation !== version) return;
  revision++;
  accounts = accounts.filter(row => row.provider !== provider || row.handle !== normal);
  if (added) accounts.push({ provider, handle: normal });
  notify();
}
export async function saveExternalProviderHandles(provider: ExternalProvider, handles: string[]): Promise<string[]> {
  await initialiseExternalAccounts();
  const previous = cloudExternalHandles(provider) ?? [];
  const next = [...new Set(handles.map(handle => handle.trim().replace(/^@+/, '').toLowerCase()).filter(Boolean))];
  for (const handle of previous) if (!next.includes(handle)) await setExternalAccountAdded(provider, handle, false);
  for (const handle of next) if (!previous.includes(handle)) await setExternalAccountAdded(provider, handle, true);
  return cloudExternalHandles(provider) ?? [];
}
