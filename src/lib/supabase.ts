import { createSuspensionFetch } from './accountSuspension';
// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';
import { createPrivateMediaFetch, createSupabaseReadFetch } from './privateMediaFetch';
import { createDevFunctionFetch } from "@/lib/privateMediaFetch";

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
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: createPrivateMediaFetch(supabaseUrl, createSupabaseReadFetch(supabaseUrl, createSuspensionFetch(supabaseUrl, transport)), true) },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // ブラウザ環境でのロック競合によるタイムアウトを防ぐため、
    // 標準的な設定に留めます。独自のlock関数は不要です。
  },
});
