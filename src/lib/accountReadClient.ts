import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSavedAccountTokens, saveAccountSession } from "@/lib/savedAccounts";
import { createPrivateMediaFetch } from "@/lib/privateMediaFetch";

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

export type AccountPage<T> = { buffer: T[]; next?: number; started: boolean };
export type MergedCursor<T> = { sources: Record<string, AccountPage<T>>; seen: string[] };
/** Merge ordered account streams before publishing a page, so later pages cannot jump above it. */
export async function mergeAccountPage<T>(ids: string[], previous: MergedCursor<T> | null, load: (id: string, offset: number) => Promise<{items: T[]; next?: number}>, compare: (a: T,b: T) => number, identity: (item: T) => string, limit: number, signal?: AbortSignal) {
  const sources = Object.fromEntries(ids.map(id => [id, previous?.sources[id]
    ? {...previous.sources[id], buffer: [...previous.sources[id].buffer]}
    : { buffer: [] as T[], next: 0, started: false }]));
  const seen = new Set(previous?.seen ?? []);
  const items: T[] = [];
  while (items.length < limit) {
    signal?.throwIfAborted();
    await Promise.all(ids.map(async id => {
      const source = sources[id];
      while (!source.buffer.length && source.next !== undefined) {
        const offset = source.next;
        const page = await load(id, offset);
        signal?.throwIfAborted();
        if (page.next !== undefined && page.next <= offset) throw new Error('読み込み位置が更新されませんでした');
        source.buffer = [...page.items].sort(compare);
        source.next = page.next; source.started = true;
      }
    }));
    const available = ids.filter(id => sources[id].buffer.length);
    if (!available.length) break;
    available.sort((a,b) => compare(sources[a].buffer[0],sources[b].buffer[0]) || a.localeCompare(b));
    const item = sources[available[0]].buffer.shift()!;
    const key = identity(item);
    if (!seen.has(key)) { seen.add(key); items.push(item); }
  }
  const hasNext = ids.some(id => sources[id].buffer.length || sources[id].next !== undefined);
  return { items, next: hasNext ? { sources, seen: [...seen] } as MergedCursor<T> : undefined };
}
