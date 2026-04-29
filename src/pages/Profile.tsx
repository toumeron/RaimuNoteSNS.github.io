import { useParams } from 'react-router-dom';
import { useEffect } from 'react'; // 追加
import { useInView } from 'react-intersection-observer'; // 追加
import { Loader2 } from 'lucide-react'; // 追加
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { PostCard } from '@/components/feed/PostCard';
import { PostCardSkeleton } from '@/components/feed/PostCardSkeleton';
import { Skeleton } from '@/components/ui/skeleton';
import { useProfile, useUserPostsInfinite } from '@/hooks/useProfile'; // useUserPostsInfiniteに変更

export default function Profile() {
  const { username = '' } = useParams();
  const { data: user, isLoading: userLoading, isError: userError } = useProfile(username);
  
  // 新しい無限スクロール用のフックに変更
  const { 
    data, 
    isLoading: postsLoading, 
    fetchNextPage, 
    hasNextPage, 
    isFetchingNextPage 
  } = useUserPostsInfinite(user?.id);

  // スクロール検知用
  const { ref, inView } = useInView();

  // 最下部までスクロールしたら次を読み込む
  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // 二次元配列になっている投稿データをフラットに変換
  const allPosts = data?.pages.flatMap((page) => page) ?? [];

  if (userLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-72 w-full rounded-3xl" />
        <PostCardSkeleton />
        <PostCardSkeleton />
      </div>
    );
  }

  if (userError || user === null) {
    return (
      <div className="rounded-3xl border border-border/60 bg-card p-10 text-center text-muted-foreground">
        ユーザーが見つかりませんでした。
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {user && <ProfileHeader user={user} />}

      <h2 className="font-display text-lg font-bold">投稿</h2>

      <div className="space-y-4">
        {/* 初回読み込み時のスケルトン */}
        {postsLoading && (
          <>
            <PostCardSkeleton />
            <PostCardSkeleton />
          </>
        )}

        {/* 投稿ゼロの判定 */}
        {!postsLoading && allPosts.length === 0 && (
          <div className="rounded-3xl border border-dashed border-border bg-card/60 p-8 text-center text-sm text-muted-foreground">
            まだ投稿がありません。
          </div>
        )}

        {/* 投稿リスト */}
        {allPosts.map((p) => (
          <div key={p.id} className="animate-float-up">
            <PostCard post={p} />
          </div>
        ))}

        {/* 無限スクロールのトリガー */}
        <div ref={ref} className="py-10 flex justify-center">
          {isFetchingNextPage ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">さらに読み込み中...</span>
            </div>
          ) : hasNextPage ? (
            <div className="h-10" />
          ) : allPosts.length > 0 ? (
            <p className="text-xs text-muted-foreground text-center">
              すべての投稿を表示しました
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}