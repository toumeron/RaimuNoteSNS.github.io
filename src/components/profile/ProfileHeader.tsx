import { CalendarDays } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { FollowButton } from './FollowButton';
import { useFollowStats } from '@/hooks/useProfile';
import { useAuth } from '@/hooks/useAuth';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import type { User } from '@/types';

export function ProfileHeader({ user }: { user: User }) {
  const { user: me } = useAuth();
  const { data: stats } = useFollowStats(user.id);
  const isMe = me?.id === user.id;

  return (
    <div className="overflow-hidden rounded-3xl border border-border/60 bg-card shadow-soft">
      <div className="relative h-40 bg-gradient-cream sm:h-48">
        {user.coverUrl && (
          <img src={user.coverUrl} alt="" className="h-full w-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-card/40 to-transparent" />
      </div>

      <div className="relative px-5 pb-5 sm:px-6">
        <div className="-mt-12 flex items-end justify-between gap-3 sm:-mt-14">
          <Avatar className="h-24 w-24 border-4 border-card shadow-pop sm:h-28 sm:w-28">
            <AvatarImage src={user.avatarUrl} alt={user.displayName} />
            <AvatarFallback>{user.displayName.slice(0, 1)}</AvatarFallback>
          </Avatar>
          {isMe ? (
            <Button asChild variant="outline" className="rounded-full border-primary/40 font-bold text-primary hover:bg-primary-soft">
              <Link to="/settings">プロフィールを編集</Link>
            </Button>
          ) : (
            <FollowButton userId={user.id} />
          )}
        </div>

        <div className="mt-3">
          <div className="flex flex-col">
            {/* 名前が長すぎてもバッジを押し出さないよう min-w-0 を追加 */}
            <div className="flex items-center gap-0.1 min-w-0">
              <h1 className="font-display text-2xl font-black text-foreground truncate min-w-0">
                {user.displayName}
              </h1>
              
              {user.isOfficial && (
                <img 
                  src={`${import.meta.env.BASE_URL}verified.png`} 
                  alt="Official" 
                  className="h-[1.4em] w-[1.4em] shrink-0 transform translate-y-[2px]"
                  loading="eager"
                />
              )}
            </div>

            <p className="text-[15px] text-muted-foreground truncate">@{user.username}</p>
          </div>
        </div>

        {user.bio && (
          <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed">{user.bio}</p>
        )}

        <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" />
          {dayjs(user.createdAt).format('YYYY年M月')} から参加
        </div>

        <div className="mt-4 flex items-center gap-5 border-t border-border/60 pt-4 text-sm">
          <div>
            <span className="font-display text-base font-bold tabular-nums">{stats?.following ?? 0}</span>
            <span className="ml-1 text-muted-foreground">フォロー中</span>
          </div>
          <div>
            <span className="font-display text-base font-bold tabular-nums">{stats?.followers ?? 0}</span>
            <span className="ml-1 text-muted-foreground">フォロワー</span>
          </div>
        </div>
      </div>
    </div>
  );
}