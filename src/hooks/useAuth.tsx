import { createContext, useContext, useEffect, useState, useRef } from 'react';
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
  const isProcessing = useRef(false);

  const logout = async () => {
    await supabase.auth.signOut();
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        // 処理中、またはセッションがない場合は重複動作を防ぐ
        if (isProcessing.current) return;
        
        setSession(newSession);

        if (!newSession?.user) {
          setUser(null);
          setLoading(false);
          return;
        }

        isProcessing.current = true; // ロック開始
        
        try {
          const supabaseUser = newSession.user;
          const meta = supabaseUser.user_metadata;
          const emailName = supabaseUser.email?.split('@')[0] ?? 'user';

          // 1. メタデータから初期セット
          setUser({
            ...supabaseUser,
            username:    meta?.username    ?? emailName,
            displayName: meta?.display_name ?? meta?.displayName ?? emailName,
            avatarUrl:   meta?.avatar_url  ?? meta?.avatarUrl  ?? '',
            bio:         '',
            coverUrl:    '',
          });
          
          setLoading(false);

          // 2. プロフィール取得（DBが正常ならここが通る）
          const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', supabaseUser.id)
            .single();

          if (!error && profile) {
            setUser(current => current ? {
              ...current,
              username:    profile.username     ?? current.username,
              displayName: profile.display_name ?? current.displayName,
              avatarUrl:   profile.avatar_url   ?? current.avatarUrl,
              bio:         profile.bio          ?? current.bio,
              coverUrl:    profile.cover_url    ?? current.coverUrl,
            } : null);
          }
        } finally {
          // 通信の嵐が収まるまで少し待ってからロック解除
          setTimeout(() => {
            isProcessing.current = false;
          }, 500);
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