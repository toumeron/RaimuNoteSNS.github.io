import type { Session } from '@supabase/supabase-js';

export type SavedAccount = { id: string; username: string; displayName: string; avatarUrl: string; isOfficial?: boolean; isPrivate?: boolean; needsLogin: boolean };
type StoredAccount = Omit<SavedAccount, 'needsLogin'> & { accessToken?: string; refreshToken?: string };
const project = new URL(import.meta.env.VITE_SUPABASE_URL).hostname;
export const SAVED_ACCOUNTS_KEY = `lime_saved_accounts:${project}:v1`;
export const SAVED_ACCOUNTS_EVENT = 'lime-saved-accounts-changed';
const integrationKey = (id: string) => `lime_account_integrations:${project}:${id}`;
export const ACTIVE_ACCOUNT_KEY = `lime_active_account:${project}`;
const integrationKeys = ['lime_bluesky_session', 'lime_bluesky_author_handles', 'lime_misskey_author_handles'] as const;
let fallback: StoredAccount[] = [];

function readStoredAccounts(): StoredAccount[] {
  let raw: string | null;
  try { raw = localStorage.getItem(SAVED_ACCOUNTS_KEY); } catch { return fallback; }
  try {
    const data: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(data)) { fallback = []; return []; }
    const ids = new Set<string>();
    const accounts = data.filter((row): row is StoredAccount => {
      if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id) ||
        typeof row.username !== 'string' || typeof row.displayName !== 'string' || typeof row.avatarUrl !== 'string') return false;
      if ((row.accessToken != null && typeof row.accessToken !== 'string') || (row.refreshToken != null && typeof row.refreshToken !== 'string')) return false;
      ids.add(row.id);
      return true;
    });
    fallback = accounts;
    return accounts;
  } catch { fallback = []; return []; }
}
function writeAccounts(accounts: StoredAccount[]) {
  fallback = accounts;
  try { localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(accounts)); } catch { /* Keep this session usable when storage is unavailable. */ }
  window.dispatchEvent(new Event(SAVED_ACCOUNTS_EVENT));
}
export function readSavedAccounts(): SavedAccount[] {
  return readStoredAccounts().map(({ id, username, displayName, avatarUrl, isOfficial, accessToken, refreshToken }) =>
    ({ id, username, displayName, avatarUrl, ...(typeof isOfficial === 'boolean' ? { isOfficial } : {}), needsLogin: !accessToken || !refreshToken }));
}
export function saveAccountSession(session: Session, profile?: Partial<Pick<SavedAccount, 'username' | 'displayName' | 'avatarUrl' | 'isOfficial'>>) {
  const accounts = readStoredAccounts();
  const old = accounts.find(account => account.id === session.user.id);
  const meta = session.user.user_metadata;
  const emailName = session.user.email?.split('@')[0] ?? 'user';
  const account: StoredAccount = {
    id: session.user.id,
    username: profile?.username ?? old?.username ?? meta?.username ?? emailName,
    displayName: profile?.displayName ?? old?.displayName ?? meta?.display_name ?? meta?.displayName ?? emailName,
    avatarUrl: profile?.avatarUrl ?? old?.avatarUrl ?? meta?.avatar_url ?? meta?.avatarUrl ?? '',
    ...(profile?.isOfficial != null || old?.isOfficial != null ? { isOfficial: profile?.isOfficial ?? old?.isOfficial } : {}),
    accessToken: session.access_token, refreshToken: session.refresh_token,
  };
  const index = accounts.findIndex(row => row.id === account.id);
  if (index < 0) accounts.push(account); else accounts[index] = account;
  writeAccounts(accounts);
}
export function getSavedAccountTokens(id: string) {
  const account = readStoredAccounts().find(row => row.id === id);
  return account?.accessToken && account.refreshToken ? { access_token: account.accessToken, refresh_token: account.refreshToken } : null;
}
export function markSavedAccountNeedsLogin(id: string) {
  writeAccounts(readStoredAccounts().map(account => account.id === id ? { ...account, accessToken: undefined, refreshToken: undefined } : account));
}
export function removeSavedAccount(id: string) {
  writeAccounts(readStoredAccounts().filter(account => account.id !== id));
  try { localStorage.removeItem(integrationKey(id)); } catch { /* Optional local storage. */ }
}
export function activateAccountIntegrations(previousId: string | null | undefined, nextId: string | null) {
  if (previousId === nextId) return;
  try {
    const snapshot = () => Object.fromEntries(integrationKeys.map(key => [key, localStorage.getItem(key)]));
    const owner = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
    if (nextId && owner === nextId) {
      // The active integration values are newer than the last switch snapshot.
      // Reloads and auth callbacks in a second tab must not restore stale credentials.
      localStorage.setItem(integrationKey(nextId), JSON.stringify(snapshot()));
      return;
    }
    if (previousId && owner === previousId) localStorage.setItem(integrationKey(previousId), JSON.stringify(snapshot()));
    if (previousId === undefined && nextId && (!owner || owner === nextId) && !localStorage.getItem(integrationKey(nextId))) {
      // Adopt the already logged-in account's legacy browser settings once.
      localStorage.setItem(integrationKey(nextId), JSON.stringify(snapshot()));
    } else {
      const saved = nextId ? JSON.parse(localStorage.getItem(integrationKey(nextId)) ?? '{}') : {};
      for (const key of integrationKeys) {
        if (typeof saved?.[key] === 'string') localStorage.setItem(key, saved[key]);
        else localStorage.removeItem(key);
      }
    }
    if (nextId) localStorage.setItem(ACTIVE_ACCOUNT_KEY, nextId); else localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
  } catch {
    // If restoring settings fails, never leave another account's credentials active.
    for (const key of integrationKeys) { try { localStorage.removeItem(key); } catch { /* Storage disabled. */ } }
  }
  window.dispatchEvent(new Event('lime-misskey-changed'));
  window.dispatchEvent(new Event('lime-bluesky-session-changed'));
  window.dispatchEvent(new Event('lime-bluesky-handles-changed'));
}
