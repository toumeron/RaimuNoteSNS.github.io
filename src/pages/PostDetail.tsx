import { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MessageCircle, X } from 'lucide-react'; // RefreshCwを削除, Xを追加
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { LikeButton } from '@/components/post/LikeButton';
import { CommentList } from '@/components/post/CommentList';
import { CommentForm } from '@/components/post/CommentForm';
import { PostImages } from '@/components/feed/PostImages';
import { usePost } from '@/hooks/useFeed';
import { formatDate, formatRelative } from '@/lib/format';
import { getYouTubeId } from '@/lib/utils'; // 追加
import { YouTubeEmbed } from '@/components/YouTubeEmbed'; // 追加

export default function PostDetail() {
  const { id = '' } = useParams();
  const { data, isLoading, isError } = usePost(id);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null); // 拡大用
  const navigate = useNavigate();

  // 数値をフォーマットする関数
  const formatDisplayCount = (count: number) => {
    if (count >= 10000) {
      return (count / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    }
    return count.toLocaleString();
  };

  // モーダル表示時にスクロールを固定
  useEffect(() => {
    if (selectedImageUrl) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [selectedImageUrl]);

  // 画像クリック時の処理
  const handleImageClick = (e: React.MouseEvent, url: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedImageUrl(url);
  };

  // --- メンションをリンク化する関数 ---
  const renderContentWithMentions = (text: string) => {
    if (!text) return null;
    
    // @username 形式にマッチさせる正規表現
    const parts = text.split(/(@\w+)/g);
    
    return parts.map((part, index) => {
      if (part.startsWith('@')) {
        const username = part.substring(1);
        return (
          <Link
            key={index}
            to={`/u/${username}`}
            className="text-pink-500 hover:underline transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </Link>
        );
      }
      return part;
    });
  };
  // ------------------------------

  // YouTube IDの抽出と本文の加工
  const youtubeId = data ? getYouTubeId(data.content) : null;
  const displayContent = (data && youtubeId)
    ? data.content
        .replace(/(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/(watch\?v=|embed\/|shorts\/)?([a-zA-Z0-9_-]{11})([^?\s\n]*)?(\S+)?/g, '')
        .trim()
    : data?.content;

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm font-bold text-muted-foreground transition hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> 戻る
      </button>

      {isLoading && (
        <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft">
          <div className="flex gap-3">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </div>
        </div>
      )}
      
      {isError && (
        <div className="rounded-3xl border border-destructive/40 bg-destructive/5 p-6 text-center">
          <p className="text-sm text-destructive">投稿の読み込みに失敗しました。</p>
        </div>
      )}

      {data === null && (
        <div className="rounded-3xl border border-border/60 bg-card p-8 text-center text-muted-foreground">
          投稿が見つかりませんでした。
        </div>
      )}

      {data && (
        <article className="rounded-3xl border border-border/60 bg-card p-6 shadow-soft">
          <div className="flex items-center gap-3">
            <Link to={`/u/${data.author.username}`}>
              <Avatar className="h-12 w-12 border-2 border-primary/30">
                <AvatarImage src={data.author.avatarUrl} alt={data.author.displayName} />
                <AvatarFallback>{data.author.displayName.slice(0, 1)}</AvatarFallback>
              </Avatar>
            </Link>
            <div className="min-w-0">
              <Link to={`/u/${data.author.username}`} className="flex items-center gap-0.5 min-w-0 font-display font-bold hover:underline">
                <span className="truncate">{data.author.displayName}</span>
                {data.author.isOfficial && (
                  <img 
                    src={`${import.meta.env.BASE_URL}verified.png`}
                    alt="Official" 
                    className="h-4 w-4 shrink-0 transform translate-y-[0.5px]"
                    loading="eager"
                  />
                )}
              </Link>
              <p className="truncate text-xs text-muted-foreground">@{data.author.username}</p>
            </div>
          </div>

          {/* 加工した本文を表示（メンション処理を適用） */}
          {displayContent && (
            <p className="mt-4 whitespace-pre-wrap break-words text-base leading-relaxed text-foreground">
              {renderContentWithMentions(displayContent)}
            </p>
          )}

          {/* YouTube埋め込みを追加 */}
          {youtubeId && <YouTubeEmbed videoId={youtubeId} />}

          <div 
            className="cursor-zoom-in"
            onClick={(e) => {
              const target = e.target as HTMLElement;
              if (target.tagName === 'IMG' && (target as HTMLImageElement).src) {
                handleImageClick(e, (target as HTMLImageElement).src);
              }
            }}
          >
            <PostImages urls={data.imageUrls} />
          </div>

          <p className="mt-4 text-xs text-muted-foreground" title={formatDate(data.createdAt)}>
            {formatDate(data.createdAt)} · {formatRelative(data.createdAt)}
            {data.clientName && (
              <>
                <span className="mx-1">·</span>
                <span className="text-primary/80 font-medium">
                  {data.clientName}
                </span>
              </>
            )}
          </p>

          <div className="mt-3 flex items-center gap-1 border-t border-border/60 pt-3">
            <LikeButton 
              postId={data.id} 
              liked={data.likedByMe} 
              count={formatDisplayCount(data.likesCount) as any} 
            />
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm text-muted-foreground">
              <MessageCircle className="h-5 w-5" />
              <span className="font-bold tabular-nums">{formatDisplayCount(data.commentsCount)}</span>
            </span>
          </div>
        </article>
      )}

      {data && (
        <>
          <CommentForm postId={data.id} />
          <div>
            <h2 className="mb-3 font-display text-base font-bold text-foreground">コメント</h2>
            <CommentList postId={data.id} />
          </div>
        </>
      )}

      {/* 画像拡大オーバーレイ（モーダル） */}
      {selectedImageUrl && data && (
        <div 
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/95 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setSelectedImageUrl(null)}
        >
          {/* 閉じるボタン */}
          <button 
            className="absolute top-5 left-5 z-[110] p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
            onClick={() => setSelectedImageUrl(null)}
          >
            <X className="h-6 w-6" />
          </button>

          {/* 画像本体 */}
          <div className="relative flex max-h-full max-w-full items-center justify-center p-4">
            <img 
              src={selectedImageUrl} 
              alt="Expanded view" 
              className="max-h-[85vh] max-w-[95vw] object-contain shadow-2xl animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()} 
            />
          </div>

          {/* 下部アクションエリア */}
          <div 
            className="absolute bottom-0 left-0 right-0 flex items-center justify-center bg-gradient-to-t from-black/80 to-transparent pb-8 pt-10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-8 rounded-full bg-black/40 px-6 py-3 backdrop-blur-md border border-white/10">
              <div className="scale-125">
                <LikeButton 
                  postId={data.id} 
                  liked={data.likedByMe} 
                  count={formatDisplayCount(data.likesCount) as any} 
                />
              </div>
              <div className="inline-flex items-center gap-2 text-white/90">
                <MessageCircle className="h-6 w-6" />
                <span className="font-bold tabular-nums text-lg">{formatDisplayCount(data.commentsCount)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}