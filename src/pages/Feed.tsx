import { Heart, RefreshCw, Sparkles, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { PostComposer } from '@/components/feed/PostComposer';
import { PostCard } from '@/components/feed/PostCard';
import { PostCardSkeleton } from '@/components/feed/PostCardSkeleton';
import { useFeed } from '@/hooks/useFeed';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function Feed() {
  const [activeTab, setActiveTab] = useState<'all' | 'following'>('all');
  const [isScrolled, setIsScrolled] = useState(false);

  const { 
    data, 
    isLoading, 
    isError, 
    fetchNextPage, 
    hasNextPage, 
    isFetchingNextPage 
  } = useFeed(activeTab);

  const { ref, inView } = useInView();

  useEffect(() => {
    const handleScroll = () => {
      // 10px以上スクロールで状態を切り替え
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const allPosts = data?.pages.flatMap((page) => page) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between px-1">
        <h1 className="inline-flex items-center gap-2 font-display text-2xl font-black">
          タイムライン
        </h1>
        <span className="ribbon-tag">
          <Sparkles className="h-3 w-3" />
          LimeNoteBeta 1.3.1
        </span>
      </div>

      <PostComposer />

      {/* 特別扱い：ヘッダー統合タブ 
         - sticky top-0 に設定してヘッダー(64px)と完全に重なる位置に配置。
         - z-[60] を指定して、Header(z-50) よりも物理的に上に表示。
         - スクロール前は通常の配置、スクロール後はヘッダーの「ロゴの横」や「中央」に重なる。
      */}
      <div className={`sticky top-0 transition-all duration-300 py-3 -mx-5 px-5 border-none pointer-events-none ${
        isScrolled 
          ? 'z-[60] h-16 flex items-center justify-center' 
          : 'z-40 bg-transparent h-auto'
      }`}>
        <div className="max-w-md mx-auto w-full pointer-events-auto">
          <Tabs 
            defaultValue="all" 
            className="w-full border-none shadow-none" 
            onValueChange={(v) => setActiveTab(v as 'all' | 'following')}
          >
            {/* 影・線を徹底排除。bg-muted/80 でヘッダー越しでもハッキリ見えるように調整 */}
            <TabsList className="grid w-full grid-cols-2 h-11 items-center justify-center rounded-full bg-muted/80 p-1 border-none shadow-none ring-0 backdrop-blur-sm">
              <TabsTrigger 
                value="all" 
                className="h-9 rounded-full px-6 font-bold transition-all duration-200 
                           data-[state=active]:bg-foreground data-[state=active]:text-background 
                           data-[state=inactive]:text-foreground/70 data-[state=inactive]:hover:bg-background/40
                           shadow-none border-none outline-none focus-visible:ring-0"
              >
                最新
              </TabsTrigger>
              <TabsTrigger 
                value="following" 
                className="h-9 rounded-full px-6 font-bold transition-all duration-200 
                           data-[state=active]:bg-foreground data-[state=active]:text-background 
                           data-[state=inactive]:text-foreground/70 data-[state=inactive]:hover:bg-background/40
                           shadow-none border-none outline-none focus-visible:ring-0"
              >
                フォロー中
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="space-y-4 pt-2">
        {isLoading && (
          <div className="space-y-4">
            <PostCardSkeleton />
            <PostCardSkeleton />
          </div>
        )}

        {isError && (
          <div className="rounded-3xl border border-destructive/20 bg-destructive/5 p-6 text-center">
            <p className="text-sm text-destructive font-bold">読み込みに失敗しました。</p>
          </div>
        )}

        {!isLoading && allPosts.length === 0 && (
          <div className="rounded-3xl border border-dashed border-border/50 bg-card/40 p-10 text-center text-muted-foreground">
            {activeTab === 'all' ? 'まだ投稿がありません' : 'フォロー中の投稿はありません'}
          </div>
        )}

        {allPosts.map((post) => (
          <div key={`${activeTab}-${post.id}`} className="animate-float-up">
            <PostCard post={post} />
          </div>
        ))}

        <div ref={ref} className="py-10 flex justify-center">
          {isFetchingNextPage ? (
            <div className="flex items-center gap-2 text-muted-foreground animate-pulse">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm font-medium">読み込み中...</span>
            </div>
          ) : hasNextPage ? (
            <div className="h-10" />
          ) : allPosts.length > 0 ? (
            <p className="text-xs text-muted-foreground/60">すべての投稿を読み込みました</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}