import { useState, useEffect } from 'react'; 
import { Link, useNavigate } from 'react-router-dom'; // useNavigateを追加
import { MessageCircle, MoreHorizontal, Trash2, CalendarDays, ChartBarBig, X, Globe, Lock, Sparkles } from 'lucide-react'; 
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LikeButton } from '@/components/post/LikeButton';
import { PostImages } from './PostImages';
import { formatRelative } from '@/lib/format';
import type { PostWithAuthor } from '@/types';
import { deletePost } from '@/api/posts';
import { getCurrentUserId } from '@/lib/currentUser';
import { getYouTubeId } from '@/lib/utils';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { SpotifyEmbed } from '@/components/SpotifyEmbed';
import { supabase } from '@/lib/supabase';
import dayjs from 'dayjs';

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { FollowButton } from '../profile/FollowButton'; 
import { useFollowStats } from '@/hooks/useProfile';

export function PostCard({ post }: { post: PostWithAuthor }) {
  const [showMenu, setShowMenu] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null); // 拡大用
  const [failedUrls, setFailedUrls] = useState<string[]>([]); // 読み込みに失敗したURLを管理
  const navigate = useNavigate();
  // リアルタイム更新用のステート
  const [, setTick] = useState(0);

  // 数値をフォーマットする関数
  const formatDisplayCount = (count: number) => {
    if (count >= 10000) {
      return (count / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    }
    return count.toLocaleString();
  };

  useEffect(() => {
    getCurrentUserId().then(id => setCurrentUserId(id));

    const timer = setInterval(() => {
      setTick(tick => tick + 1);
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  // モーダル表示時にスクロールを固定
  useEffect(() => {
    if (selectedImageUrl) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [selectedImageUrl]);

  const isMyPost = currentUserId === post.userId;
  const youtubeId = getYouTubeId(post.content);

  // Spotify URLを判定する正規表現
  // [a-z]{2}を[\w-]+に変更し、intl-ja などの任意の言語パスを確実に検知・除去できるように修正
  const spotifyRegex = /https:\/\/open\.spotify\.com\/(?:[\w-]+\/)?(track|album|playlist)\/[a-zA-Z0-9._?=&/%-]+/gi;
  const spotifyUrls = post.content.match(spotifyRegex) || [];

  // 画像URLを判定する正規表現（拡張子または特定のグエリパラメータ付きURLに対応）
  const imageRegex = /https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s]*)?|https?:\/\/pbs\.twimg\.com\/media\/[^\s?]+(?:\?[^\s]*)?/gi;

  // 本文から画像URLを抽出する
  const extractedImageUrls = post.content.match(imageRegex) || [];
  
  // 元々の画像配列と、本文から抽出した画像を合体させ、最大4枚に制限する
  const allImageUrls = [...(post.imageUrls || []), ...extractedImageUrls].slice(0, 4);

  // 表示用コンテンツの作成（YouTube、Spotify、画像URLを除去）
  let displayContent = post.content;
  
  // YouTube除去
  displayContent = displayContent.replace(/(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/(watch\?v=|embed\/|shorts\/)?([a-zA-Z0-9_-]{11})([^?\s\n]*)?(\S+)?/g, '');
  // 画像URL除去
  displayContent = displayContent.replace(imageRegex, '');
  // Spotify除去（修正した正規表現で intl-ja 部分もろとも削除）
  displayContent = displayContent.replace(spotifyRegex, '');
  
  displayContent = displayContent.trim();

  // --- URLをリンク化する関数 ---
  const renderContentWithLinks = (text: string) => {
    if (!text) return null;

    // URLを検知する正規表現
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    return parts.map((part, index) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={`link-${index}`}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-pink-500 hover:underline transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        );
      }
      return part;
    });
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
            key={`mention-${index}`}
            to={`/u/${username}`}
            className="text-pink-500 hover:underline transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </Link>
        );
      }
      // メンション以外のテキストに対してハッシュタグ処理を適用
      return renderContentWithHashtags(part);
    });
  };

  // --- ハッシュタグをリンク化する関数 ---
  const renderContentWithHashtags = (text: string) => {
    if (!text) return null;

    // #ハッシュタグ 形式にマッチさせる正規表現（日本語含む、文末や区切り文字を考慮）
    const parts = text.split(/(#[^\s#　.,!?:;'"()\[\]{}<>]+)/g);

    return parts.map((part, index) => {
      if (part.startsWith('#')) {
        return (
          <button
            key={`hashtag-${index}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // 検索ページに「#タグ名」で遷移。
              navigate(`/search?q=${encodeURIComponent(part)}`);
            }}
            className="text-pink-500 hover:underline transition-colors inline-block align-baseline"
          >
            {part}
          </button>
        );
      }
      // ハッシュタグ以外のテキストに対してURLリンク処理を適用
      return renderContentWithLinks(part);
    });
  };
  // ------------------------------

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('投稿を削除しますか？')) return;
    try {
      await deletePost(post.id);
      window.location.reload();
    } catch (err) {
      alert('削除に失敗しました');
    }
  };

  const handleActivityClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // いいね一覧画面への遷移
    navigate(`/post/${post.id}/activity`);
    setShowMenu(false);
  };

  const handleToggleVisibility = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const newVisibility = post.visibility === 'public' ? 'following' : 'public';
    const confirmMsg = newVisibility === 'public' 
      ? 'この投稿を全体公開に切り替えますか？' 
      : 'この投稿を限定公開に切り替えますか？フォロー中のユーザーのみ表示されます。';
    
    if (!confirm(confirmMsg)) return;

    try {
      const { error } = await supabase
        .from('posts')
        .update({ visibility: newVisibility })
        .eq('id', post.id);

      if (error) throw error;
      window.location.reload();
    } catch (err) {
      console.error(err);
      alert('公開設定の変更に失敗しました');
    }
  };

  // 画像クリック時の処理
  const handleImageClick = (e: React.MouseEvent, url: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedImageUrl(url);
  };

  // カード全体のクリックハンドラ
  const handleCardClick = () => {
    navigate(`/post/${post.id}`);
  };

  const HoverStats = ({ userId }: { userId: string }) => {
    const { data: stats } = useFollowStats(userId);
    return (
      <div className="mt-3 flex items-center gap-4 text-[14px]">
        <div className="flex items-center gap-1">
          <span className="font-bold text-foreground">{stats ? formatDisplayCount(stats.following) : 0}</span>
          <span className="text-muted-foreground">フォロー中</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="font-bold text-foreground">{stats ? formatDisplayCount(stats.followers) : 0}</span>
          <span className="text-muted-foreground">フォロワー</span>
        </div>
      </div>
    );
  };

  const ProfileHoverContent = () => (
    <HoverCardContent 
      side="bottom" 
      align="start" 
      className="w-[280px] rounded-[20px] border border-border/60 bg-card p-4 shadow-xl animate-in fade-in zoom-in duration-200 overflow-hidden"
    >
      <div className="flex justify-between items-start mb-3">
        <Avatar className="h-14 w-14 border border-primary/5">
          <AvatarImage src={post.author.avatarUrl} alt={post.author.displayName} />
          <AvatarFallback>{post.author.displayName.slice(0, 1)}</AvatarFallback>
        </Avatar>
        
        {currentUserId !== post.author.id && (
          <div className="shrink-0 w-[85px] h-[36px]" onClick={(e) => e.stopPropagation()}>
            <div className="w-full h-full [&>*]:!w-full [&>*]:!h-full [&>*]:!min-w-0 [&>*]:!p-0 [&>*]:!flex [&>*]:!items-center [&>*]:!justify-center [&>*]:!bg-foreground [&>*]:!text-background [&>*]:!rounded-full [&>*]:!text-[14px] [&>*]:!font-bold [&>*]:!border-none [&_svg]:!hidden">
              <FollowButton userId={post.author.id} />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-0.5">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-base font-black text-foreground truncate leading-tight shrink">
            {post.author.displayName}
          </span>
          {post.author.isOfficial && (
            <img 
              src={`${import.meta.env.BASE_URL}verified.png`} 
              alt="Official" 
              className="h-[1.1em] w-[1.1em] shrink-0 transform translate-y-[1px]"
            />
          )}
        </div>
        <p className="text-[15px] text-muted-foreground leading-none">@{post.author.username}</p>
      </div>

      {post.author.bio && (
        <p className="mt-3 text-[15px] leading-normal text-foreground whitespace-pre-wrap line-clamp-3">
          {post.author.bio}
        </p>
      )}

      <div className="mt-3 flex items-center gap-1.5 text-[14px] text-muted-foreground">
        <CalendarDays className="h-4 w-4" />
        <span>{dayjs(post.author.createdAt).format('YYYY年M月')} から参加</span>
      </div>

      <HoverStats userId={post.author.id} />
    </HoverCardContent>
  );

  return (
    <>
      <article 
        onClick={handleCardClick}
        className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft transition hover:shadow-card-soft relative cursor-pointer"
      >
        <div className="flex items-start gap-3">
          <HoverCard openDelay={300}>
            <HoverCardTrigger asChild>
              <Link 
                to={`/u/${post.author.username}`} 
                className="shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <Avatar className="h-11 w-11 border-2 border-primary/30">
                  <AvatarImage src={post.author.avatarUrl} alt={post.author.displayName} />
                  <AvatarFallback>{post.author.displayName.slice(0, 1)}</AvatarFallback>
                </Avatar>
              </Link>
            </HoverCardTrigger>
            <ProfileHoverContent />
          </HoverCard>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center overflow-hidden w-full min-w-0">
                <HoverCard openDelay={300}>
                  <HoverCardTrigger asChild>
                    <Link 
                      to={`/u/${post.author.username}`} 
                      className="flex items-center min-w-0 shrink font-display font-bold text-foreground hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-0.5 min-w-0">
                        <span className="truncate text-base">{post.author.displayName}</span>
                        {post.author.isOfficial && (
                          <img 
                            src={`${import.meta.env.BASE_URL}verified.png`}
                            alt="Official" 
                            className="h-4 w-4 shrink-0 transform translate-y-[0.5px]"
                            loading="eager"
                          />
                        )}
                      </div>
                    </Link>
                  </HoverCardTrigger>
                  <ProfileHoverContent />
                </HoverCard>
                
                <span className="truncate text-base text-muted-foreground ml-1 opacity-80 shrink">
                  @{post.author.username}
                </span>
                
                <span className="text-muted-foreground mx-1 shrink-0">·</span>
                <span className="text-sm text-muted-foreground whitespace-nowrap shrink-0">
                  {formatRelative(post.createdAt)}
                </span>
              </div>
              
              <div className="flex items-center shrink-0 ml-2">
                {/* 限定公開ラベル（三点印の左） */}
                {post.visibility === 'following' && (
                  <span className="text-[14px] font-bold text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-md whitespace-nowrap mr-1">
                    限定公開
                  </span>
                )}
                <div className="relative shrink-0">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowMenu(!showMenu);
                    }}
                    className="p-1 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    < MoreHorizontal className="h-5 w-5" />
                  </button>
                  {showMenu && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setShowMenu(false); }} />
                      <div 
                        className="absolute right-0 mt-1 w-44 rounded-xl border border-border bg-card p-1 shadow-lg z-20 overflow-hidden animate-in fade-in zoom-in duration-100"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={handleActivityClick}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted transition-colors"
                        >
                          <ChartBarBig className="h-4 w-4" />
                          ポストアクティビティー
                        </button>

                        {isMyPost && (
                          <button
                            onClick={handleToggleVisibility}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted transition-colors"
                          >
                            {post.visibility === 'public' ? (
                              <>
                                <Lock className="h-4 w-4" />
                                限定公開にする
                              </>
                            ) : (
                              <>
                                <Globe className="h-4 w-4" />
                                全体公開にする
                              </>
                            )}
                          </button>
                        )}
                        
                        {isMyPost && (
                          <button
                            onClick={handleDelete}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-destructive hover:bg-destructive/10 transition-colors border-t border-border/50 mt-1"
                          >
                            <Trash2 className="h-4 w-4" />
                            削除
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-1">
              <div onClick={(e) => { e.stopPropagation(); navigate(`/post/${post.id}`); }}>
                {displayContent && (
                  <p className="whitespace-pre-wrap break-words text-base leading-relaxed text-foreground">
                    {renderContentWithMentions(displayContent)}
                  </p>
                )}
                {/* 画像読み込みに失敗したURLをテキストリンクとして表示 */}
                {failedUrls.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {failedUrls.map((url, idx) => (
                      <div key={`failed-${idx}`}>
                        {renderContentWithLinks(url)}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* AIラベル（文章の下に配置）: isBot または is_bot 両方の可能性に対応 */}
              {((post as any).is_bot || post.isBot) && (
                <div className="flex items-center gap-1 mt-1.5 text-muted-foreground/70">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span className="text-[15px] font-medium">AIで生成</span>
                </div>
              )}

              {youtubeId && (
                <div onClick={(e) => e.stopPropagation()}>
                  <YouTubeEmbed videoId={youtubeId} />
                </div>
              )}
              {/* Spotify URLがあれば埋め込みを表示 */}
              {spotifyUrls.length > 0 && (
                <div onClick={(e) => e.stopPropagation()} className="space-y-2">
                  {spotifyUrls.map((url, idx) => (
                    <SpotifyEmbed key={`spotify-${idx}`} url={url} />
                  ))}
                </div>
              )}
              <div 
                className="cursor-zoom-in"
                onClick={(e) => {
                  const target = e.target as HTMLElement;
                  if (target.tagName === 'IMG' && (target as HTMLImageElement).src) {
                    handleImageClick(e, (target as HTMLImageElement).src);
                  } else {
                    handleCardClick();
                  }
                }}
              >
                <PostImages 
                  urls={allImageUrls} 
                  onImageError={(url) => {
                    if (!failedUrls.includes(url)) {
                      setFailedUrls(prev => [...prev, url]);
                    }
                  }}
                />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-1 text-muted-foreground">
              <div onClick={(e) => e.stopPropagation()}>
                <LikeButton 
                  postId={post.id} 
                  liked={post.likedByMe} 
                  count={post.likesCount} 
                />
              </div>
              <Link
                to={`/post/${post.id}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors hover:text-accent"
              >
                <MessageCircle className="h-5 w-5" />
                <span className="font-bold tabular-nums text-sm">{formatDisplayCount(post.commentsCount)}</span>
              </Link>
            </div>
          </div>
        </div>
      </article>

      {/* 画像拡大オーバーレイ（モーダル） */}
      {selectedImageUrl && (
        <div 
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/95 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setSelectedImageUrl(null)}
        >
          <button 
            className="absolute top-5 left-5 z-[110] p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
            onClick={() => setSelectedImageUrl(null)}
          >
            <X className="h-6 w-6" />
          </button>

          <div className="relative flex max-h-full max-w-full items-center justify-center p-4">
            <img 
              src={selectedImageUrl} 
              alt="Expanded view" 
              className="max-h-[85vh] max-w-[95vw] object-contain shadow-2xl animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()} 
            />
          </div>

          <div 
            className="absolute bottom-0 left-0 right-0 flex items-center justify-center bg-gradient-to-t from-black/80 to-transparent pb-8 pt-10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-8 rounded-full bg-black/40 px-6 py-3 backdrop-blur-md border border-white/10">
              <div className="scale-125">
                <LikeButton 
                  postId={post.id} 
                  liked={post.likedByMe} 
                  count={post.likesCount} 
                />
              </div>
              <button
                onClick={() => {
                  setSelectedImageUrl(null);
                  navigate(`/post/${post.id}`);
                }}
                className="inline-flex items-center gap-2 text-white/90 hover:text-white transition-colors"
              >
                <MessageCircle className="h-6 w-6" />
                <span className="font-bold tabular-nums text-lg">{formatDisplayCount(post.commentsCount)}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}