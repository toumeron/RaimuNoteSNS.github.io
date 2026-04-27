// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 1. すでに作成済みのインスタンスがあればそれを使う仕組み（シングルトン）
let supabaseInstance: any = null;

if (!supabaseInstance) {
  supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // 2. ロックを無効化しつつ、重複作成の影響を最小限にする
      lock: (name, acquireTimeout, fn) => fn(),
    },
  });
}

export const supabase = supabaseInstance;