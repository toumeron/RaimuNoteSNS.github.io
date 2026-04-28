import { useState, useEffect } from 'react'; 
import { Link } from 'react-router-dom';
import { MessageCircle, MoreHorizontal, Trash2, CalendarDays } from 'lucide-react'; 
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LikeButton } from '@/components/post/LikeButton';
import { PostImages } from './PostImages';
import { formatRelative } from '@/lib/format';
import type { PostWithAuthor } from '@/types';
import { deletePost } from '@/api/posts';
import { getCurrentUserId } from '@/lib/currentUser';
import { getYouTubeId } from '@/lib/utils';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import dayjs from 'dayjs';

// --- 追加インポート ---
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { FollowButton } from '../profile/FollowButton'; 
import { useFollowStats } from '@/hooks/useProfile';

export function PostCard({ post }: { post: PostWithAuthor }) {
  const [showMenu, setShowMenu] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    getCurrentUserId().then(id => setCurrentUserId(id));
  }, []);

  const isMyPost = currentUserId === post.userId;
  const youtubeId = getYouTubeId(post.content);

  const displayContent = youtubeId 
    ? post.content
        .replace(/(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/(watch\?v=|embed\/|shorts\/)?([a-zA-Z0-9_-]{11})([^?\s\n]*)?(\S+)?/g, '')
        .trim()
    : post.content;

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!confirm('投稿を削除しますか？')) return;
    try {
      await deletePost(post.id);
      window.location.reload();
    } catch (err) {
      alert('削除に失敗しました');
    }
  };

  // --- プロフィールホバー内専用の統計表示コンポーネント ---
  const HoverStats = ({ userId }: { userId: string }) => {
    const { data: stats } = useFollowStats(userId);
    return (
      <div className="mt-2.5 flex items-center gap-3 text-[11px]">
        <div className="flex items-center gap-1">
          <span className="font-bold text-foreground tabular-nums">
            {stats?.following ?? 0}
          </span>
          <span className="text-muted-foreground">フォロー</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="font-bold text-foreground tabular-nums">
            {stats?.followers ?? 0}
          </span>
          <span className="text-muted-foreground">フォロワー</span>
        </div>
      </div>
    );
  };

  // --- ホバーカードの中身 (w-50 = 200px 相当に最適化) ---
  const ProfileHoverContent = () => (
    <HoverCardContent 
      side="bottom" 
      align="start" 
      /* w-50 (200px) に合わせ、パディングを p-3.5 に縮小 */
      className="w-[200px] rounded-2xl border border-border/60 bg-card p-3.5 shadow-xl animate-in fade-in zoom-in duration-200"
    >
      <div className="flex justify-between items-start mb-2">
        {/* アバターを 14 -> 10 (40px) に縮小 */}
        <Avatar className="h-10 w-10 border border-primary/20">
          <AvatarImage src={post.author.avatarUrl} alt={post.author.displayName} />
          <AvatarFallback>{post.author.displayName.slice(0, 1)}</AvatarFallback>
        </Avatar>
        
        {/* FollowButton が大きい場合は、内部のスタイル調整が必要かもしれません */}
        {currentUserId !== post.author.id && (
          <div className="scale-90 origin-right">
            <FollowButton userId={post.author.id} />
          </div>
        )}
      </div>

      <div className="space-y-0.5">
        <div className="flex items-center gap-0.5 min-w-0">
          {/* 文字サイズを text-sm に統一し、均等感を出す */}
          <span className="font-display text-sm font-black text-foreground truncate">
            {post.author.displayName}
          </span>
          {post.author.isOfficial && (
            <img 
              src={`${import.meta.env.BASE_URL}verified.png`} 
              alt="Official" 
              className="h-[1em] w-[1em] shrink-0"
            />
          )}
        </div>
        <p className="text-[11px] text-muted-foreground leading-none">@{post.author.username}</p>
      </div>

      {post.author.bio && (
        /* bioの文字サイズを text-[11px] にし、行間を詰める */
        <p className="mt-2 text-[11px] leading-snug line-clamp-2 whitespace-pre-wrap text-foreground/90">
          {post.author.bio}
        </p>
      )}

      {/* 参加日 */}
      <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground opacity-80">
        <CalendarDays className="h-3 w-3" />
        {dayjs(post.author.createdAt).format('YYYY年M月')} から
      </div>

      <HoverStats userId={post.author.id} />
    </HoverCardContent>
  );

  return (
    <article className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft transition hover:shadow-card-soft relative">
      <div className="flex items-start gap-3">
        {/* アバターホバー */}
        <HoverCard openDelay={300}>
          <HoverCardTrigger asChild>
            <Link to={`/u/${post.author.username}`} className="shrink-0">
              <Avatar className="h-11 w-11 border-2 border-primary/30">
                <AvatarImage src={post.author.avatarUrl} alt={post.author.displayName} />
                <AvatarFallback>{post.author.displayName.slice(0, 1)}</AvatarFallback>
              </Avatar>
            </Link>
          </HoverCardTrigger>
          <ProfileHoverContent />
        </HoverCard>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center overflow-hidden w-full min-w-0">
              {/* 名前ホバー */}
              <HoverCard openDelay={300}>
                <HoverCardTrigger asChild>
                  <Link 
                    to={`/u/${post.author.username}`} 
                    className="flex items-center min-w-0 shrink font-display font-bold text-foreground hover:underline"
                  >
                    <div className="flex items-center gap-0.5 min-w-0">
                      <span className="truncate text-base">{post.author.displayName}</span>
                      {post.author.isOfficial && (
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
              
              <span className="truncate text-sm text-muted-foreground ml-1 opacity-80 shrink">
                @{post.author.username}
              </span>
              
              <span className="text-muted-foreground mx-1 shrink-0">·</span>
              <span className="text-sm text-muted-foreground whitespace-nowrap shrink-0">
                {formatRelative(post.createdAt)}
              </span>
            </div>
            
            {isMyPost && (
              <div className="relative ml-2 shrink-0">
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  className="p-1 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <MoreHorizontal className="h-5 w-5" />
                </button>
                {showMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                    <div className="absolute right-0 mt-1 w-32 rounded-xl border border-border bg-card p-1 shadow-lg z-20 overflow-hidden animate-in fade-in zoom-in duration-100">
                      <button
                        onClick={handleDelete}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                        削除
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <Link to={`/post/${post.id}`} className="block mt-1">
            {displayContent && (
              <p className="whitespace-pre-wrap break-words text-base leading-relaxed text-foreground">
                {displayContent}
              </p>
            )}
            {youtubeId && <YouTubeEmbed videoId={youtubeId} />}
            <PostImages urls={post.imageUrls} />
          </Link>

          <div className="mt-4 flex items-center gap-1 text-muted-foreground">
            <LikeButton postId={post.id} liked={post.likedByMe} count={post.likesCount} />
            <Link
              to={`/post/${post.id}`}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors hover:text-accent"
            >
              <MessageCircle className="h-5 w-5" />
              <span className="font-bold tabular-nums text-sm">{post.commentsCount}</span>
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}