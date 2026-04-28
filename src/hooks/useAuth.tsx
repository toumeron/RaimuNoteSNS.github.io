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
          setLoading(false); // ログインしていないなら即終了
          return;
        }

        const supabaseUser = newSession.user;
        const meta = supabaseUser.user_metadata;
        const emailName = supabaseUser.email?.split('@')[0] ?? 'user';

        // 1. まずは Auth メタデータから最小限の情報をセットして「ログイン済み」にする
        // これにより「画面が真っ白のまま止まる」のを防ぎます
        setUser(prev => {
          if (prev && prev.id === supabaseUser.id) return prev;
          return {
            ...supabaseUser,
            username:    meta?.username    ?? emailName,
            displayName: meta?.display_name ?? meta?.displayName ?? emailName,
            avatarUrl:   meta?.avatar_url  ?? meta?.avatarUrl  ?? '',
            bio:         '',
            coverUrl:    '',
          };
        });
        
        // ログイン状態は確定したので、ここで一旦 loading を外す
        setLoading(false);

        // 2. プロフィール詳細は「裏側」で取得する（await で全体を止めない）
        // .then() を使うことで、この関数の外側の処理（他の通信）を邪魔しません
        supabase
          .from('profiles')
          .select('*')
          .eq('id', supabaseUser.id)
          .single()
          .then(({ data: profile, error }) => {
            if (error || !profile) return;

            // 取得できたら、その時だけ表示を更新する
            setUser(current => {
              if (!current) return null;
              return {
                ...current,
                username:    profile.username     ?? current.username,
                displayName: profile.display_name ?? current.displayName,
                avatarUrl:   profile.avatar_url   ?? current.avatarUrl,
                bio:         profile.bio          ?? current.bio,
                coverUrl:    profile.cover_url    ?? current.coverUrl,
              };
            });
          });
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