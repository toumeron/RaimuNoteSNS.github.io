import { Link } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LikeButton } from '@/components/post/LikeButton';
import { PostImages } from './PostImages';
import { formatRelative } from '@/lib/format';
import type { PostWithAuthor } from '@/types';

export function PostCard({ post }: { post: PostWithAuthor }) {
  return (
    <article className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft transition hover:shadow-card-soft">
      <div className="flex items-start gap-3">
        <Link to={`/u/${post.author.username}`} className="shrink-0">
          <Avatar className="h-11 w-11 border-2 border-primary/30">
            <AvatarImage src={post.author.avatarUrl} alt={post.author.displayName} />
            <AvatarFallback>{post.author.displayName.slice(0, 1)}</AvatarFallback>
          </Avatar>
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 text-sm">
            <Link to={`/u/${post.author.username}`} className="truncate font-display font-bold text-foreground hover:underline">
              {post.author.displayName}
            </Link>
            <span className="truncate text-muted-foreground">@{post.author.username}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{formatRelative(post.createdAt)}</span>
            {/* ------------------------------------------- */}
          </div>

          <Link to={`/post/${post.id}`} className="block">
            <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground">
              {post.content}
            </p>
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
