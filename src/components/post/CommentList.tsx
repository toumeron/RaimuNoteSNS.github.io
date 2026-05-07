import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { MoreHorizontal, Trash2, CalendarDays } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Commentlikebutton } from '@/components/post/Commentlikebutton';
import { FollowButton } from '@/components/profile/FollowButton';
import { useFollowStats } from '@/hooks/useProfile';
import { useComments } from '@/hooks/useComments';
import { getCurrentUserId } from '@/lib/currentUser';
import { formatRelative } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import dayjs from 'dayjs';

// ─── 型 ───────────────────────────────────────────────────────────────────────
interface CommentAuthor {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  isOfficial?: boolean;
  bio?: string;
  createdAt: string;
}
interface Comment {
  id: string;
  postId: string;
  userId: string;
  content: string;
  createdAt: string;
  likesCount: number;
  likedByMe: boolean;
  author: CommentAuthor;
}

// ─── ユーティリティ ─────────────────────────────────────
const formatDisplayCount = (count: number) => {
  if (count >= 10000) return (count / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  return count.toLocaleString();
};

const renderContentWithMentions = (text: string) => {
  if (!text) return null;
  const parts = text.split(/(@\w+)/g);
  return parts.map((part, index) => {
    if (part.startsWith('@')) {
      const username = part.substring(1);
      return (
        <Link
          key={index}
          to={`/u/${username}`}
          className="text-pink-500 hover:underline transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </Link>
      );
    }
    return part;
  });
};

// ─── CommentCard ──────────────────────────────────────────────────────────────
function CommentCard({
  comment,
  currentUserId,
}: {
  comment: Comment;
  currentUserId: string | null;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const isMyComment = currentUserId === comment.userId;

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('コメントを削除しますか？')) return;
    try {
      await supabase.from('comments').delete().eq('id', comment.id);
      setDeleted(true);
    } catch {
      alert('削除に失敗しました');
    }
  };

  const HoverStats = ({ userId }: { userId: string }) => {
    const { data: stats } = useFollowStats(userId);
    return (
      <div className="mt-3 flex items-center gap-4 text-[14px]">
        <div className="flex items-center gap-1">
          <span className="font-bold text-foreground">
            {stats ? formatDisplayCount(stats.following) : 0}
          </span>
          <span className="text-muted-foreground">フォロー中</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="font-bold text-foreground">
            {stats ? formatDisplayCount(stats.followers) : 0}
          </span>
          <span className="text-muted-foreground">フォロワー</span>
        </div>
      </div>
    );
  };

  const ProfileHoverContent = () => (
    <HoverCardContent
      side="bottom"
      align="start"
      className="w-[280px] rounded-[20px] border border-border/60 bg-card p-4 shadow-xl animate-in fade-in zoom-in duration-200 overflow-hidden"
    >
      <div className="flex justify-between items-start mb-3">
        <Avatar className="h-14 w-14 border border-primary/5">
          <AvatarImage src={comment.author.avatarUrl} alt={comment.author.displayName} />
          <AvatarFallback>{comment.author.displayName.slice(0, 1)}</AvatarFallback>
        </Avatar>
        {currentUserId !== comment.author.id && (
          <div className="shrink-0 w-[85px] h-[36px]" onClick={(e) => e.stopPropagation()}>
            <div className="w-full h-full [&>*]:!w-full [&>*]:!h-full [&>*]:!min-w-0 [&>*]:!p-0 [&>*]:!flex [&>*]:!items-center [&>*]:!justify-center [&>*]:!bg-foreground [&>*]:!text-background [&>*]:!rounded-full [&>*]:!text-[14px] [&>*]:!font-bold [&>*]:!border-none [&_svg]:!hidden">
              <FollowButton userId={comment.author.id} />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-0.5">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-base font-black text-foreground truncate leading-tight shrink">
            {comment.author.displayName}
          </span>
          {comment.author.isOfficial && (
            <img
              src={`${import.meta.env.BASE_URL}verified.png`}
              alt="Official"
              className="h-[1.1em] w-[1.1em] shrink-0 transform translate-y-[1px]"
            />
          )}
        </div>
        <p className="text-[15px] text-muted-foreground leading-none">
          @{comment.author.username}
        </p>
      </div>

      {comment.author.bio && (
        <p className="mt-3 text-[15px] leading-normal text-foreground whitespace-pre-wrap line-clamp-3">
          {comment.author.bio}
        </p>
      )}

      <div className="mt-3 flex items-center gap-1.5 text-[14px] text-muted-foreground">
        <CalendarDays className="h-4 w-4" />
        <span>{dayjs(comment.author.createdAt).format('YYYY年M月')} から参加</span>
      </div>

      <HoverStats userId={comment.author.id} />
    </HoverCardContent>
  );

  if (deleted) return null;

  return (
    <article className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft transition hover:shadow-card-soft relative">
      <div className="flex items-start gap-3">
        <HoverCard openDelay={300}>
          <HoverCardTrigger asChild>
            <Link
              to={`/u/${comment.author.username}`}
              className="shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <Avatar className="h-11 w-11 border-2 border-primary/30">
                <AvatarImage src={comment.author.avatarUrl} alt={comment.author.displayName} />
                <AvatarFallback>{comment.author.displayName.slice(0, 1)}</AvatarFallback>
              </Avatar>
            </Link>
          </HoverCardTrigger>
          <ProfileHoverContent />
        </HoverCard>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center overflow-hidden w-full min-w-0">
              <HoverCard openDelay={300}>
                <HoverCardTrigger asChild>
                  <Link
                    to={`/u/${comment.author.username}`}
                    className="flex items-center min-w-0 shrink font-display font-bold text-foreground hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-0.5 min-w-0">
                      <span className="truncate text-base">{comment.author.displayName}</span>
                      {comment.author.isOfficial && (
                        <img
                          src={`${import.meta.env.BASE_URL}verified.png`}
                          alt="Official"
                          className="h-4 w-4 shrink-0 transform translate-y-[0.5px]"
                          loading="eager"
                        />
                      )}
                    </div>
                  </Link>
                </HoverCardTrigger>
                <ProfileHoverContent />
              </HoverCard>

              <span className="truncate text-base text-muted-foreground ml-1 opacity-80 shrink">
                @{comment.author.username}
              </span>
              <span className="text-muted-foreground mx-1 shrink-0">·</span>
              <span className="text-sm text-muted-foreground whitespace-nowrap shrink-0">
                {formatRelative(comment.createdAt)}
              </span>
            </div>

            <div className="relative ml-2 shrink-0">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowMenu(!showMenu);
                }}
                className="p-1 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
              {showMenu && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={(e) => { e.stopPropagation(); setShowMenu(false); }}
                  />
                  <div
                    className="absolute right-0 mt-1 w-44 rounded-xl border border-border bg-card p-1 shadow-lg z-20 overflow-hidden animate-in fade-in zoom-in duration-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isMyComment && (
                      <button
                        onClick={handleDelete}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-destructive hover:bg-destructive/10 transition-colors border-t border-border/50 mt-1"
                      >
                        <Trash2 className="h-4 w-4" />
                        削除
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="mt-1">
            <div onClick={(e) => e.stopPropagation()}>
              {comment.content && (
                <p className="whitespace-pre-wrap break-words text-base leading-relaxed text-foreground">
                  {renderContentWithMentions(comment.content)}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center gap-1 text-muted-foreground">
            <div onClick={(e) => e.stopPropagation()}>
              <Commentlikebutton
                commentId={comment.id}
                liked={comment.likedByMe}
                count={comment.likesCount}
              />
            </div>
          </div>

        </div>
      </div>
    </article>
  );
}

// ─── CommentList ──────────────────────────────────────────────────────────────
export function CommentList({ postId }: { postId: string }) {
  // useComments 内のクエリが comment_details ビューを参照するように修正されている前提
  const { data, isLoading, isError } = useComments(postId);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    getCurrentUserId().then(setCurrentUserId);
    const timer = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft">
            <div className="flex gap-3">
              <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-3xl border border-destructive/40 bg-destructive/5 p-6 text-center">
        <p className="text-sm text-destructive">コメントの読み込みに失敗しました。</p>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="rounded-3xl border border-border/60 bg-card p-8 text-center text-muted-foreground">
        まだコメントはありません。
      </div>
    );
  }

  return (
    <ul className="space-y-4">
      {data.map((c) => (
        <li key={c.id} className="animate-float-up">
          {/* comment.likedByMe が undefined の場合に false を保証する */}
          <CommentCard 
            comment={{
              ...c,
              likedByMe: !!(c as any).likedByMe
            } as unknown as Comment} 
            currentUserId={currentUserId} 
          />
        </li>
      ))}
    </ul>
  );
}