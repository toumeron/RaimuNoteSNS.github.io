import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { FollowButton } from '@/components/profile/FollowButton';
import { ChevronLeft, Users, UserPlus } from 'lucide-react';
import type { User } from '@/types';

type ListUser = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  bio: string;
  is_official: boolean;
};

export default function FollowersFollowingPage() {
  const { username } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'followers' ? 'followers' : 'following';
  
  const [targetUser, setTargetUser] = useState<User | null>(null);
  const [users, setUsers] = useState<ListUser[]>([]);
  const [loading, setLoading] = useState(true);

  // 1. 表示対象のユーザー情報を取得
  useEffect(() => {
    async function fetchTargetUser() {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('username', username)
        .single();
      
      if (data) {
        setTargetUser({
          ...data,
          displayName: data.display_name,
          avatarUrl: data.avatar_url,
          coverUrl: data.cover_url,
          createdAt: data.created_at,
          isOfficial: data.is_official
        });
      }
    }
    fetchTargetUser();
  }, [username]);

  // 2. リスト取得
  useEffect(() => {
    if (!targetUser) return;

    async function fetchList() {
      setLoading(true);
      const isFollowing = activeTab === 'following';

      const { data, error } = await supabase
        .from('follows')
        .select(`
          ${isFollowing ? 'followee_id' : 'follower_id'},
          profile:profiles!${isFollowing ? 'follows_followee_id_fkey' : 'follows_follower_id_fkey'} (
            id,
            username,
            display_name,
            avatar_url,
            bio,
            is_official
          )
        `)
        .eq(isFollowing ? 'follower_id' : 'followee_id', targetUser.id);

      if (!error && data) {
        const list = data.map((d: any) => d.profile);
        setUsers(list);
      }
      setLoading(false);
    }

    fetchList();
  }, [targetUser, activeTab]);

  if (!targetUser) return null;

  return (
    <div className="max-w-2xl mx-auto min-h-screen bg-transparent sm:p-4">
      <div className="overflow-hidden rounded-3xl border border-border/60 bg-transparent shadow-none">
        
        {/* ヘッダー */}
        <div className="relative flex items-center gap-4 p-4 sm:p-6 border-b border-border/60 bg-transparent backdrop-blur-sm">
          <button 
            onClick={() => navigate(-1)} 
            className="group flex h-10 w-10 items-center justify-center rounded-full bg-background/40 border border-border/40 text-foreground transition hover:bg-primary-soft hover:text-primary"
          >
            <ChevronLeft className="h-6 w-6 transition-transform group-hover:-translate-x-0.5" />
          </button>
          <div className="flex flex-col">
            <h1 className="font-display text-xl font-black text-foreground flex items-center gap-2">
              {activeTab === 'following' ? (
                <Users className="h-5 w-5 text-primary" />
              ) : (
                <UserPlus className="h-5 w-5 text-primary" />
              )}
              {targetUser.displayName}
            </h1>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              @{targetUser.username}
            </p>
          </div>
        </div>

        {/* タブ切り替え：タブとユーザーリストの間の境界線を削除 */}
        <div className="flex bg-transparent">
          <button
            onClick={() => setSearchParams({ tab: 'following' })}
            className={`flex-1 py-4 text-sm font-black transition-all relative ${
              activeTab === 'following' 
                ? 'text-primary' 
                : 'text-muted-foreground hover:text-foreground hover:bg-primary-soft/5'
            }`}
          >
            フォロー中
            {activeTab === 'following' && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-primary rounded-t-full" />
            )}
          </button>
          <button
            onClick={() => setSearchParams({ tab: 'followers' })}
            className={`flex-1 py-4 text-sm font-black transition-all relative ${
              activeTab === 'followers' 
                ? 'text-primary' 
                : 'text-muted-foreground hover:text-foreground hover:bg-primary-soft/5'
            }`}
          >
            フォロワー
            {activeTab === 'followers' && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-primary rounded-t-full" />
            )}
          </button>
        </div>

        {/* ユーザーリスト */}
        <div className="divide-y divide-border/40 bg-transparent">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 bg-transparent">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
              <p className="text-sm font-bold text-muted-foreground">読み込み中...</p>
            </div>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center bg-transparent px-6 border-t border-border/40">
              <div className="mb-4 rounded-full bg-muted/20 p-4">
                <Users className="h-8 w-8 text-muted-foreground/60" />
              </div>
              <p className="text-lg font-bold text-foreground">
                {activeTab === 'following' ? 'まだ誰もフォローしていません' : 'まだフォロワーはいません'}
              </p>
              <p className="text-sm text-muted-foreground max-w-xs">
                ユーザーを見つけてつながりを持つと、ここにリストが表示されます。
              </p>
            </div>
          ) : (
            <div className="flex flex-col border-t border-border/40">
              {users.map((user) => (
                <div 
                  key={user.id} 
                  className="group flex p-4 transition-colors hover:bg-primary-soft/5 sm:px-6 bg-transparent"
                >
                  <Link to={`/u/${user.username}`} className="shrink-0 mr-3">
                    <Avatar className="h-12 w-12 border-2 border-primary/10 bg-background/40">
                      <AvatarImage src={user.avatar_url} alt={user.display_name} />
                      <AvatarFallback className="font-bold text-primary bg-primary-soft">
                        {user.display_name.slice(0, 1)}
                      </AvatarFallback>
                    </Avatar>
                  </Link>

                  <div className="flex-1 min-w-0 flex flex-col">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <Link to={`/u/${user.username}`} className="min-w-0 flex flex-col">
                        <div className="flex items-center gap-1 min-w-0">
                          {/* 下線をモノトーン（foregroundカラー）に変更 */}
                          <span className="font-bold text-foreground truncate text-base group-hover:underline decoration-foreground decoration-2">
                            {user.display_name}
                          </span>
                          {user.is_official && (
                            <img 
                              src={`${import.meta.env.BASE_URL}verified.png`} 
                              alt="Official" 
                              className="h-[1.1em] w-[1.1em] shrink-0" 
                            />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate leading-none">
                          @{user.username}
                        </p>
                      </Link>
                      
                      <div className="shrink-0">
                        <FollowButton userId={user.id} />
                      </div>
                    </div>
                    
                    {/* Bioを名前と同じカラムに配置し、位置を統一 */}
                    {user.bio && (
                      <p className="text-sm text-foreground/80 line-clamp-2 leading-relaxed mt-1">
                        {user.bio}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}