import { Link } from 'react-router-dom';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { FollowButton } from '../profile/FollowButton';
import { getCurrentUserId } from '@/lib/currentUser';
import { useState, useEffect } from 'react';
import type { User } from '@/types';

export function UserCard({ user }: { user: User }) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    getCurrentUserId().then(id => setCurrentUserId(id));
  }, []);

  return (
    <div className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors border-b border-border/50">
      <Link to={`/u/${user.username}`} className="flex items-center gap-3 min-w-0 flex-1">
        <Avatar className="h-12 w-12 shrink-0 border border-primary/10">
          <AvatarImage src={user.avatarUrl} alt={user.displayName} />
          <AvatarFallback>{user.displayName.slice(0, 1)}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1 min-w-0">
            <span className="font-black text-foreground truncate text-[16px] leading-tight">
              {user.displayName}
            </span>
            {user.isOfficial && (
              <img src="/verified.png" alt="Official" className="h-4 w-4 shrink-0" />
            )}
          </div>
          <span className="text-muted-foreground text-[14px] truncate">@{user.username}</span>
          {user.bio && (
            <p className="text-[13px] text-foreground/80 line-clamp-1 mt-0.5">{user.bio}</p>
          )}
        </div>
      </Link>

      {currentUserId !== user.id && (
        <div className="shrink-0 ml-4 w-[90px] [&_button]:!h-[32px] [&_button]:!text-[12px] [&_button]:!font-bold [&_button]:!rounded-full">
          <FollowButton userId={user.id} />
        </div>
      )}
    </div>
  );
}