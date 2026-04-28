import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ChevronLeft, Users } from 'lucide-react';
import { getPostLikers } from '@/api/posts';
import type { User } from '@/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { FollowButton } from '@/components/profile/FollowButton';

export default function PostActivity() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!postId) return;
    setLoading(true);
    getPostLikers(postId)
      .then(setUsers)
      .finally(() => setLoading(false));
  }, [postId]);

  return (
    <div className="max-w-2xl mx-auto min-h-screen bg-transparent sm:p-4">
      <div className="overflow-hidden rounded-3xl border border-border/60 bg-transparent shadow-none">
        {/* ヘッダー部分：透過ベースで境界線のみ */}
        <div className="relative flex items-center gap-4 p-4 sm:p-6 border-b border-border/60 bg-transparent backdrop-blur-sm">
          <button 
            onClick={() => navigate(-1)} 
            className="group flex h-10 w-10 items-center justify-center rounded-full bg-background/40 border border-border/40 text-foreground transition hover:bg-primary-soft hover:text-primary"
          >
            <ChevronLeft className="h-6 w-6 transition-transform group-hover:-translate-x-0.5" />
          </button>
          <div className="flex flex-col">
            <h1 className="font-display text-xl font-black text-foreground flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              ポストアクティビティ
            </h1>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            {users.length}人がいいねしました
            </p>
          </div>
        </div>

        {/* ユーザーリスト */}
        <div className="divide-y divide-border/40 bg-transparent">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 bg-transparent">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
              <p className="text-sm font-bold text-muted-foreground">読み込み中...</p>
            </div>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center bg-transparent">
              <div className="mb-4 rounded-full bg-muted/20 p-4">
                <Users className="h-8 w-8 text-muted-foreground/60" />
              </div>
              <p className="text-lg font-bold text-foreground">まだいいねはありません</p>
              <p className="text-sm text-muted-foreground">ユーザーがハートをタップしてこのポストをいいねすると、ここに表示されます。</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {users.map((user) => (
                <div 
                  key={user.id} 
                  className="group flex items-center justify-between p-4 transition-colors hover:bg-primary-soft/10 sm:px-6 bg-transparent"
                >
                  <Link to={`/u/${user.username}`} className="flex items-center gap-3 min-w-0 flex-1">
                    <Avatar className="h-12 w-12 border-2 border-primary/10 transition-transform group-hover:scale-105 bg-background/40">
                      <AvatarImage src={user.avatarUrl} alt={user.displayName} />
                      <AvatarFallback className="font-bold text-primary bg-primary-soft">
                        {user.displayName.slice(0, 1)}
                      </AvatarFallback>
                    </Avatar>
                    
                    <div className="min-w-0 flex flex-col">
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="font-bold text-foreground truncate text-base hover:underline decoration-primary/40 decoration-2">
                          {user.displayName}
                        </span>
                        {user.isOfficial && (
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
                    </div>
                  </Link>
                  
                  <div className="shrink-0 ml-4">
                    <FollowButton userId={user.id} />
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