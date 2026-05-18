import { useState, useEffect, useRef } from 'react'; 
import { Link, useNavigate } from 'react-router-dom';
import { MessageCircle, MoreHorizontal, Trash2, CalendarDays, ChartBarBig, X, Globe, Lock, Sparkles, Plus } from 'lucide-react'; 
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

// --- カスタム絵文字用の型定義 ---
interface CustomEmoji {
  id: string;
  name: string;
  public_id: string;
  format: string;
  uploaded_by: string;
}

// ユーザー情報を含んだリアクション詳細型
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

// --- 画像から完全再現する高度なエフェクト用の型定義 ---
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

export function PostCard({ post }: { post: PostWithAuthor }) {
  const [showMenu, setShowMenu] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null); 
  const [failedUrls, setFailedUrls] = useState<string[]>([]); 
  const navigate = useNavigate();
  const [, setTick] = useState(0);

  // --- カスタム絵文字・リアクション用ステート群 ---
  const [showPicker, setShowPicker] = useState(false);
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([]);
  const [reactions, setReactions] = useState<ReactionGroup[]>([]);
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isEmojisOpen, setIsEmojisOpen] = useState(true);
  
  // 現在アクティブなリアクションポップアップの管理
  const [activePopupEmoji, setActivePopupEmoji] = useState<string | null>(null);
  let longPressTimer: NodeJS.Timeout;

  // --- 画像再現エフェクト用のステート ---
  const [activeRings, setActiveRings] = useState<ReplicatedRing[]>([]);
  const [activeDots, setActiveDots] = useState<ReplicatedDot[]>([]);

  // スマホ・PCのリアルタイム判定用ステート
  const [isMobile, setIsMobile] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);

  const defaultEmojis = ['👍', '❤️', '😆', '🤔', '😮', '🎉', '💢', '😢', '😇', '🍮'];

  const formatDisplayCount = (count: number) => {
    if (count >= 10000) {
      return (count / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    }
    return count.toLocaleString();
  };

  useEffect(() => {
    getCurrentUserId().then(id => {
      setCurrentUserId(id);
      if (id) {
        const saved = localStorage.getItem(`recent_emojis_${id}`);
        if (saved) {
          try { setRecentEmojis(JSON.parse(saved)); } catch (e) { console.error(e); }
        }
      }
    });

    fetchReactions();
    fetchCustomEmojis();

    // 初期画面幅の判定とリスナー設定
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);

    const channels = supabase
      .channel(`post-reactions-${post.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'post_reactions',
          filter: `post_id=eq.${post.id}`
        },
        () => {
          fetchReactions();
        }
      )
      .subscribe();

    const timer = setInterval(() => {
      setTick(tick => tick + 1);
    }, 60000);

    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', checkMobile);
      supabase.removeChannel(channels);
    };
  }, [post.id]);

  // ポップアップ表示時または画像拡大時に背後のスクロールを完全に禁止にする
  useEffect(() => {
    if (selectedImageUrl || showPicker) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [selectedImageUrl, showPicker]);

  const fetchReactions = async () => {
    try {
      const { data: reactionData, error: reactionError } = await supabase
        .from('post_reactions')
        .select('emoji, user_id')
        .eq('post_id', post.id);

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

        const groups: { [key: string]: { userIds: string[], users: ReactionUser[] } } = {};
        
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
              avatarUrl: profile.avatar_url || ''
            });
          }
        });

        const formattedGroups: ReactionGroup[] = Object.keys(groups).map(emoji => ({
          emoji,
          count: groups[emoji].userIds.length,
          user_ids: groups[emoji].userIds,
          users: groups[emoji].users
        }));

        setReactions(formattedGroups);
      } else {
        setReactions([]);
      }
    } catch (err) {
      console.error('Fetch Reactions Error:', err);
    }
  };

  const fetchCustomEmojis = async () => {
    try {
      const { data, error } = await supabase
        .from('custom_emojis')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (data) setCustomEmojis(data);
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
      height: rect.height + 4
    };

    const colors = ['#d4f022', '#e6007e', '#22f0d8', '#d4f022', '#e6007e'];
    const dotCount = 16; 
    const newDots: ReplicatedDot[] = [];

    for (let i = 0; i < dotCount; i++) {
      const angle = (i / dotCount) * 360 + (Math.random() * 20 - 10);
      const maxDistance = (rect.width / 2) + (Math.random() * 16 - 4);

      newDots.push({
        id: `dot-${batchId}-${i}`,
        x: centerX,
        y: centerY,
        angle: angle,
        distance: maxDistance,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() * 5 + 5, 
        delay: Math.random() * 40 
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

    const updatedRecents = [emoji, ...recentEmojis.filter(e => e !== emoji)].slice(0, 10);
    setRecentEmojis(updatedRecents);
    localStorage.setItem(`recent_emojis_${currentUserId}`, JSON.stringify(updatedRecents));

    try {
      const { data: existing, error: checkError } = await supabase
        .from('post_reactions')
        .select('id')
        .eq('post_id', post.id)
        .eq('user_id', currentUserId)
        .eq('emoji', emoji)
        .maybeSingle();

      if (checkError) throw checkError;

      if (existing) {
        const { error } = await supabase
          .from('post_reactions')
          .delete()
          .eq('id', existing.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('post_reactions')
          .insert({
            post_id: post.id,
            user_id: currentUserId,
            emoji: emoji
          });

        if (error) throw error;
      }
      fetchReactions();
      setShowPicker(false);
    } catch (err) {
      console.error('Toggle Reaction Error:', err);
    }
  };

  const getCustomEmojiObj = (emojiStr: string) => {
    if (emojiStr.startsWith(':') && emojiStr.endsWith(':')) {
      const cleanName = emojiStr.slice(1, -1);
      return customEmojis.find(e => e.name === cleanName);
    }
    return null;
  };

  const renderEmojiElement = (emojiStr: string, className = "h-5 w-5 object-contain inline-block") => {
    const customEmoji = getCustomEmojiObj(emojiStr);
    if (customEmoji) {
      const cleanPublicId = customEmoji.public_id.startsWith('custom_emojis/')
        ? customEmoji.public_id
        : `custom_emojis/${customEmoji.public_id}`;

      const imageUrl = `https://res.cloudinary.com/dveiikhhw/image/upload/${cleanPublicId}.${customEmoji.format}`;
      return <img src={imageUrl} alt={customEmoji.name} className={className} />;
    }
    return <span className="text-lg leading-none select-none">{emojiStr}</span>;
  };

  const handleTouchStart = (emoji: string) => {
    longPressTimer = setTimeout(() => {
      setActivePopupEmoji(emoji);
    }, 500); 
  };

  const handleTouchEnd = () => {
    clearTimeout(longPressTimer);
  };

  const filteredCustomEmojis = customEmojis.filter(emoji => 
    emoji.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const isMyPost = currentUserId === post.userId;
  const youtubeId = getYouTubeId(post.content);

  const spotifyRegex = /https:\/\/open\.spotify\.com\/(?:[\w-]+\/)?(track|album|playlist)\/[a-zA-Z0-9._?=&/%-]+/gi;
  const spotifyUrls = post.content.match(spotifyRegex) || [];
  const imageRegex = /https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s]*)?|https?:\/\/pbs\.twimg\.com\/media\/[^\s?]+(?:\?[^\s]*)?/gi;
  const extractedImageUrls = post.content.match(imageRegex) || [];
  const allImageUrls = [...(post.imageUrls || []), ...extractedImageUrls].slice(0, 4);

  let displayContent = post.content;
  displayContent = displayContent.replace(/(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/(watch\?v=|embed\/|shorts\/)?([a-zA-Z0-9_-]{11})([^?\s\n]*)?(\S+)?/g, '');
  displayContent = displayContent.replace(imageRegex, '');
  displayContent = displayContent.replace(spotifyRegex, '');
  displayContent = displayContent.trim();

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

  const renderContentWithMentions = (text: string) => {
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

  const handleImageClick = (e: React.MouseEvent, url: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedImageUrl(url);
  };

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
        <p className="text-[15px] text-muted-foreground stroke-none">@{post.author.username}</p>
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

        /* --- スマホ専用：画面下部から滑らかにスライド湧き出しするアニメーション --- */
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

        /* --- PC専用：プラスボタンの直上(absolute)から上に弾むようにズームインするアニメーション --- */
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
      `}</style>

      {/* --- 高度グラフィックアニメーションレイヤー --- */}
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
                animation: 'misskeyRingExpand 460ms cubic-bezier(0.1, 0.8, 0.3, 1) forwards'
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
                animation: `misskeyDotBurst 480ms cubic-bezier(0.12, 0.85, 0.3, 1) forwards`,
                animationDelay: `${d.delay}ms`
              }}
            />
          ))}
        </div>
      )}

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
                    <MoreHorizontal className="h-5 w-5" />
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

            <div>
              <div onClick={(e) => { e.stopPropagation(); navigate(`/post/${post.id}`); }}>
                {displayContent && (
                  <p className="whitespace-pre-wrap break-words text-base leading-relaxed text-foreground mt-1">
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

              {((post as any).is_bot || post.isBot) && (
                <div className="flex items-center gap-1 mt-1.5 text-muted-foreground/70">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span className="text-[15px] font-medium">AIで生成</span>
                </div>
              )}

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

            {/* --- リアクションバッジエリア（reactionsがある時のみレンダリングされ、ない時は完全に消滅） --- */}
            {reactions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 relative" onClick={(e) => e.stopPropagation()}>
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
                        {renderEmojiElement(g.emoji, "h-5 w-5 object-contain")}
                        <span className="tabular-nums text-sm font-black">{g.count}</span>
                      </button>

                      {/* --- リアクションユーザーポップアップ --- */}
                      {isPopupOpen && g.users.length > 0 && (
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-[260px] bg-white dark:bg-[#252932] border border-black/[0.08] dark:border-white/5 rounded-2xl shadow-2xl z-[60] flex p-3 pointer-events-none">
                          
                          <div className="w-[64px] h-[64px] shrink-0 flex items-center justify-center border-r border-black/[0.08] dark:border-white/10 pr-2.5 mr-2.5">
                            {renderEmojiElement(g.emoji, "h-12 w-12 object-contain")}
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
            )}

            {/* --- アクションボタンエリア（上部要素とのマージンを mt-3 に均一化） --- */}
            <div className="mt-3 flex items-center gap-1 text-muted-foreground relative h-9">
              <div onClick={(e) => e.stopPropagation()} className="flex items-center h-full">
                <LikeButton 
                  postId={post.id} 
                  liked={post.likedByMe} 
                  count={post.likesCount} 
                />
              </div>
              <Link
                to={`/post/${post.id}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors hover:text-accent h-full"
              >
                <MessageCircle className="h-5 w-5" />
                <span className="font-bold tabular-nums text-sm">{formatDisplayCount(post.commentsCount)}</span>
              </Link>

              <div className="relative inline-flex items-center h-full" onClick={(e) => e.stopPropagation()}>
                <button
                  ref={buttonRef}
                  onClick={() => setShowPicker(!showPicker)}
                  className={`inline-flex items-center justify-center p-1.5 rounded-full transition-colors hover:text-accent h-8 w-8 origin-center ${
                    showPicker ? 'text-accent bg-accent/10' : 'text-muted-foreground'
                  }`}
                >
                  <Plus className="h-5 w-5" />
                </button>

                {showPicker && (
                  <>
                    {/* 背景レイヤー：最前面手前の z-[9998] で他の要素へのタップや背景スクロールを物理カット */}
                    <div className="fixed inset-0 bg-transparent z-[9998]" onClick={() => setShowPicker(false)} />
                    
                    {isMobile ? (
                      /* =========================================================================
                         【スマートフォン専用ポップアップ：バー全体をスクロール対応化】
                         ========================================================================= */
                      <div 
                        className="fixed bottom-[76px] left-1/2 transform -translate-x-1/2 w-[92vw] max-w-[340px] h-[430px] rounded-[24px] border border-border/80 bg-white dark:bg-[#1e222b] shadow-2xl z-[9999] p-4 animate-slide-up-mobile overflow-y-auto overflow-x-hidden touch-pan-y"
                        onTouchStart={(e) => e.stopPropagation()}
                        onScroll={(e) => e.stopPropagation()}
                      >
                        {/* デフォルト絵文字 */}
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
                                  {renderEmojiElement(emoji, "h-6 w-6 object-contain")}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* カスタム絵文字：内側の高さ固定を解除しバー全体のスクロールに統合 */}
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
                                  {filteredCustomEmojis.map((emoji) => (
                                    <button
                                      key={emoji.id}
                                      onClick={(e) => handleAddReaction(`:${emoji.name}:`, e)}
                                      title={`:${emoji.name}:`}
                                      className="flex items-center justify-center h-12 w-12 rounded-2xl hover:bg-black/[0.05] dark:hover:bg-white/10 transition-all p-1.5 origin-center"
                                    >
                                      {renderEmojiElement(`:${emoji.name}:`, "h-9 w-9 object-contain")}
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-center text-[11px] text-muted-foreground/50 py-6">絵文字が見つかりません</div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      /* =========================================================================
                         【PC専用ポップアップ：バー全体をスクロール対応化・縦幅 h-[280px]】
                         ========================================================================= */
                      <div 
                        className="absolute bottom-full left-0 mb-2 w-[260px] h-[280px] rounded-[20px] border border-border/80 bg-white dark:bg-[#1e222b] shadow-2xl z-[9999] p-2.5 animate-zoom-in-pc overflow-y-auto overflow-x-hidden"
                        onWheel={(e) => e.stopPropagation()}
                      >
                        {/* デフォルト絵文字 */}
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
                                  {renderEmojiElement(emoji, "h-[18px] w-[18px] object-contain")}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* カスタム絵文字：内側の高さ制限を外し全体のスクロールに委ねる */}
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
                                  {filteredCustomEmojis.map((emoji) => (
                                    <button
                                      key={emoji.id}
                                      onClick={(e) => handleAddReaction(`:${emoji.name}:`, e)}
                                      title={`:${emoji.name}:`}
                                      className="flex items-center justify-center h-8 w-8 rounded-lg hover:bg-black/[0.05] dark:hover:bg-white/10 transition-all p-0.5 origin-center"
                                    >
                                      {renderEmojiElement(`:${emoji.name}:`, "h-6 w-6 object-contain")}
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-center text-[11px] text-muted-foreground/50 py-4">絵文字が見つかりません</div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* 検索バー */}
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

            </div>
          </div>
        </div>
      </article>

      {/* 画像拡大オーバーレイ */}
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