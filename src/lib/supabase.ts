import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createPrivateMediaFetch, createSupabaseReadFetch, createDevFunctionFetch } from "@/lib/privateMediaFetch";
import { getSavedAccountTokens, saveAccountSession } from "@/lib/savedAccounts";

// supabase
// src/lib/supabase.ts


const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const transport = import.meta.env.DEV && typeof window !== 'undefined'
  ? createDevFunctionFetch(supabaseUrl, new URL(`${import.meta.env.BASE_URL}__lime-link-preview`, window.location.origin).href)
  : fetch;

/**
 * Supabaseクライアントのインスタンスを作成してエクスポートします。
 * 'export' キーワードを付けることで、他のファイル（api/posts.ts など）から
 * import して利用することが可能になります。
 */
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: createPrivateMediaFetch(supabaseUrl, createSupabaseReadFetch(supabaseUrl, createSuspensionFetch(supabaseUrl, transport)), true, async()=>{
    const {data,error}=await supabase.auth.getSession();
    return error?null:data.session?.access_token??null;
  }) },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // ブラウザ環境でのロック競合によるタイムアウトを防ぐため、
    // 標準的な設定に留めます。独自のlock関数は不要です。
  },
});


// accountReadClient
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
      global: { fetch: createPrivateMediaFetch(import.meta.env.VITE_SUPABASE_URL, createSupabaseReadFetch(import.meta.env.VITE_SUPABASE_URL)) },
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


// accountSuspension
const SUSPENSION_EVENT = 'lime-account-suspended-action';
const SUSPENSION_MESSAGE = 'あなたのアカウントは停止されているため、この操作は許可されていません。';
let suspended = false;
function setAccountSuspended(value: boolean) { suspended = value; }
function isAccountReadOnly() { return suspended; }
function allowAccountWrite() { if (!suspended) return true; notifySuspendedAction(); return false; }
function notifySuspendedAction() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SUSPENSION_EVENT));
}
// POST is also used for read-only RPCs and private-media resolution.
const readRpc = /^(get_|list_|can_|is_|has_|resolve_|count_)/;
const readFunctions = new Set(['link-preview', 'recommendation-ranker', 'get-trends', 'friend-images']);
function createSuspensionFetch(baseUrl: string, transport: typeof fetch): typeof fetch {
  const origin = new URL(baseUrl).origin;
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    let blocked = suspended && url.origin === origin && url.pathname.startsWith('/rest/v1/') &&
      [...url.searchParams.values()].some(value => /(?:^|\.)(?:i?like|(?:p|ph|w)?fts)\./.test(value));
    if (suspended && url.origin === origin && !['GET','HEAD','OPTIONS'].includes(method)) {
      blocked = true;
      if (url.pathname.startsWith('/auth/v1/')) blocked = !/\/(token|logout)$/.test(url.pathname);
      if (url.pathname.startsWith('/rest/v1/rpc/')) blocked = !readRpc.test(url.pathname.split('/').pop() ?? '');
      if (url.pathname.startsWith('/functions/v1/')) {
        const name = url.pathname.split('/').pop() ?? '';
        blocked = !readFunctions.has(name);
        if (['direct-media','poll-media','list-media'].includes(name)) {
          try {
            const body = input instanceof Request && init?.body === undefined ? await input.clone().json() : JSON.parse(String(init?.body));
            blocked = !['read','resolve'].includes(body.action);
          } catch { blocked = true; }
        }
      }
    }
    if (blocked) {
      notifySuspendedAction();
      return Response.json({code:'ACCOUNT_SUSPENDED', message:SUSPENSION_MESSAGE, error:SUSPENSION_MESSAGE}, {status:403});
    }
    const response = await transport(input, init);
    if (response.status === 403 || response.status === 400) {
      const body = await response.clone().text().catch(() => '');
      if (body.includes('ACCOUNT_SUSPENDED')) notifySuspendedAction();
    }
    return response;
  };
}

// companyLoginReturn
// The login return target is restricted to the company site on this origin.
function companyReturnUrl(value: string | null, origin: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password) return null;
    if (url.pathname !== '/LimeNoteJP' && !url.pathname.startsWith('/LimeNoteJP/')) return null;
    return url.href;
  } catch { return null; }
}
function returnToCompany(url: string) { window.location.replace(url); }

// privateProfile
async function getPrivateBotPrompt(userId: string): Promise<string> {
  const {data, error} = await supabase.from('profile_private_settings').select('bot_prompt').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data?.bot_prompt ?? '';
}

// listLimits
const LIST_MEMBER_LIMIT=500;

export { setAccountSuspended };
export { isAccountReadOnly };
export { allowAccountWrite };
export { notifySuspendedAction };
export { createSuspensionFetch };
export { SUSPENSION_EVENT };
export { SUSPENSION_MESSAGE };
export { companyReturnUrl };
export { returnToCompany };
export { getPrivateBotPrompt };
export { LIST_MEMBER_LIMIT };

/** Keep provider IDs out of UUID foreign keys; the shared URL retains external posts/replies. */
export async function sendLimeDrop(payload: {
  sender_id: string; recipient_id: string; post_id: string | null;
  post_url: string; post_author_id: string | null; post_author_username: string;
  post_author_display_name: string; post_text: string; status: 'pending';
}, client: Pick<SupabaseClient, 'from'> = supabase) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const { error } = await client.from('lime_drops').insert({
    ...payload,
    post_id: payload.post_id && uuid.test(payload.post_id) ? payload.post_id : null,
    post_author_id: payload.post_author_id && uuid.test(payload.post_author_id) ? payload.post_author_id : null,
    status: 'pending',
  });
  if (error) throw error;
}
