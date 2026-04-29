// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Supabaseクライアントのインスタンスを作成してエクスポートします。
 * 'export' キーワードを付けることで、他のファイル（api/posts.ts など）から
 * import して利用することが可能になります。
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // ブラウザ環境でのロック競合によるタイムアウトを防ぐため、
    // 標準的な設定に留めます。独自のlock関数は不要です。
  },
});