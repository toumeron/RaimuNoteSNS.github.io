// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Web Locks API (navigator.locks) を無効化。
    // React StrictMode / Vite HMR で createClient が複数回呼ばれると
    // NavigatorLockAcquireTimeoutError が発生するため、ロック処理をバイパスする。
    lock: (_name: string, _acquireTimeout: number, fn: () => Promise<unknown>) => fn(),
  },
});
