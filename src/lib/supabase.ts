// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// インスタンスを一度だけ作成する仕組みを維持
let supabaseInstance: any = null;

if (!supabaseInstance) {
  supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // これを削るとデッドロック（表示されない）、
      // これがあると無限リクエスト（元々の問題）が発生する
      lock: (name, acquireTimeout, fn) => fn(),
    },
  });
}

export const supabase = supabaseInstance;