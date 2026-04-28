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
              <svg
                viewBox="0 0 22 22"
                aria-label="認証済みアカウント"
                className="h-[18px] w-[18px] text-[#1d9bf0] shrink-0 fill-current"
              >
                <g>
                  <path d="M20.396 11c-.018-.646-.215-1.275-.573-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44-.54-.355-1.168-.551-1.813-.569-.651-.013-1.284.183-1.818.56-.535.376-.948.9-1.19 1.512-.616-.213-1.277-.253-1.909-.115-.633.136-1.213.447-1.676.896-.453.444-.766 1.02-.906 1.65-.14.63-.1 1.288.115 1.9-.613.237-1.14.64-1.524 1.17-.383.527-.604 1.15-.64 1.802-.03.652.144 1.293.502 1.832.358.54.865.973 1.46 1.243-.222.608-.269 1.265-.14 1.898.131.632.437 1.218.882 1.687.47.445 1.053.75 1.687.882.633.13 1.29.083 1.897-.14.274.588.705 1.087 1.245 1.441.541.354 1.17.55 1.815.567.65.015 1.283-.181 1.817-.558.535-.376.948-.9 1.19-1.512.617.21 1.277.25 1.909.112.633-.137 1.213-.448 1.676-.897.454-.444.766-1.02.906-1.65.14-.63.1-1.289-.115-1.9.613-.236 1.141-.639 1.524-1.169.384-.53.604-1.152.64-1.802zM9.503 16.03l-3.705-3.815 1.485-1.44 2.135 2.198 5.3-5.61 1.575 1.485-6.79 7.182z"></path>
                </g>
              </svg>
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