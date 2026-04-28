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

  // --- 統計情報：画像通りのフォントサイズと太さ ---
  const HoverStats = ({ userId }: { userId: string }) => {
    const { data: stats } = useFollowStats(userId);
    return (
      <div className="mt-3 flex items-center gap-4 text-[14px]">
        <div className="flex items-center gap-1">
          <span className="font-bold text-foreground">{stats?.following ?? 0}</span>
          <span className="text-muted-foreground">フォロー中</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="font-bold text-foreground">{stats?.followers ?? 0}</span>
          <span className="text-muted-foreground">フォロワー</span>
        </div>
      </div>
    );
  };

  // --- ホバーカード：画像デザインを忠実に再現 ---
  const ProfileHoverContent = () => (
    <HoverCardContent 
      side="bottom" 
      align="start" 
      className="w-[280px] rounded-[20px] border border-border/60 bg-card p-4 shadow-xl animate-in fade-in zoom-in duration-200 overflow-hidden"
    >
      {/* アバターとフォローボタンの配置 */}
      <div className="flex justify-between items-start mb-3">
        <Avatar className="h-14 w-14 border border-primary/5">
          <AvatarImage src={post.author.avatarUrl} alt={post.author.displayName} />
          <AvatarFallback>{post.author.displayName.slice(0, 1)}</AvatarFallback>
        </Avatar>
        
        {currentUserId !== post.author.id && (
          /* ボタンの強制上書きスタイル:
             - bg-foreground / text-background (画像のような白黒反転)
             - rounded-full / font-bold / h-9
          */
          <div className="shrink-0 [&_button]:w-[90px] [&_button]:h-[36px] [&_button]:rounded-full [&_button]:font-bold [&_button]:text-[14px] [&_button]:bg-foreground [&_button]:text-background [&_button]:border-none [&_button]:hover:opacity-90">
            <FollowButton userId={post.author.id} />
          </div>
        )}
      </div>

      {/* 名前とユーザー名：画像に近いフォントサイズ */}
      <div className="space-y-0">
        <div className="flex items-center gap-0.5">
          <span className="text-[18px] font-black text-foreground truncate leading-tight">
            {post.author.displayName}
          </span>
          {post.author.isOfficial && (
            <img 
              src={`${import.meta.env.BASE_URL}verified.png`} 
              alt="Official" 
              className="h-[1.1em] w-[1.1em] transform translate-y-[1px]"
            />
          )}
        </div>
        <p className="text-[15px] text-muted-foreground">@{post.author.username}</p>
      </div>

      {/* 自己紹介 */}
      {post.author.bio && (
        <p className="mt-3 text-[15px] leading-normal text-foreground whitespace-pre-wrap line-clamp-3">
          {post.author.bio}
        </p>
      )}

      {/* アカウントの所在地/参加日（画像準拠） */}
      <div className="mt-3 flex items-center gap-1.5 text-[14px] text-muted-foreground">
        <CalendarDays className="h-4 w-4" />
        <span>{dayjs(post.author.createdAt).format('YYYY年M月')} から参加</span>
      </div>

      <HoverStats userId={post.author.id} />

      {/* プロフィールの要約ボタン（画像のUI再現用・装飾） */}
      <div className="mt-4 pt-1">
        <div className="flex items-center justify-center w-full h-[40px] rounded-full border border-border/60 hover:bg-muted/50 cursor-not-allowed">
          <span className="flex items-center gap-2 text-[14px] font-bold">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path d="M9 12l2 2 4-4" /></svg>
            プロフィールの要約
          </span>
        </div>
      </div>
    </HoverCardContent>
  );

  return (
    <article className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft transition hover:shadow-card-soft relative">
      <div className="flex items-start gap-3">
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