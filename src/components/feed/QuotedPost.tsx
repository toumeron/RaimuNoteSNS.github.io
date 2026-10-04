import './quoted-post.css';
import { PostCard } from './PostCard';
import type { PostWithAuthor } from '@/types';
import { RepostedReplyCard } from '@/components/post/RepostedReplyCard';

export function QuotedPost({ post, timelineGlass = false, compact = false }: { post?: PostWithAuthor | null; timelineGlass?: boolean; compact?: boolean }) {
  if (!post) return <div className="mt-3 rounded-2xl border border-border/60 p-4 text-sm text-muted-foreground">引用元の投稿は削除されたか、閲覧できません。</div>;
  // A quote of a quote shows the immediate quote and its source link, not
  // another recursively embedded card (the API intentionally loads one level).
  const replySource = (post as PostWithAuthor & { quoted_reply_id?: string }).quoted_reply_id;
  const sourceId = post.parentId || post.parentPost?.id || (replySource ? `reply:${replySource}` : null);
  const sourceUrl = sourceId ? new URL(`${import.meta.env.BASE_URL}post/${encodeURIComponent(sourceId)}`, window.location.origin).href : null;
  const preview = post.isQuote ? { ...post, isQuote: false, parentPost: null, content: sourceUrl && !post.content.includes(sourceUrl) ? `${post.content} ${sourceUrl}`.trim() : post.content } : post;
  return (
    <div data-lime-quoted-post data-lime-quote-preview={compact || undefined} className="mt-3 overflow-hidden rounded-2xl border border-border/60" onClick={event => event.stopPropagation()}>
      {post.replyId ? <RepostedReplyCard post={post} embedded /> : <PostCard post={preview} timelineGlass={timelineGlass} thread embedded />}
    </div>
  );
}
