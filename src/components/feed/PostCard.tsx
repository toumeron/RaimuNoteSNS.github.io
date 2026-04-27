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
        {/* 左側：アバター（サイズ固定） */}
        <Link to={`/u/${post.author.username}`} className="shrink-0">
          <Avatar className="h-11 w-11 border-2 border-primary/30">
            <AvatarImage src={post.author.avatarUrl} alt={post.author.displayName} />
            <AvatarFallback>{post.author.displayName.slice(0, 1)}</AvatarFallback>
          </Avatar>
        </Link>

        {/* 右側：メインコンテンツ */}
        <div className="min-w-0 flex-1">
        {/* ヘッダー：名前、バッジ、ID */}
          <div className="flex items-center justify-between mb-1">
            {/* 名前・ID・時間を包むコンテナ。min-w-0 を入れることで子要素の省略を可能にする */}
            <div className="flex items-center overflow-hidden w-full min-w-0">
              <Link 
                to={`/u/${post.author.username}`} 
                /* 修正点: flex-1 を外し、min-w-0 と shrink を指定。
                  これにより「必要な分だけ幅を取りつつ、溢れそうなら自分が縮む」挙動になります。
                */
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
              
              {/* @ID: shrink を指定して、名前との幅の取り合いが発生した際に
                こちらも適切に省略されるように調整します。
              */}
              <span className="truncate text-sm text-muted-foreground ml-1.5 opacity-80 shrink">
                @{post.author.username}
              </span>
              
              {/* ドットと時間は「絶対に縮ませない(shrink-0)」ことで視認性を確保 */}
              <span className="text-muted-foreground mx-1 shrink-0">·</span>
              <span className="text-sm text-muted-foreground whitespace-nowrap shrink-0">
                {formatRelative(post.createdAt)}
              </span>
            </div>

            {/* 三点リーダー（省略） */}
            {isMyPost && (
              <div className="relative ml-2 shrink-0">
                {/* ...既存のメニューボタン... */}
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

          {/* 本文エリア：しっかり大きく(text-base)、読みやすく(leading-relaxed) */}
          <Link to={`/post/${post.id}`} className="block mt-1">
            {displayContent && (
              <p className="whitespace-pre-wrap break-words text-base leading-relaxed text-foreground">
                {displayContent}
              </p>
            )}
            {youtubeId && <YouTubeEmbed videoId={youtubeId} />}
            <PostImages urls={post.imageUrls} />
          </Link>

          {/* 下部アクション */}
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