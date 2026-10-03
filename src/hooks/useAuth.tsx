import { useQueryClient } from '@tanstack/react-query';
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
  emojiEffect?: string; // 追加: 絵文字エフェクト用
  bot_enabled?: boolean; // 追加: Bot設定用
  bot_prompt?: string;   // 追加: Bot設定用
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
  const queryClient = useQueryClient();
  const [user, setUser] = useState<CustomUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // ログアウト処理
  const logout = async () => {
    await supabase.auth.signOut();
  };

  useEffect(() => {
    let alive = true;
    let cachedViewerId: string | null | undefined;
    let profileUserId: string | null = null;
    let profileTimer: ReturnType<typeof setTimeout> | undefined;
    /**
     * DBから詳細プロフィールを取得する関数
     * select('*')を避け、必要なカラムのみを指定することでタイムアウトを抑制します。
     */
    const fetchProfile = async (supabaseUser: SupabaseUser) => {
      try {
        const { data: profile, error } = await supabase
          .from('profiles')
          // bot_enabled, bot_prompt を select に追加
          .select('username, display_name, avatar_url, bio, cover_url, emoji_effect, bot_enabled, bot_prompt')
          .eq('id', supabaseUser.id)
          .single();

        if (alive && profileUserId === supabaseUser.id && !error && profile) {
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
              emojiEffect: profile.emoji_effect ?? current.emojiEffect,
              bot_enabled: profile.bot_enabled ?? false, // DBから取得した値を反映
              bot_prompt: profile.bot_prompt ?? '',      // DBから取得した値を反映
            };
          });
        }
      } catch (err) {
        console.error("AuthProvider: Background profile fetch failed", err);
      }
    };

    // Auth callbacks run while Supabase holds its session lock. Schedule DB work
    // after the callback returns; resubscribing on every user/loading update
    // causes repeated INITIAL_SESSION events and lock contention.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!alive) return;
      const viewerId = newSession?.user.id ?? null;
      if (cachedViewerId !== viewerId) {
        // Never reuse another account's cached restricted posts or quote parents.
        queryClient.clear();
        cachedViewerId = viewerId;
      }
      setSession(newSession);
      setLoading(false);
      const supabaseUser = newSession?.user;
      if (!supabaseUser) {
        profileUserId = null;
        clearTimeout(profileTimer);
        setUser(null);
        return;
      }
      const meta = supabaseUser.user_metadata;
      const emailName = supabaseUser.email?.split('@')[0] ?? 'user';
      setUser(current => current?.id === supabaseUser.id ? { ...current, ...supabaseUser } : {
        ...supabaseUser,
        username: meta?.username ?? emailName,
        displayName: meta?.display_name ?? meta?.displayName ?? emailName,
        avatarUrl: meta?.avatar_url ?? meta?.avatarUrl ?? '',
        bio: '', coverUrl: '', emojiEffect: '', bot_enabled: false, bot_prompt: '',
      });
      if (profileUserId !== supabaseUser.id) {
        profileUserId = supabaseUser.id;
        clearTimeout(profileTimer);
        profileTimer = setTimeout(() => { if (alive) void fetchProfile(supabaseUser); }, 0);
      }
    });
    return () => {
      alive = false;
      clearTimeout(profileTimer);
      subscription.unsubscribe();
    };
  }, [queryClient]);

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