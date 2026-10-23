import { setAccountSuspended, SUSPENSION_EVENT, getPrivateBotPrompt } from "@/lib/supabase";
import { setExternalAccountOwner, initialiseExternalAccounts, refreshExternalAccounts } from "@/lib/externalAccounts";
import { accountAboutKey, syncAccountConnection } from "@/api/users";
import { clearPrivateMedia } from "@/lib/privateMediaFetch";
import { isInstalledPwa } from "@/lib/utils";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { Fragment, createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";
import { activateAccountIntegrations, getSavedAccountTokens, markSavedAccountNeedsLogin, readSavedAccounts, removeSavedAccount, saveAccountSession, SAVED_ACCOUNTS_EVENT, SAVED_ACCOUNTS_KEY, type SavedAccount } from "@/lib/savedAccounts";
import { type Session, type User as SupabaseUser } from "@supabase/supabase-js";
import { isXId } from "@/lib/fxTwitter";
import { isMisskeyId } from "@/lib/misskey";
import { BSKY_SESSION_STORAGE_KEY, getStoredBlueskySession, type BlueskySession } from "@/lib/bluesky";
import { noBrowserSubscription, sharedBrowserStore } from "@/hooks/useViewportWidth";

// useAuth
// ユーザー情報の型定義（Supabaseの基本情報にプロフィール情報を統合）
type CustomUser = SupabaseUser & {
  isSuspended?: boolean;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  isOfficial?: boolean;
  isPrivate?: boolean;
  bio?: string;
  location?: string;
  websiteUrl?: string;
  birthDate?: string;
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
  accounts: SavedAccount[];
  switching: boolean;
  switchAccount: (id: string) => Promise<void>;
  forgetAccount: (id: string) => void;
};

// コンテキストの初期化
const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  logout: async () => {},
  accounts: [], switching: false, switchAccount: async () => {}, forgetAccount: () => {},
});

function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<CustomUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState(readSavedAccounts);
  const [switching, setSwitching] = useState(false);
  const switchInFlight = useRef(false);
  const sessionRef = useRef<Session | null>(null);
  const profileRef = useRef<CustomUser | null>(null);

  useEffect(() => {
    const update = () => setAccounts(readSavedAccounts());
    const storage = (event: StorageEvent) => { if (event.key === SAVED_ACCOUNTS_KEY || event.key === null) update(); };
    window.addEventListener(SAVED_ACCOUNTS_EVENT, update);
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener(SAVED_ACCOUNTS_EVENT, update); window.removeEventListener('storage', storage); };
  }, []);

  const switchAccount = async (id: string) => {
    if (switchInFlight.current) throw new Error('アカウントを切り替えています');
    if (id === sessionRef.current?.user.id) return;
    const tokens = getSavedAccountTokens(id);
    if (!tokens) throw new Error('このアカウントは再ログインが必要です');
    switchInFlight.current = true;
    setSwitching(true);
    const previous = sessionRef.current;
    if (previous) saveAccountSession(previous, profileRef.current ?? undefined);
    try {
      const { data, error } = await supabase.auth.setSession(tokens);
      if (error || !data.session || data.session.user.id !== id) {
        if (error && [400, 401, 403].includes(error.status)) markSavedAccountNeedsLogin(id);
        throw new Error(error && [400, 401, 403].includes(error.status) ? 'このアカウントは再ログインが必要です' : 'アカウントの切り替えに失敗しました。通信状態を確認してください');
      }
      saveAccountSession(data.session);
    } catch (error) {
      // A rejected expired refresh token can make the SDK emit SIGNED_OUT.
      // Restore the previous session before allowing the protected UI to resume.
      if (previous && sessionRef.current?.user.id !== previous.user.id) {
        const restored = await supabase.auth.setSession({ access_token: previous.access_token, refresh_token: previous.refresh_token });
        if (restored.error) {
          // Both sessions are invalid. Publish a real signed-out state rather
          // than leaving the previous account's UI visible without its session.
          switchInFlight.current = false;
          await supabase.auth.signOut({ scope: 'local' });
          throw new Error('ログイン状態を復元できませんでした。再ログインしてください');
        }
      }
      throw error;
    } finally {
      switchInFlight.current = false;
      setSwitching(false);
    }
  };
  const forgetAccount = (id: string) => {
    if (id === sessionRef.current?.user.id) throw new Error('ログイン中のアカウントはログアウトしてください');
    removeSavedAccount(id);
  };

  // ログアウト処理
  const logout = async () => {
    if (switchInFlight.current) throw new Error('アカウントを切り替えています');
    const id = sessionRef.current?.user.id;
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
    if (id) removeSavedAccount(id);
  };

  useEffect(() => {
    let alive = true;
    let cachedViewerId: string | null | undefined;
    let profileUserId: string | null = null;
    let profileTimer: ReturnType<typeof setTimeout> | undefined;
    const profileRequests = new Map<string, Promise<void>>();
    /**
     * DBから詳細プロフィールを取得する関数
     * select('*')を避け、必要なカラムのみを指定することでタイムアウトを抑制します。
     */
    const readProfile = async (supabaseUser: SupabaseUser) => {
      try {
        const { data: profile, error } = await supabase
          .from('profiles')
          // 公開プロフィールの取得を非公開Bot設定の取得から独立させる。
          .select('username, display_name, avatar_url, is_official, is_private, bio, location, website_url, birth_date, cover_url, emoji_effect, bot_enabled, Account_suspension')
          .eq('id', supabaseUser.id)
          .single();

        if (alive && profileUserId === supabaseUser.id && !error && profile) {
          if ((profile.Account_suspension === true) !== (profileRef.current?.isSuspended === true)) {
            clearPrivateMedia();
            void queryClient.invalidateQueries();
          }
          setAccountSuspended(profile.Account_suspension === true);
          const details = { username: profile.username ?? '', displayName: profile.display_name ?? '', avatarUrl: profile.avatar_url ?? '', isOfficial: !!profile.is_official };
          const active = sessionRef.current;
          if (active?.user.id === supabaseUser.id) saveAccountSession(active, details);
          setUser(current => {
            // 非同期処理中にユーザーがログアウト・切り替わりをしていないか確認
            if (!current || current.id !== supabaseUser.id) return current;
            const updated = {
              ...current,
              username: profile.username ?? current.username,
              displayName: profile.display_name ?? current.displayName,
              avatarUrl: profile.avatar_url ?? current.avatarUrl,
              isOfficial: !!profile.is_official,
              isPrivate: !!profile.is_private,
              isSuspended: profile.Account_suspension === true,
              bio: profile.bio ?? current.bio,
              location: profile.location ?? '',
              websiteUrl: profile.website_url ?? '',
              birthDate: profile.birth_date ?? '',
              coverUrl: profile.cover_url ?? current.coverUrl,
              emojiEffect: profile.emoji_effect ?? current.emojiEffect,
              bot_enabled: profile.bot_enabled ?? false, // DBから取得した値を反映
              bot_prompt: current.bot_prompt, // 非公開設定の取得結果だけを反映
            };
            if (Object.entries(updated).every(([key,value]) => Object.is(current[key],value))) return current;
            profileRef.current = updated;
            return updated;
          });
          // Missing migrations or a slow private-settings request must not
          // prevent the public profile from appearing in the composer/settings.
          void getPrivateBotPrompt(supabaseUser.id).then(prompt => {
            if (!alive || profileUserId !== supabaseUser.id) return;
            setUser(current => {
              if (!current || current.id !== supabaseUser.id || current.bot_prompt === prompt) return current;
              const updated = { ...current, bot_prompt: prompt };
              profileRef.current = updated;
              return updated;
            });
          }).catch(err => console.warn('AuthProvider: Private Bot settings unavailable', err));
        }
      } catch (err) {
        console.error("AuthProvider: Background profile fetch failed", err);
      }
    };
    // iOS resumes can emit focus, visibility and online events together.
    // Share the read without delaying a later genuine profile change.
    const fetchProfile = (supabaseUser: SupabaseUser): Promise<void> => {
      const pending = profileRequests.get(supabaseUser.id);
      if (pending) return pending;
      const request = readProfile(supabaseUser).finally(() => {
        if (profileRequests.get(supabaseUser.id) === request) profileRequests.delete(supabaseUser.id);
      });
      profileRequests.set(supabaseUser.id,request);
      return request;
    };

    // An installed app must be able to open its locally saved bookmarks even
    // when an expired session cannot refresh until the network returns.
    let offlineSession:Session|null=null;
    if(isInstalledPwa() && !navigator.onLine){
      try{
        const project=new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split('.')[0];
        const stored=JSON.parse(localStorage.getItem(`sb-${project}-auth-token`)??'null');
        if(stored?.user?.id && typeof stored.access_token==='string' && typeof stored.refresh_token==='string')offlineSession=stored;
      }catch{/* No locally signed-in account. */}
    }

    // Auth callbacks run while Supabase holds its session lock. Schedule DB work
    // after the callback returns; resubscribing on every user/loading update
    // causes repeated INITIAL_SESSION events and lock contention.
    const applySession = (_event:string,newSession:Session|null) => {
      if (!alive) return;
      if(!navigator.onLine && offlineSession && !newSession && _event!=='SIGNED_OUT')return;
      // Do not expose a transient failed-switch SIGNED_OUT to the router.
      if (switchInFlight.current && !newSession) { sessionRef.current = null; return; }
      sessionRef.current = newSession;
      if (newSession) saveAccountSession(newSession);
      else if (_event === 'SIGNED_OUT' && cachedViewerId) markSavedAccountNeedsLogin(cachedViewerId);
      const viewerId = newSession?.user.id ?? null;
      if (cachedViewerId !== viewerId) {
        activateAccountIntegrations(cachedViewerId, viewerId);
        setExternalAccountOwner(viewerId);
        // Never reuse another account's cached restricted posts or quote parents.
        clearPrivateMedia();
        queryClient.clear();
        cachedViewerId = viewerId;
      }
      setSession(newSession);
      setLoading(false);
      const supabaseUser = newSession?.user;
      if (!supabaseUser) {
        profileUserId = null;
        clearTimeout(profileTimer);
        profileRef.current = null;
        setAccountSuspended(false);
        setUser(null);
        return;
      }
      if (profileRef.current?.id !== supabaseUser.id) setAccountSuspended(false);
      const meta = supabaseUser.user_metadata;
      const savedProfile=!navigator.onLine?readSavedAccounts().find(account=>account.id===supabaseUser.id):undefined;
      const emailName = supabaseUser.email?.split('@')[0] ?? 'user';
      setUser(current => {
        const next = current?.id === supabaseUser.id ? { ...current, ...supabaseUser } : {
        ...supabaseUser,
        username: savedProfile?.username ?? meta?.username ?? emailName,
        displayName: savedProfile?.displayName ?? meta?.display_name ?? meta?.displayName ?? emailName,
        avatarUrl: savedProfile?.avatarUrl ?? meta?.avatar_url ?? meta?.avatarUrl ?? '',
        bio: '', coverUrl: '', emojiEffect: '', bot_enabled: false, bot_prompt: '', isSuspended: false,
      };
        profileRef.current = next;
        return next;
      });
      if (navigator.onLine && profileUserId !== supabaseUser.id) {
        profileUserId = supabaseUser.id;
        clearTimeout(profileTimer);
        profileTimer = setTimeout(() => { if (alive) void fetchProfile(supabaseUser); }, 0);
      }
    };
    if(offlineSession)applySession('INITIAL_SESSION',offlineSession);
    const {data:{subscription}}=supabase.auth.onAuthStateChange(applySession);
    const refreshProfile = (event:Event) => {
      const active = sessionRef.current?.user;
      if (active && navigator.onLine && document.visibilityState !== 'hidden') {
        // A rejected write explicitly requests a fresh suspension check.
        void (event.type===SUSPENSION_EVENT?readProfile(active):fetchProfile(active));
      }
    };
    window.addEventListener('focus',refreshProfile);
    window.addEventListener('online',refreshProfile);
    window.addEventListener(SUSPENSION_EVENT,refreshProfile);
    document.addEventListener('visibilitychange',refreshProfile);
    const reconnect=()=>{void supabase.auth.getSession().then(({data})=>{if(alive)applySession('INITIAL_SESSION',data.session);}).catch(()=>{/* The SDK's auth listener will retry when connectivity returns. */});};
    window.addEventListener('online',reconnect);
    return () => {
      window.removeEventListener('online',reconnect);
      window.removeEventListener('focus',refreshProfile);
      document.removeEventListener('visibilitychange',refreshProfile);
      window.removeEventListener('online',refreshProfile);
      window.removeEventListener(SUSPENSION_EVENT,refreshProfile);
      alive = false;
      clearTimeout(profileTimer);
      subscription.unsubscribe();
    };
  }, [queryClient]);

  useEffect(() => {
    if (!user?.id) return;
    const refresh = () => {
      if (!navigator.onLine || document.visibilityState === 'hidden') return;
      void refreshExternalAccounts().catch(() => { /* Retry on focus/reconnect; writes report failures to the user. */ });
    };
    const timer = setTimeout(() => { void initialiseExternalAccounts().catch(() => {}); }, 0);
    const interval = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer); clearInterval(interval);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || user.isSuspended) return;
    const id = user.id;
    const controller = new AbortController();
    const sync = () => {
      if (!navigator.onLine) return;
      void syncAccountConnection(id, controller.signal).then(updated => {
        if (updated && !controller.signal.aborted) void queryClient.invalidateQueries({ queryKey: accountAboutKey(id) });
      }).catch(() => { /* Country lookup is optional; do not block sign-in. */ });
    };
    const timer = setTimeout(sync, 0);
    window.addEventListener('online', sync);
    return () => { clearTimeout(timer); controller.abort(); window.removeEventListener('online', sync); };
  }, [user?.id, user?.isSuspended, queryClient]);

  return (
    <AuthContext.Provider value={{ user, session, loading, logout, accounts, switching, switchAccount, forgetAccount }}>
      {/* loadingがfalse（＝ユーザー情報の初期セット完了）になるまで
         childrenを描画しないことで、ログイン直後のコンポーネントエラーを防ぎます。
      */}
      {!loading && <Fragment key={user?.id ?? 'guest'}>{children}</Fragment>}
    </AuthContext.Provider>
  );
}

// コンテキストを利用するためのカスタムフック
const useAuth = () => useContext(AuthContext);

// useBlueskySession
const store=sharedBrowserStore(()=>getStoredBlueskySession(),update=>{
 const sync=()=>update(getStoredBlueskySession());
 const changed=(event:Event)=>{
  const detail=(event as CustomEvent<{session?:BlueskySession|null}>).detail;
  update(detail&&'session' in detail?detail.session??null:getStoredBlueskySession());
 };
 const storage=(event:StorageEvent)=>{if(event.key===BSKY_SESSION_STORAGE_KEY||event.key===null)sync();};
 window.addEventListener('lime-bluesky-session-changed',changed);
 window.addEventListener('lime-misskey-changed',sync);
 window.addEventListener('storage',storage);
 return()=>{window.removeEventListener('lime-bluesky-session-changed',changed);window.removeEventListener('lime-misskey-changed',sync);window.removeEventListener('storage',storage);};
},(a,b)=>a===b||JSON.stringify(a)===JSON.stringify(b));
const noSession=()=>null;
/** Share login/logout/token refresh events. Twitter and Misskey never subscribe. */
function useBlueskySession(targetId?:string):BlueskySession|null{
 const enabled=!isMisskeyId(targetId)&&!isXId(targetId);
 return useSyncExternalStore(enabled?store.subscribe:noBrowserSubscription,enabled?store.getSnapshot:noSession,noSession);
}

// useMembership
const membershipKey = (creatorId: string, memberId?: string) =>
  ['membership', creatorId, memberId] as const;

/** 自分が creatorId のメンバーになっているかどうかを取得 */
function useMembershipStatus(creatorId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: membershipKey(creatorId ?? '', user?.id),
    queryFn: async () => {
      if (!creatorId || !user) return false;
      const { data, error } = await supabase
        .from('memberships')
        .select('id')
        .eq('creator_id', creatorId)
        .eq('member_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    enabled: Boolean(creatorId && user),
  });
}

/** メンバーに加入する（決済なし・即時登録） */
function useJoinMembership(creatorId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('ログインが必要です');
      const { error } = await supabase
        .from('memberships')
        .insert({ creator_id: creatorId, member_id: user.id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: membershipKey(creatorId, user?.id) });
    },
  });
}

/** メンバーを解除する */
function useLeaveMembership(creatorId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('ログインが必要です');
      const { error } = await supabase
        .from('memberships')
        .delete()
        .eq('creator_id', creatorId)
        .eq('member_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: membershipKey(creatorId, user?.id) });
    },
  });
}

export { AuthProvider };
export { useAuth };
export { useBlueskySession };
export { useMembershipStatus };
export { useJoinMembership };
export { useLeaveMembership };
