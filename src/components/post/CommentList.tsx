import { openMediaViewer } from '@/components/media/openMediaViewer';
import {LinkPreviewCard,useLinkPreview} from '@/components/post/LinkPreviewCard';
import {OfflineBookmarkContext} from '@/components/stickers/OfflineBookmarkContext';
import { renderStickerText } from '@/components/stickers/renderStickerText';
import { hasStickers } from '@/lib/stickers';
import { useState, useContext, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { MoreHorizontal, ChartBarBig, Trash2, CalendarDays, X, Plus, MessageCircle } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PostCardSkeleton } from '@/components/feed/PostCardSkeleton';
import { ReplyShare } from '@/components/post/ReplyShare';
import { RepostButton } from '@/components/feed/RepostButton';
import { RepostIcon } from '@/components/feed/RepostIcon';
import { replyToPost } from '@/api/reply-reposts';
import { Commentlikebutton } from '@/components/post/Commentlikebutton';
import { FollowButton } from '@/components/profile/FollowButton';
import { useFollowStats } from '@/hooks/useProfile';
import { useComments } from '@/hooks/useComments';
import { getCurrentUserId } from '@/lib/currentUser';
import { formatDate, formatRelative } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { getYouTubeId } from '@/lib/utils';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { SpotifyEmbed } from '@/components/SpotifyEmbed';
import { PostImages } from '@/components/feed/PostImages';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import dayjs from 'dayjs';
import { commentThreadUrl, getAuthorReplyConversations } from '@/lib/commentThread';
import { ReplyChain } from '@/components/post/ReplyChain';

// ─── 型 ───────────────────────────────────────────────────────────────────────
interface CommentAuthor {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  isOfficial?: boolean;
  bio?: string;
  createdAt: string;
}

interface Comment {
  clientName?: string;
  id: string;
  postId: string;
  userId: string;
  content: string;
  createdAt: string;
  likesCount: number;
  likedByMe: boolean;
  imageUrls?: string[];
  parentCommentId?: string | null;
  commentsCount?: number;
  author: CommentAuthor;
}

interface CustomEmoji {
  id: string;
  name: string;
  public_id: string;
  format: string;
  uploaded_by: string;
}

interface ReactionUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

interface ReactionGroup {
  emoji: string;
  count: number;
  user_ids: string[];
  users: ReactionUser[];
}

interface ReplicatedRing {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ReplicatedDot {
  id: string;
  x: number;
  y: number;
  angle: number;
  distance: number;
  color: string;
  size: number;
  delay: number;
}

// ─── ユーティリティ ─────────────────────────────────────
const formatDisplayCount = (count: number) => {
  const safeCount = Number(count) || 0;
  if (safeCount >= 10000) {
    return (safeCount / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  }
  return safeCount.toLocaleString();
};

const imageRegex = /https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s]*)?|https?:\/\/pbs\.twimg\.com\/media\/[^\s?]+(?:\?[^\s]*)?/gi;

const spotifyRegex = /https:\/\/open\.spotify\.com\/(?:[\w-]+\/)?(track|album|playlist)\/[a-zA-Z0-9._?=&/%-]+/gi;

const getChannelSuffix = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2);
};

// ─── CommentCard ──────────────────────────────────────────────────────────────
export function CommentCard({
  comment,
  currentUserId,
  mobileFlat,
  thread = false,
  detail = false,
  embedded = false,
  repostedByLabel,
  replyToUsername,
  flat = false,
  mediaPresentation,
  onMediaReply,
  onMediaLikeChange,
  mediaDownload,
}: {
  comment: Comment;
  currentUserId: string | null;
  mobileFlat: boolean;
  thread?: boolean;
  detail?: boolean;
  embedded?: boolean;
  repostedByLabel?: string;
  replyToUsername?: string;
  flat?: boolean;
  mediaPresentation?: 'actions' | 'menu';
  onMediaReply?:()=>void;
  onMediaLikeChange?:(state:{liked:boolean;count:number})=>void;
  mediaDownload?:()=>void;
}) {
  const navigate = useNavigate();

  const [showMenu, setShowMenu] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [imageSize, setImageSize] = useState<{ url: string; width: number; height: number } | null>(null);
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const [, setTick] = useState(0);

  // カスタム絵文字・リアクション用
  const [showPicker, setShowPicker] = useState(false);
  const offlineBookmark=useContext(OfflineBookmarkContext);
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([]);
  const [reactions, setReactions] = useState<ReactionGroup[]>([]);
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isEmojisOpen, setIsEmojisOpen] = useState(true);
  const [activePopupEmoji, setActivePopupEmoji] = useState<string | null>(null);

  // エフェクト用
  const [activeRings, setActiveRings] = useState<ReplicatedRing[]>([]);
  const [activeDots, setActiveDots] = useState<ReplicatedDot[]>([]);

  // スマホ判定
  const [isMobile, setIsMobile] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMyComment = currentUserId === comment.userId;

  const defaultEmojis = ['👍', '❤️', '😆', '🤔', '😮', '🎉', '💢', '😢', '😇', '🍮'];

  useEffect(() => {
    if (currentUserId) {
      const saved = localStorage.getItem(`recent_emojis_${currentUserId}`);
      if (saved) {
        try {
          setRecentEmojis(JSON.parse(saved));
        } catch (e) {
          console.error(e);
        }
      }
    }
  }, [currentUserId]);

  useEffect(() => {
    fetchReactions();
    fetchCustomEmojis();

    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    const channel = supabase
      .channel(`comment-reactions-${comment.id}-${getChannelSuffix()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'comment_reactions',
          filter: `comment_id=eq.${comment.id}`,
        },
        () => {
          fetchReactions();
        }
      )
      .subscribe();

    const timer = setInterval(() => {
      setTick((tick) => tick + 1);
    }, 60000);

    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', checkMobile);
      supabase.removeChannel(channel);
    };
  }, [comment.id]);

  useEffect(() => {
    if (!showPicker) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [showPicker]);

  const fetchReactions = async () => {
    try {
      const { data: reactionData, error: reactionError } = await supabase
        .from('comment_reactions')
        .select('emoji, user_id')
        .eq('comment_id', comment.id);

      if (reactionError) throw reactionError;

      if (reactionData && reactionData.length > 0) {
        const userIds = Array.from(new Set(reactionData.map((r: any) => r.user_id)));

        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('id, username, display_name, avatar_url')
          .in('id', userIds);

        if (profileError) throw profileError;

        const profileMap: { [key: string]: any } = {};

        if (profileData) {
          profileData.forEach((p: any) => {
            profileMap[p.id] = p;
          });
        }

        const groups: { [key: string]: { userIds: string[]; users: ReactionUser[] } } = {};

        reactionData.forEach((row: any) => {
          if (!groups[row.emoji]) {
            groups[row.emoji] = { userIds: [], users: [] };
          }

          groups[row.emoji].userIds.push(row.user_id);

          const profile = profileMap[row.user_id];

          if (profile) {
            groups[row.emoji].users.push({
              id: profile.id,
              username: profile.username || 'unknown',
              displayName: profile.display_name || profile.username || 'ユーザー',
              avatarUrl: profile.avatar_url || '',
            });
          }
        });

        const formattedGroups: ReactionGroup[] = Object.keys(groups).map((emoji) => ({
          emoji,
          count: groups[emoji].userIds.length,
          user_ids: groups[emoji].userIds,
          users: groups[emoji].users,
        }));

        setReactions(formattedGroups);
      } else {
        setReactions([]);
      }
    } catch (err) {
      console.error('Fetch Comment Reactions Error:', err);
    }
  };

  const fetchCustomEmojis = async () => {
    if(offlineBookmark){setCustomEmojis(offlineBookmark.emojis.map(emoji=>({...emoji,uploaded_by:''})));return;}
    try {
      const { data, error } = await supabase
        .from('custom_emojis')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (data) {
        setCustomEmojis(data);
      }
    } catch (err) {
      console.error('Fetch Emojis Error:', err);
    }
  };

  const triggerImageReplicatedEffect = (targetElement: HTMLElement) => {
    const rect = targetElement.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    targetElement.classList.remove('misskey-elastic-active');
    void targetElement.offsetWidth;
    targetElement.classList.add('misskey-elastic-active');

    const batchId = Math.random().toString(36).substring(2, 9);

    const newRing: ReplicatedRing = {
      id: `ring-${batchId}`,
      x: centerX,
      y: centerY,
      width: rect.width + 4,
      height: rect.height + 4,
    };

    const colors = ['#d4f022', '#e6007e', '#22f0d8', '#d4f022', '#e6007e'];
    const dotCount = 16;
    const newDots: ReplicatedDot[] = [];

    for (let i = 0; i < dotCount; i++) {
      const angle = (i / dotCount) * 360 + (Math.random() * 20 - 10);
      const maxDistance = rect.width / 2 + (Math.random() * 16 - 4);

      newDots.push({
        id: `dot-${batchId}-${i}`,
        x: centerX,
        y: centerY,
        angle,
        distance: maxDistance,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() * 5 + 5,
        delay: Math.random() * 40,
      });
    }

    setActiveRings((prev) => [...prev, newRing]);
    setActiveDots((prev) => [...prev, ...newDots]);

    setTimeout(() => {
      setActiveRings((prev) => prev.filter((r) => r.id !== `ring-${batchId}`));
      setActiveDots((prev) => prev.filter((d) => !d.id.startsWith(`dot-${batchId}-`)));
    }, 550);
  };

  const handleAddReaction = async (emoji: string, event?: React.MouseEvent) => {
    if (!currentUserId) return;

    if (event && event.currentTarget) {
      triggerImageReplicatedEffect(event.currentTarget as HTMLElement);
    }

    const updatedRecents = [emoji, ...recentEmojis.filter((e) => e !== emoji)].slice(0, 10);
    setRecentEmojis(updatedRecents);
    localStorage.setItem(`recent_emojis_${currentUserId}`, JSON.stringify(updatedRecents));

    try {
      const { data: existing, error: checkError } = await supabase
        .from('comment_reactions')
        .select('id')
        .eq('comment_id', comment.id)
        .eq('user_id', currentUserId)
        .eq('emoji', emoji)
        .maybeSingle();

      if (checkError) throw checkError;

      if (existing) {
        const { error } = await supabase
          .from('comment_reactions')
          .delete()
          .eq('id', existing.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('comment_reactions')
          .insert({
            comment_id: comment.id,
            user_id: currentUserId,
            emoji,
          });

        if (error) throw error;
      }

      fetchReactions();
      setShowPicker(false);
    } catch (err) {
      console.error('Toggle Comment Reaction Error:', err);
    }
  };

  const normalizeEmojiName = (name: string) => {
    return String(name || '')
      .trim()
      .replace(/^:+/, '')
      .replace(/:+$/, '');
  };

  const toEmojiToken = (name: string) => {
    const cleanName = normalizeEmojiName(name);
    return `::${cleanName}::`;
  };

  const getCustomEmojiObj = (emojiStr: string) => {
    const cleanName = normalizeEmojiName(emojiStr);

    if (!cleanName) {
      return null;
    }

    return customEmojis.find((emoji) => {
      const storedName = normalizeEmojiName(emoji.name);
      return storedName === cleanName;
    }) ?? null;
  };

  const renderEmojiElement = (emojiStr: string, className = 'h-5 w-5 object-contain inline-block') => {
    const customEmoji = getCustomEmojiObj(emojiStr);

    if (customEmoji) {
      const cleanPublicId = customEmoji.public_id.startsWith('custom_emojis/')
        ? customEmoji.public_id
        : `custom_emojis/${customEmoji.public_id}`;

      const imageUrl = `https://res.cloudinary.com/dveiikhhw/image/upload/${cleanPublicId}.${customEmoji.format}`;

      return (
        <img
          src={imageUrl}
          alt={customEmoji.name}
          className={className}
          loading="lazy"
          onError={() => {
            console.error('Failed to load custom emoji image:', {
              emojiStr,
              customEmoji,
              imageUrl,
            });
          }}
        />
      );
    }

    return <span className="text-lg leading-none select-none">{emojiStr}</span>;
  };

  const handleTouchStart = (emoji: string) => {
    longPressTimerRef.current = setTimeout(() => {
      setActivePopupEmoji(emoji);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
  };

  const filteredCustomEmojis = customEmojis.filter((emoji) => {
    const name = normalizeEmojiName(emoji.name).toLowerCase();
    return name.includes(searchQuery.toLowerCase());
  });

  const youtubeId = getYouTubeId(comment.content);
  const linkPreview=useLinkPreview(comment.content);

  const spotifyUrls = comment.content.match(spotifyRegex) || [];
  const extractedImageUrls = comment.content.match(imageRegex) || [];
  const allImageUrls = [...new Set([...(comment.imageUrls ?? []), ...extractedImageUrls])].slice(0, 4);

  let displayContent = comment.content;
  displayContent = displayContent.replace(/(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/(watch\?v=|embed\/|shorts\/)?([a-zA-Z0-9_-]{11})([^?\s\n]*)?(\S+)?/g, '');
  displayContent = displayContent.replace(imageRegex, '');
  displayContent = displayContent.replace(spotifyRegex, '');
  displayContent = linkPreview.text(displayContent.trim());

  const useMobilePresentation = mobileFlat || isMobile;
  const naturalSize = imageSize?.url === allImageUrls[0] ? imageSize : null;
  const singleImageFrameStyle = useMemo<React.CSSProperties>(() => {
    if (!naturalSize) {
      return {
        width: '100%',
        maxWidth: '100%',
      };
    }

    const naturalWidth = Math.max(1, naturalSize.width);
    const naturalHeight = Math.max(1, naturalSize.height);
    const ratio = naturalWidth / naturalHeight;

    const maxTimelineImageHeight = useMobilePresentation ? 300 : 480;
    const minimumReadableWidth = useMobilePresentation ? 88 : 110;
    const heightLimitedWidth = Math.max(
      minimumReadableWidth,
      Math.round(maxTimelineImageHeight * ratio)
    );
    const shouldLimitByHeight = ratio < (useMobilePresentation ? 1.64 : 1.72);
    const shouldAvoidUpscale = naturalWidth <= (useMobilePresentation ? 360 : 520);
    const shouldNarrowUltraWide = ratio >= 2.35;

    if (shouldLimitByHeight) {
      const width = shouldAvoidUpscale
        ? Math.min(naturalWidth, heightLimitedWidth)
        : heightLimitedWidth;

      return {
        width: `min(100%, ${Math.max(minimumReadableWidth, width)}px)`,
        maxWidth: '100%',
      };
    }

    if (shouldAvoidUpscale) {
      return {
        width: `${naturalWidth}px`,
        maxWidth: '100%',
      };
    }

    if (shouldNarrowUltraWide) {
      return {
        width: useMobilePresentation ? '100%' : 'min(100%, 560px)',
        maxWidth: '100%',
      };
    }

    return {
      width: '100%',
      maxWidth: '100%',
    };
  }, [naturalSize, useMobilePresentation]);

  const renderContentWithLinks = (text: string) => {
    if (!text) return null;

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

  const renderContentWithHashtags = (text: string) => {
    if (!text) return null;

    const parts = text.split(/(#[^\s#　.,!?:;'"()\[\]{}<>]+)/g);

    return parts.map((part, index) => {
      if (part.startsWith('#')) {
        return (
          <button
            key={`hashtag-${index}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              navigate(`/search?q=${encodeURIComponent(part)}`);
            }}
            className="text-pink-500 hover:underline transition-colors inline-block align-baseline"
          >
            {part}
          </button>
        );
      }

      return renderContentWithLinks(part);
    });
  };

  const renderContentWithMentions = (text: string): React.ReactNode => {
    if (hasStickers(text)) return renderStickerText(text, renderContentWithMentions);
    if (!text) return null;

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

      return renderContentWithHashtags(part);
    });
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!confirm('コメントを削除しますか？')) return;

    try {
      const { error } = await supabase.from('comments').delete().eq('id', comment.id);
      if (error) throw error;
      setDeleted(true);
    } catch {
      alert('削除に失敗しました');
    }
  };

  const handleImageClick = (e: React.MouseEvent, url: string) => {
    e.preventDefault();
    e.stopPropagation();
    openMediaViewer({ url, post: replyToPost(comment), offline: offlineBookmark, media: (comment.imageUrls ?? [url]).map(src => ({ src })) });
  };

  const handleCardClick = () => {
    navigate(commentThreadUrl(comment.postId, comment.id));
  };

  const HoverStats = ({ userId }: { userId: string }) => {
    const { data: stats } = useFollowStats(userId);



  return (
      <div className="mt-3 flex items-center gap-4 text-[14px]">
        <div className="flex items-center gap-1">
          <span className="font-bold text-foreground">
            {stats ? formatDisplayCount(stats.following) : 0}
          </span>
          <span className="text-muted-foreground">フォロー中</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="font-bold text-foreground">
            {stats ? formatDisplayCount(stats.followers) : 0}
          </span>
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
        <Avatar userId={comment.author.id} className="h-14 w-14 border border-primary/5">
          <AvatarImage src={comment.author.avatarUrl} alt={comment.author.displayName} />
          <AvatarFallback>{comment.author.displayName.slice(0, 1)}</AvatarFallback>
        </Avatar>

        {currentUserId !== comment.author.id && (
          <div className="shrink-0 w-[85px] h-[36px]" onClick={(e) => e.stopPropagation()}>
            <div className="w-full h-full [&>*]:!w-full [&>*]:!h-full [&>*]:!min-w-0 [&>*]:!p-0 [&>*]:!flex [&>*]:!items-center [&>*]:!justify-center [&>*]:!bg-foreground [&>*]:!text-background [&>*]:!rounded-full [&>*]:!text-[14px] [&>*]:!font-bold [&>*]:!border-none [&_svg]:!hidden">
              <FollowButton userId={comment.author.id} />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-0.5">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-base font-black text-foreground truncate leading-tight shrink">
            {comment.author.displayName}
          </span>

          {comment.author.isOfficial && (
            <img
              src={`${import.meta.env.BASE_URL}verified.png`}
              alt="Official"
              className="h-[1.1em] w-[1.1em] shrink-0 transform translate-y-[1px]"
            />
          )}
        </div>

        <p className="text-[15px] text-muted-foreground leading-none">
          @{comment.author.username}
        </p>
      </div>

      {comment.author.bio && (
        <p className="mt-3 text-[15px] leading-normal text-foreground whitespace-pre-wrap line-clamp-3">
          {comment.author.bio}
        </p>
      )}

      <div className="mt-3 flex items-center gap-1.5 text-[14px] text-muted-foreground">
        <CalendarDays className="h-4 w-4" />
        <span>{dayjs(comment.author.createdAt).format('YYYY年M月')} から参加</span>
      </div>

      <HoverStats userId={comment.author.id} />
    </HoverCardContent>
  );

  if (deleted) return null;

  const replyMenu = (                <div className="relative ml-2 shrink-0">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowMenu(!showMenu);
                    }}
                    className="p-1 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    aria-label="コメントのメニュー"
                  >
                    <MoreHorizontal className="h-5 w-5" />
                  </button>

                  {showMenu && (
                    <>
                      <div
                        data-lime-media-sheet-backdrop={mediaPresentation || undefined}
                        className="fixed inset-0 z-10"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowMenu(false);
                        }}
                      />

                      <div
                        data-lime-media-sheet={mediaPresentation ? 'menu' : undefined}
                        className="absolute right-0 mt-1 w-44 rounded-xl border border-border bg-card p-1 shadow-lg z-20 overflow-hidden animate-in fade-in zoom-in duration-100"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {mediaPresentation && <button onClick={() => navigate(commentThreadUrl(comment.postId, comment.id))} className="flex w-full items-center rounded-lg px-3 py-2 text-sm font-bold hover:bg-muted">ポストに移動</button>}
                        {mediaDownload && <button onClick={() => {setShowMenu(false);mediaDownload();}} className="flex w-full items-center rounded-lg px-3 py-2 text-sm font-bold hover:bg-muted">画像を保存</button>}
                        <button onClick={(event) => { event.stopPropagation(); navigate(`/post/${comment.postId}/activity?reply=${encodeURIComponent(comment.id)}`); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted transition-colors"><ChartBarBig className="h-4 w-4" />ポストアクティビティ</button>
                        {isMyComment && (
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
                </div>);
  const replyReactions = (<>            {!embedded && reactions.length > 0 && (
              <div className={`${detail ? "col-span-2 " : ""}mt-3 flex flex-wrap gap-1.5 relative`} onClick={(e) => e.stopPropagation()}>
                {reactions.map((g) => {
                  const hasMyReaction = currentUserId ? g.user_ids.includes(currentUserId) : false;
                  const isPopupOpen = activePopupEmoji === g.emoji;

                  return (
                    <div
                      key={g.emoji}
                      className="relative inline-block"
                      onMouseEnter={() => setActivePopupEmoji(g.emoji)}
                      onMouseLeave={() => setActivePopupEmoji(null)}
                    >
                      <button
                        onClick={(e) => handleAddReaction(g.emoji, e)}
                        onTouchStart={() => handleTouchStart(g.emoji)}
                        onTouchEnd={handleTouchEnd}
                        className={`inline-flex items-center gap-1.5 h-[45px] px-2.5 rounded-xl text-[15px] font-bold transition-all select-none outline-none border-none origin-center ${
                          hasMyReaction
                            ? 'bg-sky-500/15 dark:bg-sky-500/15 text-sky-500 dark:text-sky-400'
                            : 'bg-black/[0.05] dark:bg-muted/50 text-muted-foreground hover:bg-black/[0.08] dark:hover:bg-muted/80 hover:text-foreground'
                        }`}
                      >
                        {renderEmojiElement(g.emoji, 'h-5 w-5 object-contain')}
                        <span className="tabular-nums text-sm font-black">{g.count}</span>
                      </button>

                      {isPopupOpen && g.users.length > 0 && (
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-[260px] bg-white dark:bg-[#252932] border border-black/[0.08] dark:border-white/5 rounded-2xl shadow-2xl z-[60] flex p-3 pointer-events-none">
                          <div className="w-[64px] h-[64px] shrink-0 flex items-center justify-center border-r border-black/[0.08] dark:border-white/10 pr-2.5 mr-2.5">
                            {renderEmojiElement(g.emoji, 'h-12 w-12 object-contain')}
                          </div>

                          <div className="flex-1 min-w-0 flex flex-col gap-1.5 max-h-[160px] overflow-y-auto scrollbar-none">
                            {g.users.map((u) => (
                              <div key={u.id} className="flex items-center gap-2 min-w-0">
                                <Avatar className="h-5 w-5 shrink-0 border border-black/[0.08] dark:border-white/10">
                                  <AvatarImage src={u.avatarUrl} />
                                  <AvatarFallback className="text-[9px]">{u.displayName.slice(0, 1)}</AvatarFallback>
                                </Avatar>

                                <div className="min-w-0 flex-1 flex flex-col">
                                  <span className="text-[12px] font-black text-foreground dark:text-white truncate leading-none mb-0.5">
                                    {u.displayName}
                                  </span>

                                  <span className="text-[10px] text-muted-foreground/70 truncate leading-none">
                                    @{u.username}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}</>);
  const replyActions = (<>{mediaPresentation && replyReactions}            {!embedded && <div data-lime-comment-actions className={detail ? `col-span-2 mt-3 flex items-center gap-1 text-muted-foreground relative h-9 ${mobileFlat ? 'post-detail-mobile-action-row' : 'border-t border-border/60 pt-3'}` : isMobile ? 'mt-2 flex items-center gap-1 text-muted-foreground relative h-8' : 'mt-3 flex items-center gap-1 text-muted-foreground relative h-9'}>
              <div onClick={(e) => e.stopPropagation()} className={detail && mobileFlat ? "flex items-center h-full post-detail-mobile-action-hit" : "flex items-center h-full"}>
                <div className="inline-flex"><Commentlikebutton syncState={!!onMediaLikeChange} onChange={onMediaLikeChange}
                  commentId={comment.id}
                  liked={comment.likedByMe}
                  count={comment.likesCount}
                /></div>
              </div>

                <RepostButton post={replyToPost({...comment,replyToUsername})} mobilePresentation={useMobilePresentation} />
              <Link
                to={commentThreadUrl(comment.postId, comment.id)}
                aria-label="この返信に返信する"
                onClick={(e) => {e.stopPropagation();if(onMediaReply){e.preventDefault();onMediaReply();}}}
                className={`inline-flex items-center gap-1.5 rounded-full ${useMobilePresentation && !detail ? "px-2 text-[13px]" : "px-2.5 text-sm"} py-1 transition-colors hover:text-accent h-full ${detail && mobileFlat ? 'post-detail-mobile-reply-count' : ''}`}
              >
                <MessageCircle className="h-5 w-5" />
                <span className={`font-bold tabular-nums ${mobileFlat || isMobile ? "text-[15px]" : "text-sm"}`}>{(comment.commentsCount ?? 0) > 0 ? formatDisplayCount(comment.commentsCount ?? 0) : ''}</span>
              </Link>

              <div className="relative inline-flex items-center h-full" onClick={(e) => e.stopPropagation()}>
                <button
                  ref={buttonRef}
                  onClick={() => setShowPicker(!showPicker)}
                  className={
                    !(detail && mobileFlat) && useMobilePresentation
                      ? `inline-flex items-center justify-center gap-1.5 rounded-full px-2 py-1 text-[13px] transition-colors hover:text-accent h-full origin-center ${
                          showPicker ? 'text-accent bg-accent/10' : 'text-muted-foreground'
                        }`
                      : `inline-flex items-center justify-center p-1.5 rounded-full transition-colors hover:text-accent h-8 w-8 origin-center ${detail && mobileFlat ? 'post-detail-mobile-plus-button' : ''} ${
                          showPicker ? 'text-accent bg-accent/10' : 'text-muted-foreground'
                        }`
                  }
                >
                  <Plus className="h-5 w-5" />
                </button>

                {showPicker && (
                  <>
                    <div className="fixed inset-0 bg-transparent z-[9998]" onClick={() => setShowPicker(false)} />

                    {isMobile ? (
                      <div
                        className="fixed bottom-[76px] left-1/2 transform -translate-x-1/2 w-[92vw] max-w-[340px] h-[430px] rounded-[24px] border border-border/80 bg-white dark:bg-[#1e222b] shadow-2xl z-[9999] p-4 animate-slide-up-mobile overflow-y-auto overflow-x-hidden touch-pan-y"
                        onTouchStart={(e) => e.stopPropagation()}
                        onScroll={(e) => e.stopPropagation()}
                      >
                        <div className="grid grid-cols-5 gap-2.5 mb-3.5 shrink-0">
                          {defaultEmojis.map((emoji) => (
                            <button
                              key={emoji}
                              onClick={(e) => handleAddReaction(emoji, e)}
                              className="flex items-center justify-center h-11 w-11 text-2xl rounded-2xl hover:bg-black/[0.05] dark:hover:bg-white/10 transition-all origin-center"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>

                        {recentEmojis.length > 0 && (
                          <div className="mb-3.5 shrink-0">
                            <div className="text-[11px] font-bold text-muted-foreground/60 mb-1.5 px-0.5">最近使用</div>
                            <div className="flex flex-wrap gap-2.5">
                              {recentEmojis.map((emoji) => (
                                <button
                                  key={`recent-${emoji}`}
                                  onClick={(e) => handleAddReaction(emoji, e)}
                                  className="flex items-center justify-center h-9 w-9 rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/10 transition-all origin-center"
                                >
                                  {renderEmojiElement(emoji, 'h-6 w-6 object-contain')}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex flex-col border-t border-black/[0.08] dark:border-white/5 pt-2">
                          <button
                            onClick={() => setIsEmojisOpen(!isEmojisOpen)}
                            className="flex items-center justify-between w-full px-0.5 py-1 text-[11px] font-black text-muted-foreground/80 hover:text-foreground transition-colors shrink-0"
                          >
                            <span className="truncate">カスタム絵文字</span>
                            <span className="text-[10px] opacity-60">{isEmojisOpen ? '▲' : '▼'}</span>
                          </button>

                          {isEmojisOpen && (
                            <div className="p-0.5 block mt-1">
                              {filteredCustomEmojis.length > 0 ? (
                                <div className="grid grid-cols-4 gap-2.5">
                                  {filteredCustomEmojis.map((emoji) => {
                                    const token = toEmojiToken(emoji.name);

                                    return (
                                      <button
                                        key={emoji.id}
                                        onClick={(e) => handleAddReaction(token, e)}
                                        title={token}
                                        className="flex items-center justify-center h-12 w-12 rounded-2xl hover:bg-black/[0.05] dark:hover:bg-white/10 transition-all p-1.5 origin-center"
                                      >
                                        {renderEmojiElement(token, 'h-9 w-9 object-contain')}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="text-center text-[11px] text-muted-foreground/50 py-6">
                                  絵文字が見つかりません
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div
                        className="absolute bottom-full left-0 mb-2 w-[260px] h-[280px] rounded-[20px] border border-border/80 bg-white dark:bg-[#1e222b] shadow-2xl z-[9999] p-2.5 animate-zoom-in-pc overflow-y-auto overflow-x-hidden"
                        onWheel={(e) => e.stopPropagation()}
                      >
                        <div className="grid grid-cols-7 gap-1 mb-2 shrink-0">
                          {defaultEmojis.map((emoji) => (
                            <button
                              key={emoji}
                              onClick={(e) => handleAddReaction(emoji, e)}
                              className="flex items-center justify-center h-8 w-8 text-xl rounded-lg hover:bg-black/[0.05] dark:hover:bg-white/10 transition-all origin-center"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>

                        {recentEmojis.length > 0 && (
                          <div className="mb-2 shrink-0">
                            <div className="text-[11px] font-bold text-muted-foreground/60 mb-1 px-0.5">最近使用</div>
                            <div className="flex flex-wrap gap-1">
                              {recentEmojis.map((emoji) => (
                                <button
                                  key={`recent-${emoji}`}
                                  onClick={(e) => handleAddReaction(emoji, e)}
                                  className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-black/[0.05] dark:hover:bg-white/10 transition-all origin-center"
                                >
                                  {renderEmojiElement(emoji, 'h-[18px] w-[18px] object-contain')}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex flex-col border-t border-black/[0.08] dark:border-white/5 pt-1.5">
                          <button
                            onClick={() => setIsEmojisOpen(!isEmojisOpen)}
                            className="flex items-center justify-between w-full px-0.5 py-1 text-[11px] font-black text-muted-foreground/80 hover:text-foreground transition-colors shrink-0"
                          >
                            <span className="truncate">カスタム絵文字</span>
                            <span className="text-[10px] opacity-60">{isEmojisOpen ? '▲' : '▼'}</span>
                          </button>

                          {isEmojisOpen && (
                            <div className="p-0.5 mt-1">
                              {filteredCustomEmojis.length > 0 ? (
                                <div className="grid grid-cols-6 gap-1">
                                  {filteredCustomEmojis.map((emoji) => {
                                    const token = toEmojiToken(emoji.name);

                                    return (
                                      <button
                                        key={emoji.id}
                                        onClick={(e) => handleAddReaction(token, e)}
                                        title={token}
                                        className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-black/[0.05] dark:hover:bg-white/10 transition-all p-0.5 origin-center"
                                      >
                                        {renderEmojiElement(token, 'h-6 w-6 object-contain')}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="text-center text-[11px] text-muted-foreground/50 py-4">
                                  絵文字が見つかりません
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="mt-2 pt-1.5 border-t border-black/[0.08] dark:border-white/5 shrink-0">
                          <input
                            type="text"
                            placeholder="検索"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full h-8 bg-black/[0.03] dark:bg-black/30 border border-black/[0.08] dark:border-white/10 rounded-lg px-2.5 text-xs font-medium text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-pink-500/50 transition-colors"
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              <ReplyShare comment={comment} currentUserId={currentUserId} className={detail && mobileFlat ? 'post-detail-mobile-share-button' : ''} />
            </div>}</>);

  return (
    <>
      <style>{`
        @keyframes misskeyRingExpand {
          0% {
            transform: translate(-50%, -50%) scale(0.6);
            opacity: 1;
            border-width: 5px;
          }
          40% {
            opacity: 1;
            border-width: 4px;
          }
          100% {
            transform: translate(-50%, -50%) scale(1.15);
            opacity: 0;
            border-width: 1px;
          }
        }

        @keyframes misskeyDotBurst {
          0% {
            transform: translate(-50%, -50%) rotate(var(--mk-angle)) translateY(0px) scale(0.2);
            opacity: 0;
          }
          15% {
            opacity: 1;
            transform: translate(-50%, -50%) rotate(var(--mk-angle)) translateY(calc(var(--mk-dist) * 0.4)) scale(1.1);
          }
          60% {
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) rotate(var(--mk-angle)) translateY(var(--mk-dist)) scale(0);
            opacity: 0;
          }
        }

        @keyframes misskeyButtonElastic {
          0% { transform: scale(1); }
          20% { transform: scale(0.84); }
          50% { transform: scale(1.16); }
          75% { transform: scale(0.94); }
          100% { transform: scale(1); }
        }

        .misskey-elastic-active {
          animation: misskeyButtonElastic 420ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards !important;
        }

        @keyframes slideUpMobile {
          0% {
            transform: translate(-50%, 24px);
            opacity: 0;
          }
          100% {
            transform: translate(-50%, 0);
            opacity: 1;
          }
        }

        .animate-slide-up-mobile {
          animation: slideUpMobile 240ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        @keyframes zoomInPc {
          0% {
            transform: scale(0.9) translateY(8px);
            opacity: 0;
          }
          100% {
            transform: scale(1) translateY(0);
            opacity: 1;
          }
        }

        .animate-zoom-in-pc {
          animation: zoomInPc 160ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        @media (max-width: 639px) {
          .comment-list-mobile-item {
            max-width: none !important;
            padding: 12px 16px !important;
            border: 0 !important;
            border-bottom: 1px solid hsl(var(--border) / 0.62) !important;
            border-radius: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
          }

          .comment-list-mobile-stack {
            margin: 0 !important;
          }

          .comment-list-mobile-stack > li {
            margin-top: 0 !important;
          }

          .comment-list-mobile-state {
            border: 0 !important;
            border-bottom: 1px solid hsl(var(--border) / 0.62) !important;
            border-radius: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
          }

          .comment-list-mobile-empty {
            border: 0 !important;
            border-radius: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
          }
        }
      `}</style>

      {(activeRings.length > 0 || activeDots.length > 0) && (
        <div className="fixed inset-0 pointer-events-none z-[9999] overflow-hidden">
          {activeRings.map((r) => (
            <div
              key={r.id}
              style={{
                position: 'fixed',
                left: r.x,
                top: r.y,
                width: `${r.width}px`,
                height: `${r.height}px`,
                borderRadius: '9999px',
                border: '4px solid #d4f022',
                backgroundColor: 'transparent',
                transformOrigin: 'center center',
                animation: 'misskeyRingExpand 460ms cubic-bezier(0.1, 0.8, 0.3, 1) forwards',
              }}
            />
          ))}

          {activeDots.map((d) => (
            <div
              key={d.id}
              style={{
                position: 'fixed',
                left: d.x,
                top: d.y,
                width: `${d.size}px`,
                height: `${d.size}px`,
                backgroundColor: d.color,
                borderRadius: '50%',
                transformOrigin: 'center center',
                ['--mk-angle' as any]: `${d.angle}deg`,
                ['--mk-dist' as any]: `${d.distance}px`,
                animation: 'misskeyDotBurst 480ms cubic-bezier(0.12, 0.85, 0.3, 1) forwards',
                animationDelay: `${d.delay}ms`,
              }}
            />
          ))}
        </div>
      )}

      {mediaPresentation ? <article data-lime-media-post-actions={mediaPresentation} className="relative w-full">{mediaPresentation==='menu'?replyMenu:replyActions}</article> : <article
        data-lime-comment-card={comment.id}
        data-lime-embedded={embedded || undefined}
        data-lime-reply-detail={detail || undefined}
        data-lime-thread-item={thread || undefined}
        onClick={handleCardClick}
        className={
          embedded ? 'relative w-full cursor-pointer' : flat
            ? 'relative w-full py-3 cursor-pointer' : mobileFlat
            ? 'comment-list-mobile-item relative mx-auto w-full max-w-[600px] px-0 py-3 cursor-pointer'
            : isMobile
              ? 'relative mx-auto w-full max-w-[600px] px-0 py-3 cursor-pointer'
            : 'rounded-3xl border border-border/60 bg-card p-5 shadow-soft transition hover:shadow-card-soft relative cursor-pointer'
        }
      >
        {isMobile && !thread && !flat && (
          <div className="pointer-events-none absolute bottom-0 left-1/2 w-screen -translate-x-1/2 border-b border-border/60" />
        )}

        {repostedByLabel && !embedded && <div data-lime-repost-label className="mb-1 flex items-center gap-3 text-sm font-semibold text-muted-foreground"><span className="inline-flex w-11 shrink-0 justify-end"><RepostIcon className="h-4 w-4" /></span><span>{repostedByLabel}がリポストしました</span></div>}
        <div data-lime-post-layout className={detail ? "grid grid-cols-[48px_minmax(0,1fr)] gap-x-3" : "flex items-start gap-3"}>
          <HoverCard openDelay={300}>
            <HoverCardTrigger asChild>
              <Link
                to={`/u/${comment.author.username}`}
                className="shrink-0"
                data-lime-thread-avatar={thread || undefined}
                data-lime-post-avatar
                onClick={(e) => e.stopPropagation()}
              >
                <Avatar userId={comment.author.id} className={detail ? 'h-12 w-12 border border-border/60 post-detail-mobile-avatar' : 'h-11 w-11 border-2 border-primary/30'}>
                  <AvatarImage src={comment.author.avatarUrl} alt={comment.author.displayName} />
                  <AvatarFallback>{comment.author.displayName.slice(0, 1)}</AvatarFallback>
                </Avatar>
              </Link>
            </HoverCardTrigger>

            <ProfileHoverContent />
          </HoverCard>

          <div data-lime-post-content className={detail ? "contents" : "min-w-0 flex-1"}>
            <div data-lime-post-header className={detail ? "flex items-start justify-between mb-1" : "flex items-center justify-between mb-1"}>
              <div className={detail ? "flex flex-wrap items-center w-full min-w-0" : "flex items-center overflow-hidden w-full min-w-0"}>
                <HoverCard openDelay={300}>
                  <HoverCardTrigger asChild>
                    <Link
                      to={`/u/${comment.author.username}`}
                      className="flex items-center min-w-0 shrink font-display font-bold text-foreground hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-0.5 min-w-0">
                        <span className={detail && mobileFlat ? 'truncate post-detail-mobile-name' : 'truncate text-base'}>
                          {comment.author.displayName}
                        </span>

                        {comment.author.isOfficial && (
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

                <span className={detail ? `w-full truncate text-xs text-muted-foreground ${mobileFlat ? 'post-detail-mobile-username' : ''}` : 'truncate text-base text-muted-foreground ml-1 opacity-80 shrink'}>
                  @{comment.author.username}
                </span>

                {!detail && <span className="text-muted-foreground mx-1 shrink-0">·</span>}

                {!detail && <span className={isMobile ? 'text-[16px] text-muted-foreground whitespace-nowrap shrink-0' : 'text-sm text-muted-foreground whitespace-nowrap shrink-0'}>
                  {formatRelative(comment.createdAt)}
                </span>}
              </div>

              {!embedded && replyMenu}
            </div>

            <div data-lime-post-body data-lime-post-has-images={allImageUrls.length > 0 || undefined} className={detail ? "col-span-2 min-w-0" : undefined}>
              <div>
                {replyToUsername && <p className="mb-1 text-sm text-muted-foreground">返信先: <Link className="text-primary hover:underline" to={`/u/${replyToUsername}`} onClick={event => event.stopPropagation()}>@{replyToUsername}</Link>さん</p>}
                {displayContent && (
                  <p className={detail ? `mt-4 whitespace-pre-wrap break-words text-lg leading-relaxed text-foreground ${mobileFlat ? 'post-detail-mobile-content' : ''}` : isMobile ? 'whitespace-pre-wrap break-words text-[16px] leading-normal text-foreground mt-1' : 'whitespace-pre-wrap break-words text-base leading-relaxed text-foreground mt-1'}>
                    {renderContentWithMentions(displayContent)}
                  </p>
                )}

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

              <LinkPreviewCard {...linkPreview} />
              {youtubeId && (
                <div onClick={(e) => e.stopPropagation()} className="mt-3">
                  <YouTubeEmbed videoId={youtubeId} />
                </div>
              )}

              {spotifyUrls.length > 0 && (
                <div onClick={(e) => e.stopPropagation()} className="space-y-2 mt-3">
                  {spotifyUrls.map((url, idx) => (
                    <SpotifyEmbed key={`spotify-${idx}`} url={url} />
                  ))}
                </div>
              )}

              {allImageUrls.length === 1 && !failedUrls.includes(allImageUrls[0]) ? (
                <div className="mt-3 flex max-w-full justify-start" onClick={(e) => e.stopPropagation()}>
                  <button type="button" data-lime-single-post-image aria-label="画像を拡大表示" className="block max-w-full cursor-zoom-in overflow-hidden rounded-2xl border border-border/50 bg-black/[0.025] text-left shadow-none dark:bg-white/[0.035]" style={singleImageFrameStyle} onClick={(e) => handleImageClick(e, allImageUrls[0])}>
                    <img src={allImageUrls[0]} alt="返信画像" className="block select-none" style={{ width: '100%', height: 'auto', objectFit: 'contain' }} draggable={false} loading="lazy" decoding="async" onLoad={(e) => { const image = e.currentTarget; if (image.naturalWidth && image.naturalHeight) setImageSize({ url: allImageUrls[0], width: image.naturalWidth, height: image.naturalHeight }); }} onError={() => setFailedUrls((prev) => prev.includes(allImageUrls[0]) ? prev : [...prev, allImageUrls[0]])} />
                  </button>
                </div>
              ) : allImageUrls.length > 1 && (
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
                    embedded={embedded}
                    onImageError={(url) => {
                      if (!failedUrls.includes(url)) {
                        setFailedUrls((prev) => [...prev, url]);
                      }
                    }}
                  />
                </div>
              )}
            </div>

            {replyReactions}

            {detail && <p className={`col-span-2 mt-4 text-xs text-muted-foreground ${mobileFlat ? 'post-detail-mobile-meta' : ''}`} title={formatDate(comment.createdAt)}>{formatDate(comment.createdAt)} · {formatRelative(comment.createdAt)}{comment.clientName && <><span className="mx-1">·</span><span className="text-primary/80 font-medium">{comment.clientName}</span></>}</p>}
            {replyActions}
          </div>
        </div>
      </article>}


    </>
  );
}

// ─── CommentList ──────────────────────────────────────────────────────────────
export function CommentList({
  postId,
  mobileFlat = false,
  parentCommentId = null,
  threadAuthorId,
}: {
  postId: string;
  mobileFlat?: boolean;
  parentCommentId?: string | null;
  threadAuthorId?: string;
}) {
  const { data, isLoading, isError } = useComments(postId);
  const [expandedReplies, setExpandedReplies] = useState<ReadonlySet<string>>(new Set());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => { setExpandedReplies(new Set()); }, [postId, parentCommentId]);

  useEffect(() => {
    getCurrentUserId().then(setCurrentUserId);

    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  if (isLoading) {
    return <div><PostCardSkeleton /><PostCardSkeleton /></div>;
  }

  if (isError) {
    return (
      <div className={`${mobileFlat ? 'comment-list-mobile-state ' : ''}rounded-3xl border border-destructive/40 bg-destructive/5 p-6 text-center`}>
        <p className="text-sm text-destructive">コメントの読み込みに失敗しました。</p>
      </div>
    );
  }

  const directReplies = data?.filter(comment => (comment.parentCommentId ?? null) === parentCommentId) ?? [];
  if (directReplies.length === 0) {
    return (
      <div className={mobileFlat
        ? 'comment-list-mobile-empty p-8 text-center text-muted-foreground'
        : 'rounded-3xl border border-border/60 bg-card p-8 text-center text-muted-foreground'
      }>
        まだコメントはありません。
      </div>
    );
  }

  const conversations = getAuthorReplyConversations(data ?? [], threadAuthorId, parentCommentId, expandedReplies);

  return (
    <ul className="m-0 space-y-0" data-lime-detail-conversations>
      {conversations.flatMap(({ root, branches, threadIds }) => branches.map(({ items, moreFor }) => (
        <li key={`${root.id}:${items.at(-1)?.id}:${moreFor?.id ?? 'shown'}`} className="animate-float-up">
          <div className="border-b border-border/60 px-4 sm:px-6">
            <ReplyChain>
              {items.map(c => <div key={c.id} data-lime-conversation-comment={c.id} data-lime-conversation-parent={c.parentCommentId ?? ''}>
                <CommentCard flat comment={{ ...c, likesCount: Number(c.likesCount ?? c.likes_count ?? 0), likedByMe: !!c.likedByMe } as Comment} currentUserId={currentUserId} mobileFlat={mobileFlat} thread={threadIds.has(c.id)} />
              </div>)}
              {moreFor && <button type="button" data-lime-thread-more={moreFor.id} onClick={() => setExpandedReplies(previous => new Set([...previous, moreFor.id]))} className="ml-14 flex min-h-12 items-center py-3 text-base text-primary hover:underline">返信を表示</button>}
            </ReplyChain>
          </div>
        </li>
      )))}
    </ul>
  );
}
