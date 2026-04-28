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
import { FollowButton } from '../profile/FollowButton'; // パスは適宜調整してください
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
      <div className="mt-4 flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1">
          <span className="font-display font-bold text-foreground tabular-nums">
            {stats?.following ?? 0}
          </span>
          <span className="text-muted-foreground">フォロー中</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="font-display font-bold text-foreground tabular-nums">
            {stats?.followers ?? 0}
          </span>
          <span className="text-muted-foreground">フォロワー</span>
        </div>
      </div>
    );
  };

  // --- ホバーカードの中身 ---
  const ProfileHoverContent = () => (
    <HoverCardContent 
      side="bottom" 
      align="start" 
      className="w-80 rounded-3xl border border-border/60 bg-card p-5 shadow-xl animate-in fade-in zoom-in duration-200"
    >
      <div className="flex justify-between items-start mb-3">
        <Avatar className="h-14 w-14 border-2 border-primary/20">
          <AvatarImage src={post.author.avatarUrl} alt={post.author.displayName} />
          <AvatarFallback>{post.author.displayName.slice(0, 1)}</AvatarFallback>
        </Avatar>
        {/* 自分の投稿でなければフォローボタンを表示 */}
        {currentUserId !== post.author.id && (
          <FollowButton userId={post.author.id} />
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-0.5 min-w-0">
          <span className="font-display text-xl font-black text-foreground truncate">
            {post.author.displayName}
          </span>
          {post.author.isOfficial && (
            <img 
              src={`${import.meta.env.BASE_URL}verified.png`} 
              alt="Official" 
              className="h-[1.2em] w-[1.2em] shrink-0 transform translate-y-[1px]"
            />
          )}
        </div>
        <p className="text-[14px] text-muted-foreground">@{post.author.username}</p>
      </div>

      {post.author.bio && (
        <p className="mt-3 text-[14px] leading-relaxed line-clamp-3 whitespace-pre-wrap">
          {post.author.bio}
        </p>
      )}

      {/* 参加日の表示を追加 */}
      <div className="mt-3 flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5" />
        {dayjs(post.author.createdAt).format('YYYY年M月')} から参加
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
            
            {/* ...メニュー等の既存コード... */}
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