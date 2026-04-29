import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { Loader2 } from 'lucide-react';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { PostCard } from '@/components/feed/PostCard';
import { PostCardSkeleton } from '@/components/feed/PostCardSkeleton';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useProfile, useUserPostsInfinite, useUserLikesInfinite } from '@/hooks/useProfile';

export default function Profile() {
  const { username = '' } = useParams();
  const [activeTab, setActiveTab] = useState<'posts' | 'likes'>('posts');
  
  const { data: user, isLoading: userLoading, isError: userError } = useProfile(username);
  
  // 通常の投稿用無限スクロール
  const postsQuery = useUserPostsInfinite(user?.id);
  
  // いいねした投稿用無限スクロール
  const likesQuery = useUserLikesInfinite(user?.id);

  // 現在表示しているタブに合わせてクエリの結果を切り替える
  const currentQuery = activeTab === 'posts' ? postsQuery : likesQuery;
  const { 
    data, 
    isLoading: contentLoading, 
    fetchNextPage, 
    hasNextPage, 
    isFetchingNextPage 
  } = currentQuery;

  // スクロール検知用
  const { ref, inView } = useInView();

  // 最下部までスクロールしたら次を読み込む
  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // データのフラット化処理
  // activeTabが'likes'の場合、データ構造が like { posts: { ... } } になるため抽出が必要
  const allPosts = data?.pages.flatMap((page) => {
    if (activeTab === 'likes') {
      // likesテーブル経由の場合、結合された投稿データを取り出す
      return page.map((like: any) => like.posts).filter(Boolean);
    }
    return page;
  }) ?? [];

  if (userLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-72 w-full rounded-3xl" />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-1/2 rounded-xl" />
          <Skeleton className="h-10 w-1/2 rounded-xl" />
        </div>
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

      {/* タブ切り替えUI */}
      <Tabs 
        defaultValue="posts" 
        className="w-full" 
        onValueChange={(value) => setActiveTab(value as 'posts' | 'likes')}
      >
        <TabsList className="grid w-full grid-cols-2 rounded-2xl bg-muted/50 p-1">
          <TabsTrigger value="posts" className="rounded-xl font-bold transition-all">
            投稿
          </TabsTrigger>
          <TabsTrigger value="likes" className="rounded-xl font-bold transition-all">
            いいね
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="space-y-4">
        {/* 初回読み込み時のスケルトン */}
        {contentLoading && (
          <>
            <PostCardSkeleton />
            <PostCardSkeleton />
          </>
        )}

        {/* 投稿ゼロの判定 */}
        {!contentLoading && allPosts.length === 0 && (
          <div className="rounded-3xl border border-dashed border-border bg-card/60 p-12 text-center text-sm text-muted-foreground animate-in fade-in zoom-in duration-300">
            {activeTab === 'posts' ? 'まだ投稿がありません。' : 'いいねした投稿がありません。'}
          </div>
        )}

        {/* 投稿リスト */}
        {allPosts.map((p) => (
          <div key={`${activeTab}-${p.id}`} className="animate-float-up">
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
              すべての表示が完了しました
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}