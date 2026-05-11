import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { Loader2, Image as ImageIcon, X, MessageCircle } from 'lucide-react';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { PostCard } from '@/components/feed/PostCard';
import { PostCardSkeleton } from '@/components/feed/PostCardSkeleton';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LikeButton } from '@/components/post/LikeButton';
import { 
  useProfile, 
  useUserPostsInfinite, 
  useUserLikesInfinite, 
  useUserMediaInfinite 
} from '@/hooks/useProfile';

export default function Profile() {
  const { username = '' } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'posts' | 'likes' | 'media'>('posts');
  
  // メディア拡大用のステート
  const [selectedMedia, setSelectedMedia] = useState<{ url: string; post: any } | null>(null);

  const { data: user, isLoading: userLoading, isError: userError } = useProfile(username);
  
  // 各無限スクロールクエリの定義
  const postsQuery = useUserPostsInfinite(user?.id);
  const likesQuery = useUserLikesInfinite(user?.id);
  const mediaQuery = useUserMediaInfinite(user?.id);

  // タブに応じて使用するクエリを切り替え（Supabaseレベルでフィルタリングされた結果を取得）
  const currentQuery = 
    activeTab === 'likes' ? likesQuery : 
    activeTab === 'media' ? mediaQuery : 
    postsQuery;

  const { 
    data, 
    isLoading: contentLoading, 
    fetchNextPage, 
    hasNextPage, 
    isFetchingNextPage 
  } = currentQuery;

  const { ref, inView } = useInView();

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // モーダル表示時にスクロールを固定
  useEffect(() => {
    if (selectedMedia) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [selectedMedia]);

  // 数値をフォーマットする関数 (PostCardと同期)
  const formatDisplayCount = (count: number) => {
    const safeCount = Number(count) || 0;
    if (safeCount >= 10000) {
      return (safeCount / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    }
    return safeCount.toLocaleString();
  };

  // 画像URLを判定する正規表現 (PostCardと同期)
  const imageRegex = /https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s]*)?|https?:\/\/pbs\.twimg\.com\/media\/[^\s?]+(?:\?[^\s]*)?/gi;

  // データのフラット化
  const items = data?.pages.flatMap((page) => {
    if (activeTab === 'likes') {
      return page.map((like: any) => like.posts).filter(Boolean);
    }
    if (activeTab === 'media') {
      return page.flatMap((p: any) => {
        const dbImages = Array.isArray(p.imageUrls) 
          ? p.imageUrls 
          : (Array.isArray(p.image_urls) ? p.image_urls : []);
        
        const extractedImages = p.content?.match(imageRegex) || [];
        const allUrls = Array.from(new Set([...dbImages, ...extractedImages]));

        if (allUrls.length === 0) return [];

        // 投稿オブジェクトそのものを返しつつ、表示用のURLだけを個別に持たせる
        return allUrls.map(url => ({
          ...p,
          displayImageUrl: url,
          isMulti: allUrls.length > 1,
          // 確実に数値を維持
          likesCount: p.likesCount ?? p.likes_count ?? 0,
          commentsCount: p.commentsCount ?? p.comments_count ?? 0,
          likedByMe: !!(p.likedByMe ?? p.liked_by_me)
        }));
      });
    }
    return page;
  }) ?? [];

  if (userLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-72 w-full rounded-3xl" />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-1/3 rounded-xl" />
          <Skeleton className="h-10 w-1/3 rounded-xl" />
          <Skeleton className="h-10 w-1/3 rounded-xl" />
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

      <Tabs 
        defaultValue="posts" 
        className="w-full" 
        onValueChange={(value) => setActiveTab(value as 'posts' | 'likes' | 'media')}
      >
        <TabsList className="grid w-full grid-cols-3 rounded-2xl bg-muted/50 p-1">
          <TabsTrigger value="posts" className="rounded-xl font-bold transition-all">
            投稿
          </TabsTrigger>
          <TabsTrigger value="media" className="rounded-xl font-bold transition-all">
            メディア
          </TabsTrigger>
          <TabsTrigger value="likes" className="rounded-xl font-bold transition-all">
            いいね
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="space-y-4">
        {contentLoading && (
          <>
            <PostCardSkeleton />
            <PostCardSkeleton />
          </>
        )}

        {!contentLoading && !isFetchingNextPage && items.length === 0 && (
          <div className="rounded-3xl border border-dashed border-border bg-card/60 p-12 text-center text-sm text-muted-foreground animate-in fade-in zoom-in duration-300">
            {activeTab === 'posts' && 'まだ投稿がありません。'}
            {activeTab === 'likes' && 'いいねした投稿がありません。'}
            {activeTab === 'media' && 'メディア投稿がありません。'}
          </div>
        )}

        {activeTab === 'media' ? (
          <div className="grid grid-cols-3 gap-1 md:gap-2 px-0">
            {items.map((p: any, idx: number) => (
              <div 
                key={`media-${p.id}-${idx}`} 
                className="relative aspect-square overflow-hidden rounded-md md:rounded-xl bg-muted cursor-pointer animate-float-up"
                onClick={() => setSelectedMedia({ url: p.displayImageUrl, post: p })}
              >
                <img
                  src={p.displayImageUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
                {p.isMulti && (
                  <div className="absolute top-1.5 right-1.5 bg-black/40 p-1 rounded-md backdrop-blur-sm">
                    <ImageIcon className="w-3.5 h-3.5 text-white" />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          items.map((p) => (
            <div key={`${activeTab}-${p.id}`} className="animate-float-up">
              <PostCard post={p} />
            </div>
          ))
        )}

        <div ref={ref} className="py-10 flex justify-center">
          {isFetchingNextPage ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">さらに読み込み中...</span>
            </div>
          ) : hasNextPage ? (
            <div className="h-10" />
          ) : items.length > 0 ? (
            <p className="text-xs text-muted-foreground text-center">
              すべての表示が完了しました
            </p>
          ) : null}
        </div>
      </div>

      {/* メディア拡大オーバーレイ */}
      {selectedMedia && (
        <div 
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/95 backdrop-blur-sm animate-in fade-in duration-200"
          style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            width: '100vw', 
            height: '100vh',
            margin: 0,
            padding: 0
          }}
          onClick={() => setSelectedMedia(null)}
        >
          <button 
            className="absolute top-5 left-5 z-[10000] p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
            onClick={() => setSelectedMedia(null)}
          >
            <X className="h-6 w-6" />
          </button>

          <div className="relative flex h-full w-full items-center justify-center p-4">
            <img 
              src={selectedMedia.url} 
              alt="Expanded view" 
              className="max-h-[92vh] max-w-[95vw] object-contain shadow-2xl animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()} 
            />
          </div>

          <div 
            className="absolute bottom-0 left-0 right-0 flex items-center justify-center bg-gradient-to-t from-black/90 to-transparent pb-10 pt-20"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-8 rounded-full bg-black/60 px-8 py-4 backdrop-blur-md border border-white/10 shadow-xl">
              <div className="scale-125">
                <LikeButton 
                  postId={selectedMedia.post.id} 
                  liked={selectedMedia.post.likedByMe} 
                  count={Number(selectedMedia.post.likesCount)} 
                />
              </div>
              <button
                onClick={() => {
                  setSelectedMedia(null);
                  navigate(`/post/${selectedMedia.post.id}`);
                }}
                className="inline-flex items-center gap-2 text-white/90 hover:text-white transition-colors"
              >
                <MessageCircle className="h-6 w-6" />
                <span className="font-bold tabular-nums text-lg">
                  {formatDisplayCount(selectedMedia.post.commentsCount)}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}