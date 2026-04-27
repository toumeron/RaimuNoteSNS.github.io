import { useState, useEffect } from 'react'; 
import { Link } from 'react-router-dom';
import { MessageCircle, MoreHorizontal, Trash2 } from 'lucide-react'; 
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LikeButton } from '@/components/post/LikeButton';
import { PostImages } from './PostImages';
import { formatRelative } from '@/lib/format';
import type { PostWithAuthor } from '@/types';
import { deletePost } from '@/api/posts';
import { getCurrentUserId } from '@/lib/currentUser';
import { getYouTubeId } from '@/lib/utils';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';

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

  return (
    <article className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft transition hover:shadow-card-soft relative">
      <div className="flex items-start gap-3">
        <Link to={`/u/${post.author.username}`} className="shrink-0">
          <Avatar className="h-11 w-11 border-2 border-primary/30">
            <AvatarImage src={post.author.avatarUrl} alt={post.author.displayName} />
            <AvatarFallback>{post.author.displayName.slice(0, 1)}</AvatarFallback>
          </Avatar>
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
<div className="flex items-center gap-1.5 text-sm overflow-hidden w-full">
  <Link 
    to={`/u/${post.author.username}`} 
    className="flex items-center gap-1 truncate font-display font-bold text-foreground hover:underline shrink-0"
  >
    <span className="truncate">{post.author.displayName}</span>
{post.author.isOfficial && (
  <img 
    src="verified.png" 
    alt="Official" 
    className="h-4 w-4 shrink-0"
    onError={(e) => {
      // これでもダメな場合のデバッグ用
      console.log("Current Path Attempt:", (e.target as HTMLImageElement).src);
    }}
  />
)}

  </Link>
  
  <span className="truncate text-muted-foreground shrink">@{post.author.username}</span>
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

          <Link to={`/post/${post.id}`} className="block">
            {displayContent && (
              <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground">
                {displayContent}
              </p>
            )}
            {youtubeId && <YouTubeEmbed videoId={youtubeId} />}
            <PostImages urls={post.imageUrls} />
          </Link>

          <div className="mt-3 flex items-center gap-1 text-muted-foreground">
            <LikeButton postId={post.id} liked={post.likedByMe} count={post.likesCount} />
            <Link
              to={`/post/${post.id}`}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors hover:text-accent"
            >
              <MessageCircle className="h-5 w-5" />
              <span className="font-bold tabular-nums">{post.commentsCount}</span>
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}