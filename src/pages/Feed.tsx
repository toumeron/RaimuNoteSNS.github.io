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
      {/* タイムライン行のコンテナ（items-center で右側のボックスと垂直の中心を完全に同期） */}
      <div className="flex items-center justify-between px-1">
        
        {/* 左側：タイトルとボタンのコンテナ */}
        <div className="flex items-center gap-1.5">
          {/* タイトルの不要な行高（line-height）を排除し、ボタンの垂直位置が下にズレるのを完全に防ぐ */}
          <h1 className="text-2xl font-black font-display leading-none select-none">
            タイムライン
          </h1>
          
          {/* 修正：LimeNoteBetaボックスの濃いピンク（pink-600）をベースに指定。
            背景（bg-pink-600/15）：ベースの色に不透明度15%を適用して、黒背景の上でも濁らない綺麗な「薄いピンク背景」を表現。
            文字（text-pink-600）：ベースの「濃いピンク色」をそのまま適用し、圧倒的な視認性を確保。
            形状：右側のボックスの仕様（h-6, px-3, rounded-full, text-xs, font-bold）を正確にトレース。
          */}
          <a 
            href="https://toumeron.github.io/RaimuNote.github.io/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center h-6 px-3 rounded-full bg-pink-600/15 hover:bg-pink-600/45 text-pink-600 text-xs font-bold transition-colors whitespace-nowrap select-none leading-none border-none shadow-none"
          >
            ↗︎ 公式サイト
          </a>

                  <a 
            href="https://forms.gle/1FUHzrWL38iVbUju5" 
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center h-6 px-3 rounded-full bg-pink-600/15 hover:bg-pink-600/25 text-pink-600 text-xs font-bold transition-colors whitespace-nowrap select-none leading-none border-none shadow-none"
          >
            ↗︎ お問い合わせ
          </a>
        </div>

        {/* 右側：位置・形状・色の基準となるボックス */}
        <span className="ribbon-tag">
          <Sparkles className="h-3 w-3" />
          LimeNoteBeta 1.5
        </span>
      </div>

      <PostComposer />

      {/* 特別扱い：ヘッダー統合タブ */}
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