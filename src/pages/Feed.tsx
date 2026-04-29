import { Heart, RefreshCw, Sparkles, Loader2 } from 'lucide-react'; // Loader2を追加
import { useEffect } from 'react'; // 追加
import { useInView } from 'react-intersection-observer'; // 追加
import { PostComposer } from '@/components/feed/PostComposer';
import { PostCard } from '@/components/feed/PostCard';
import { PostCardSkeleton } from '@/components/feed/PostCardSkeleton';
import { useFeed } from '@/hooks/useFeed';

export default function Feed() {
  // useInfiniteQuery用に取得する変数を変更
  const { 
    data, 
    isLoading, 
    isError, 
    fetchNextPage, 
    hasNextPage, 
    isFetchingNextPage 
  } = useFeed();

  // 最下部の要素が画面に入ったかを検知するhook
  const { ref, inView } = useInView();

  // 画面最下部に到達、かつ次のページがある場合に読み込む
  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // InfiniteQueryのデータ構造から投稿をフラットな配列に変換
  const allPosts = data?.pages.flatMap((page) => page) ?? [];

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

        {/* data.length ではなく allPosts.length で判定 */}
        {!isLoading && allPosts.length === 0 && (
          <div className="rounded-3xl border border-dashed border-border bg-card/60 p-10 text-center text-muted-foreground">
            まだ投稿がありません。最初のポストをしてみよう
          </div>
        )}

        {/* 投稿リストのレンダリング */}
        {allPosts.map((post) => (
          <div key={post.id} className="animate-float-up">
            <PostCard post={post} />
          </div>
        ))}

        {/* 無限スクロールのトリガー要素 */}
        <div ref={ref} className="py-10 flex justify-center">
          {isFetchingNextPage ? (
            <div className="flex items-center gap-2 text-muted-foreground animate-pulse">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm font-medium">読み込み中...</span>
            </div>
          ) : hasNextPage ? (
            <div className="h-10" /> /* 次のページがある場合の待機用スペース */
          ) : allPosts.length > 0 ? (
            <p className="text-xs text-muted-foreground">すべての投稿を読み込みました</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}