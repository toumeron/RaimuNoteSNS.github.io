import './quoted-post.css';
import { PostCard } from './PostCard';
import type { PostWithAuthor } from '@/types';
import { RepostedReplyCard } from '@/components/post/RepostedReplyCard';

export function QuotedPost({ post, timelineGlass = false, compact = false }: { post?: PostWithAuthor | null; timelineGlass?: boolean; compact?: boolean }) {
  if (!post) return <div className="mt-3 rounded-2xl border border-border/60 p-4 text-sm text-muted-foreground">引用元の投稿は削除されたか、閲覧できません。</div>;
  return (
    <div data-lime-quoted-post data-lime-quote-preview={compact || undefined} className="mt-3 overflow-hidden rounded-2xl border border-border/60" onClick={event => event.stopPropagation()}>
      {post.replyId ? <RepostedReplyCard post={post} embedded /> : <PostCard post={post} timelineGlass={timelineGlass} thread embedded />}
    </div>
  );
}
