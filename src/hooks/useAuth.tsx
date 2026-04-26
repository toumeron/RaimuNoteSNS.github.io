import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';

type CustomUser = SupabaseUser & {
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
  coverUrl?: string;
};

type AuthContextType = {
  user: CustomUser | null;
  session: Session | null;
  loading: boolean;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CustomUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = async () => {
    await supabase.auth.signOut();
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSession(newSession);

        if (!newSession?.user) {
          setUser(null);
          setLoading(false);
          return;
        }

        const supabaseUser = newSession.user;
        const meta = supabaseUser.user_metadata;
        const emailName = supabaseUser.email?.split('@')[0] ?? 'user';

        // 1. まず現在の状態をチェックし、無闇に空文字で初期化しない
        setUser(prev => {
          if (prev && prev.id === supabaseUser.id) {
            return prev; // すでにデータがあるなら保持
          }
          return {
            ...supabaseUser,
            username:    meta?.username    ?? emailName,
            displayName: meta?.display_name ?? meta?.displayName ?? emailName,
            avatarUrl:   meta?.avatar_url  ?? meta?.avatarUrl  ?? '',
            bio:         '',
            coverUrl:    '',
          };
        });
        
        setLoading(false);

        // 2. DBから最新プロフィールを取得
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', supabaseUser.id)
          .single();

        if (profile) {
          setUser({
            ...supabaseUser,
            username:    profile.username     ?? meta?.username ?? emailName,
            displayName: profile.display_name ?? meta?.display_name ?? emailName,
            avatarUrl:   profile.avatar_url   ?? meta?.avatar_url ?? '',
            bio:         profile.bio          ?? '',
            coverUrl:    profile.cover_url    ?? '',
          });
        }
      },
    );

    return () => subscription.unsubscribe();
  }, []);

  // ここで AuthContext.Provider を返し、AuthProvider 関数を閉じます
  return (
    <AuthContext.Provider value={{ user, session, loading, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);