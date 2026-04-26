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

        // まず auth メタデータで即座にセット → 画面が真っ白にならない
        setUser({
          ...supabaseUser,
          username:    meta?.username    ?? emailName,
          displayName: meta?.display_name ?? meta?.displayName ?? emailName,
          avatarUrl:   meta?.avatar_url  ?? meta?.avatarUrl  ?? '',
          bio:         '',
          coverUrl:    '',
        });
        setLoading(false);

        // バックグラウンドで profiles テーブルを取得して上書き
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', supabaseUser.id)
          .single();

        if (profile) {
          setUser(prev =>
            prev
              ? {
                  ...prev,
                  username:    profile.username     ?? prev.username,
                  displayName: profile.display_name ?? prev.displayName,
                  avatarUrl:   profile.avatar_url   ?? prev.avatarUrl,
                  bio:         profile.bio          ?? '',
                  coverUrl:    profile.cover_url    ?? '',
                }
              : null,
          );
        }
      },
    );

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, session, loading, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
