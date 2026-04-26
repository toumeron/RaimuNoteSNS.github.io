import { Heart, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PostComposer } from '@/components/feed/PostComposer';
import { PostCard } from '@/components/feed/PostCard';
import { PostCardSkeleton } from '@/components/feed/PostCardSkeleton';
import { useFeed } from '@/hooks/useFeed';

export default function Feed() {
  const { data, isLoading, isError, refetch, isFetching } = useFeed();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="inline-flex items-center gap-2 font-display text-2xl font-black">
          <Heart className="h-5 w-5 fill-primary text-primary" />
          タイムライン
        </h1>
        <span className="ribbon-tag">
          <Sparkles className="h-3 w-3" />
          LimeNoteBeta
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
            <p className="mb-3 text-sm text-destructive">投稿の読み込みに失敗しました。</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="rounded-full">
              <RefreshCw className="mr-1.5 h-4 w-4" />
              もう一度試す
            </Button>
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

        {data && isFetching && (
          <p className="text-center text-xs text-muted-foreground">更新中…</p>
        )}
      </div>
    </div>
  );
}
