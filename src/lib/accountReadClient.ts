import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSavedAccountTokens, saveAccountSession } from './savedAccounts';
import { createPrivateMediaFetch } from './privateMediaFetch';
export type AccountReadContext = { client: SupabaseClient; userId: string; signal?: AbortSignal };
const pending = new Map<string, Promise<SupabaseClient>>();
const readers = new Map<string, {client:SupabaseClient; accessToken:string; expiresAt:number}>();
/** Authenticate reads without replacing the application's active session. */
export async function getAccountReadClient(userId: string): Promise<SupabaseClient> {
  const saved = getSavedAccountTokens(userId);
  if (!saved) { readers.delete(userId); throw new Error('アカウントに再度ログインしてください'); }
  const cached = readers.get(userId);
  if (cached?.accessToken === saved.access_token && cached.expiresAt > Date.now() + 30_000) return cached.client;
  const existing = pending.get(userId);
  if (existing) return existing;
  const job = (async () => {
    const tokens = getSavedAccountTokens(userId);
    if (!tokens) throw new Error('アカウントに再度ログインしてください');
    const client = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
      global: { fetch: createPrivateMediaFetch(import.meta.env.VITE_SUPABASE_URL) },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `lime-account-read-${userId}` },
    });
    const { data, error } = await client.auth.setSession(tokens);
    if (error || data.session?.user.id !== userId) throw error ?? new Error('アカウントを確認できません');
    const current = getSavedAccountTokens(userId);
    if (!current || (current.refresh_token !== tokens.refresh_token && current.refresh_token !== data.session.refresh_token)) throw new Error('アカウントの認証が変更されました');
    if (current.refresh_token === tokens.refresh_token && data.session.refresh_token !== tokens.refresh_token) saveAccountSession(data.session);
    readers.set(userId, {client,accessToken:data.session.access_token,expiresAt:(data.session.expires_at ?? 0)*1000});
    return client;
  })();
  pending.set(userId, job);
  try { return await job; } finally { if (pending.get(userId) === job) pending.delete(userId); }
}
