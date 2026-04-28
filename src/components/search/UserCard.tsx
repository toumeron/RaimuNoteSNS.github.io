import { Link } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { FollowButton } from "../profile/FollowButton";
import { getCurrentUserId } from "@/lib/currentUser";
import { useEffect, useMemo, useState } from "react";
import type { User } from "@/types";

interface UserCardProps {
  user: User;
}

function getInitials(name?: string) {
  const s = (name ?? "").trim();
  if (!s) return "U";
  return s.slice(0, 1).toUpperCase();
}

export default function UserCard({ user }: UserCardProps) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    getCurrentUserId()
      .then((id) => {
        if (mounted) setCurrentUserId(id);
      })
      .catch(() => {
        if (mounted) setCurrentUserId(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const initials = useMemo(() => getInitials(user.displayName), [user.displayName]);

  return (
    <div className="flex items-start justify-between px-4 py-3 hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-colors bg-transparent border-b border-border/40 w-full">
      <Link to={`/u/${user.username}`} className="flex gap-3 min-w-0 flex-1">
        <Avatar className="h-10 w-10 shrink-0">
          <AvatarImage src={user.avatarUrl} alt={user.displayName} />
          <AvatarFallback className="bg-muted text-[12px] font-bold">
            {initials}
          </AvatarFallback>
        </Avatar>

        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-1 min-w-0">
            <span className="font-bold text-foreground truncate text-[15px] hover:underline decoration-1">
              {user.displayName}
            </span>

            {user.isOfficial && (
              <img
                src="/verified.png"
                alt="認証済み"
                className="h-[18px] w-[18px] shrink-0 object-contain"
              />
            )}
          </div>

          <span className="text-muted-foreground/80 text-[14px] leading-none">
            @{user.username}
          </span>

          {user.bio && (
            <p className="text-[14.5px] text-foreground/90 mt-1 line-clamp-2 leading-snug">
              {user.bio}
            </p>
          )}
        </div>
      </Link>

      {currentUserId !== user.id && (
        <div className="shrink-0 ml-3 pt-1">
          <div className="[&_button]:!h-[32px] [&_button]:!px-4 [&_button]:!text-[14px] [&_button]:!font-bold [&_button]:!rounded-full [&_button]:!border-none [&_button]:!bg-foreground [&_button]:!text-background hover:[&_button]:!opacity-90 transition-opacity">
            <FollowButton userId={user.id} />
          </div>
        </div>
      )}
    </div>
  );
}