import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MessageCircle, RefreshCw } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LikeButton } from '@/components/post/LikeButton';
import { CommentList } from '@/components/post/CommentList';
import { CommentForm } from '@/components/post/CommentForm';
import { PostImages } from '@/components/feed/PostImages';
import { usePost } from '@/hooks/useFeed';
import { formatDate, formatRelative } from '@/lib/format';

export default function PostDetail() {
  const { id = '' } = useParams();
  const { data, isLoading, isError } = usePost(id);
  const navigate = useNavigate();

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm font-bold text-muted-foreground transition hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> 戻る
      </button>

      {isLoading && (
        <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft">
          <div className="flex gap-3">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </div>
        </div>
      )}
      
{isError && (
        <div className="rounded-3xl border border-destructive/40 bg-destructive/5 p-6 text-center">
          <p className="text-sm text-destructive">投稿の読み込みに失敗しました。</p>
          {/* ボタンを削除しました */}
        </div>
      )}

      {data === null && (
        <div className="rounded-3xl border border-border/60 bg-card p-8 text-center text-muted-foreground">
          投稿が見つかりませんでした。
        </div>
      )}

      {data && (
        <article className="rounded-3xl border border-border/60 bg-card p-6 shadow-soft">
          <div className="flex items-center gap-3">
            <Link to={`/u/${data.author.username}`}>
              <Avatar className="h-12 w-12 border-2 border-primary/30">
                <AvatarImage src={data.author.avatarUrl} alt={data.author.displayName} />
                <AvatarFallback>{data.author.displayName.slice(0, 1)}</AvatarFallback>
              </Avatar>
            </Link>
            <div className="min-w-0">
              <Link to={`/u/${data.author.username}`} className="block truncate font-display font-bold hover:underline">
                {data.author.displayName}
              </Link>
              <p className="truncate text-xs text-muted-foreground">@{data.author.username}</p>
            </div>
          </div>

          <p className="mt-4 whitespace-pre-wrap break-words text-base leading-relaxed">{data.content}</p>
          <PostImages urls={data.imageUrls} />

          <p className="mt-4 text-xs text-muted-foreground" title={formatDate(data.createdAt)}>
            {formatDate(data.createdAt)} · {formatRelative(data.createdAt)}
            {data.clientName && (
              <>
                <span className="mx-1">·</span>
                <span className="text-primary/80 font-medium">
                  {data.clientName}
                </span>
              </>
            )}
          </p>

          <div className="mt-3 flex items-center gap-1 border-t border-border/60 pt-3">
            <LikeButton postId={data.id} liked={data.likedByMe} count={data.likesCount} />
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm text-muted-foreground">
              <MessageCircle className="h-5 w-5" />
              <span className="font-bold tabular-nums">{data.commentsCount}</span>
            </span>
          </div>
        </article>
      )}

      {data && (
        <>
          <CommentForm postId={data.id} />
          <div>
            <h2 className="mb-3 font-display text-base font-bold text-foreground">コメント</h2>
            <CommentList postId={data.id} />
          </div>
        </>
      )}
    </div>
  );
}
