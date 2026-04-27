import { Heart, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PostComposer } from '@/components/feed/PostComposer';
import { PostCard } from '@/components/feed/PostCard';
import { PostCardSkeleton } from '@/components/feed/PostCardSkeleton';
import { useFeed } from '@/hooks/useFeed';

export default function Feed() {
  const { data, isLoading, isError } = useFeed();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="inline-flex items-center gap-2 font-display text-2xl font-black">
          タイムライン
        </h1>
        <span className="ribbon-tag">
          <Sparkles className="h-3 w-3" />
          LaimeNoteBeta v1.3
        </span>
      </div>

      <PostComposer />

      <div className="space-y-4">
        {isLoading && (
          <>
            <PostCardSkeleton />
            <PostCardSkeleton />
            <PostCardSkeleton />
          </>
        )}

{isError && (
          <div className="rounded-3xl border border-destructive/40 bg-destructive/5 p-6 text-center">
            <p className="text-sm text-destructive font-bold">投稿の読み込みに失敗しました。</p>
            <p className="text-xs text-destructive/60 mt-1">しばらく時間を置いてから再度お試しください。</p>
          </div>
        )}
        {data && data.length === 0 && (
          <div className="rounded-3xl border border-dashed border-border bg-card/60 p-10 text-center text-muted-foreground">
            まだ投稿がありません。最初のポストをしてみよう
          </div>
        )}

        {data?.map((post) => (
          <div key={post.id} className="animate-float-up">
            <PostCard post={post} />
          </div>
        ))}
      </div>
    </div>
  );
}
