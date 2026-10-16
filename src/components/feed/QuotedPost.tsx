import { quotePreviewText } from "@/lib/postPresentation";
import "@/components/feed/quoted-post.css";
import { PostCard } from "@/components/feed/PostCard";
import { type PostWithAuthor } from "@/types/index";
import { RepostedReplyCard } from "@/components/post/CommentList";
import { PostOverlay } from "@/App";
import { pollPercent, pollRemaining } from "@/lib/polls";

// QuotedPost
function QuotedPost({ post, timelineGlass = false, compact = false }: { post?: PostWithAuthor | null; timelineGlass?: boolean; compact?: boolean }) {
  if (!post) return <div className="mt-3 rounded-2xl border border-border/60 p-4 text-sm text-muted-foreground">引用元の投稿は削除されたか、閲覧できません。</div>;
  // A quote of a quote shows the immediate quote and its source link, not
  // another recursively embedded card (the API intentionally loads one level).
  const replySource = (post as PostWithAuthor & { quoted_reply_id?: string }).quoted_reply_id;
  const sourceId = post.parentId || post.parentPost?.id || (replySource ? `reply:${replySource}` : null);
  const sourceUrl = sourceId ? new URL(`${import.meta.env.BASE_URL}post/${encodeURIComponent(sourceId)}`, window.location.origin).href : null;
  const preview = post.isQuote ? { ...post, isQuote: false, parentPost: null, content: sourceUrl && !post.content.includes(sourceUrl) ? `${post.content} ${sourceUrl}`.trim() : post.content } : post;
  const hasPhoto=(post.imageUrls??[]).some(url=>url!==post.linkPreview?.image)||/https?:\/\/\S+\.(?:png|jpe?g|gif|webp)(?:[?#]\S*)?/i.test(post.content);
  const hasText=!!post.content.replace(/https?:\/\/\S+/g,'').trim();
  const boundedPreview={...preview,content:quotePreviewText(preview.content)};
  return (
    <div data-lime-quoted-post data-lime-quote-image-text={hasPhoto&&hasText||undefined} data-lime-quote-preview={compact || undefined} className="mt-3 overflow-hidden rounded-2xl border border-border/60" onClick={event => event.stopPropagation()}>
      {post.replyId ? <RepostedReplyCard post={boundedPreview} embedded /> : <PostCard post={boundedPreview} timelineGlass={timelineGlass} thread embedded />}
    </div>
  );
}

// QuoteModal
// Reuse the same desktop overlay and mobile full-screen composer as a regular post.
function QuoteModal({ post, onClose }: { post: PostWithAuthor; onClose: () => void }) {
  return <PostOverlay isOpen initialQuotedPost={post} onClose={onClose} />;
}

// ExternalPostDetails
function ExternalPostDetails({post}:{post:PostWithAuthor}){
 const details=post.externalDetails;if(!details||!details.poll&&!details.communityNote)return null;
 const poll=details.poll,total=poll?.options.reduce((sum,option)=>sum+option.votes,0)??0;
 return <div onClick={event=>event.stopPropagation()}>
  {poll&&<section aria-label="twitterの投票" className="my-4">
   <div className="space-y-2">{poll.options.map((option,index)=>{const percent=pollPercent(option.votes,total);return <div key={index} className="relative flex min-h-11 items-center justify-between overflow-hidden rounded-md px-3 py-2"><div aria-hidden="true" className="absolute inset-y-0 left-0 rounded-md bg-foreground/15" style={{width:`${Math.max(1,percent)}%`}}/><span className="relative min-w-0 break-words">{option.label}</span><span className="relative ml-2 shrink-0 tabular-nums">{percent}%</span></div>;})}</div>
   <p className="mt-3 text-xs text-muted-foreground">{total.toLocaleString()}票 · {pollRemaining(poll.endsAt)}</p>
   {Date.parse(poll.endsAt)>Date.now()&&<a className="mt-2 inline-block text-sm text-primary hover:underline" href={post.blueskyUrl} target="_blank" rel="noopener noreferrer">twitterで投票する</a>}
  </section>}
  {details.communityNote&&<section aria-label="コミュニティノート" className="my-3 rounded-xl border border-border p-3 text-sm"><p className="mb-1 font-semibold">コミュニティノート</p><p className="whitespace-pre-wrap break-words">{details.communityNote}</p></section>}

 </div>;
}

export { QuotedPost };
export { QuoteModal };
export { ExternalPostDetails };
