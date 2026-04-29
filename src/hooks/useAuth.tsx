import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';

// ユーザー情報の型定義（Supabaseの基本情報にプロフィール情報を統合）
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

// コンテキストの初期化
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

  // ログアウト処理
  const logout = async () => {
    await supabase.auth.signOut();
  };

  useEffect(() => {
    /**
     * DBから詳細プロフィールを取得する関数
     * select('*')を避け、必要なカラムのみを指定することでタイムアウトを抑制します。
     */
    const fetchProfile = async (supabaseUser: SupabaseUser) => {
      try {
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('username, display_name, avatar_url, bio, cover_url')
          .eq('id', supabaseUser.id)
          .single();

        if (!error && profile) {
          setUser(current => {
            // 非同期処理中にユーザーがログアウト・切り替わりをしていないか確認
            if (!current || current.id !== supabaseUser.id) return current;
            return {
              ...current,
              username: profile.username ?? current.username,
              displayName: profile.display_name ?? current.displayName,
              avatarUrl: profile.avatar_url ?? current.avatarUrl,
              bio: profile.bio ?? current.bio,
              coverUrl: profile.cover_url ?? current.coverUrl,
            };
          });
        }
      } catch (err) {
        console.error("AuthProvider: Background profile fetch failed", err);
      }
    };

    /**
     * 1. 初回マウント時に現在のセッションを直接確認
     * これにより、リフレッシュ直後に「未ログイン」と誤判定されるのを防ぎます。
     */
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (initialSession) {
        setSession(initialSession);
        const meta = initialSession.user.user_metadata;
        const emailName = initialSession.user.email?.split('@')[0] ?? 'user';

        // まずはメタデータで仮のユーザー情報を構築
        setUser({
          ...initialSession.user,
          username: meta?.username ?? emailName,
          displayName: meta?.display_name ?? meta?.displayName ?? emailName,
          avatarUrl: meta?.avatar_url ?? meta?.avatarUrl ?? '',
        });
        
        // 詳細をDBに獲りに行く
        fetchProfile(initialSession.user);
      }
      setLoading(false);
    });

    /**
     * 2. 認証状態の変化を監視
     */
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        setSession(newSession);

        // ログアウト時
        if (!newSession?.user) {
          setUser(null);
          setLoading(false);
          return;
        }

        const supabaseUser = newSession.user;

        // 【最重要：タイムアウト・無限ループ対策】
        // すでにこのIDのユーザーデータを持っており、プロフィール取得済みなら
        // これ以上DB（profilesテーブル）へリクエストを飛ばさない。
        if (user?.id === supabaseUser.id && user.username) {
          setLoading(false);
          return;
        }

        const meta = supabaseUser.user_metadata;
        const emailName = supabaseUser.email?.split('@')[0] ?? 'user';

        // DB取得を待たずに、まずメタデータで画面を表示させる
        setUser({
          ...supabaseUser,
          username: meta?.username ?? emailName,
          displayName: meta?.display_name ?? meta?.displayName ?? emailName,
          avatarUrl: meta?.avatar_url ?? meta?.avatarUrl ?? '',
          bio: '',
          coverUrl: '',
        });

        if (loading) setLoading(false);

        // 裏側で最新のプロフィールを取得
        fetchProfile(supabaseUser);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [user?.id, loading]);

  return (
    <AuthContext.Provider value={{ user, session, loading, logout }}>
      {/* loadingがfalse（＝ユーザー情報の初期セット完了）になるまで
         childrenを描画しないことで、ログイン直後のコンポーネントエラーを防ぎます。
      */}
      {!loading && children}
    </AuthContext.Provider>
  );
}

// コンテキストを利用するためのカスタムフック
export const useAuth = () => useContext(AuthContext);