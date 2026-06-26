import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MessageCircle, X, Plus, Link as LinkIcon, Upload, Send } from 'lucide-react'; // Plusを追加
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { LikeButton } from '@/components/post/LikeButton';
import { CommentList } from '@/components/post/CommentList';
import { CommentForm } from '@/components/post/CommentForm';
import { PostImages } from '@/components/feed/PostImages';
import { usePost } from '@/hooks/useFeed';
import { formatDate, formatRelative } from '@/lib/format';
import { getYouTubeId } from '@/lib/utils';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/currentUser';

// --- カスタム絵文字・リアクション用型定義 ---
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

interface LimeDropTarget {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
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

export default function PostDetail() {
  const { id = '' } = useParams();
  const { data, isLoading, isError } = usePost(id);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null); // 拡大用
  const [failedUrls, setFailedUrls] = useState<string[]>([]); // 読み込み失敗URL管理
  const navigate = useNavigate();

  // --- カスタム絵文字・リアクション用ステート群 ---
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([]);
  const [reactions, setReactions] = useState<ReactionGroup[]>([]);
  const [activePopupEmoji, setActivePopupEmoji] = useState<string | null>(null);
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  const [showPicker, setShowPicker] = useState(false); // ピッカー表示
  const [searchQuery, setSearchQuery] = useState(''); // 絵文字検索
  const [isEmojisOpen, setIsEmojisOpen] = useState(true); // アコーディオン
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [shareMenuPosition, setShareMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [showLimeDropPanel, setShowLimeDropPanel] = useState(false);
  const [limeDropTargets, setLimeDropTargets] = useState<LimeDropTarget[]>([]);
  const [limeDropLoading, setLimeDropLoading] = useState(false);
  const [limeDropSendingUserId, setLimeDropSendingUserId] = useState<string | null>(null);
  const [limeDropFeedback, setLimeDropFeedback] = useState<string | null>(null);
  
  // スマホ・PC判定用
  const [isMobile, setIsMobile] = useState(false);
  const [singleImageNaturalSize, setSingleImageNaturalSize] = useState<{ width: number; height: number } | null>(null);

  // --- 画像再現エフェクト用のステート ---
  const [activeRings, setActiveRings] = useState<ReplicatedRing[]>([]);
  const [activeDots, setActiveDots] = useState<ReplicatedDot[]>([]);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const pickerPanelRef = useRef<HTMLDivElement>(null);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const shareMenuRef = useRef<HTMLDivElement>(null);
  const limeDropPanelRef = useRef<HTMLDivElement>(null);
  let longPressTimer: NodeJS.Timeout;

  const defaultEmojis = ['👍', '❤️', '😆', '🤔', '😮', '🎉', '💢', '😢', '😇', '🍮'];

  // 数値をフォーマットする関数
  const formatDisplayCount = (count: number) => {
    if (count >= 10000) {
      return (count / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    }
    return count.toLocaleString();
  };

  // 初期画面幅の判定とリスナー設定
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 画像拡大時だけスクロールを固定する。
  // 絵文字ピッカーで body overflow を触ると、Header / Dropdown が巻き込まれて消えることがあるため触らない。
  useEffect(() => {
    if (selectedImageUrl) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [selectedImageUrl]);

  useEffect(() => {
    if (!showShareMenu) return;

    const closeShareMenuFromOutside = () => {
      setShowShareMenu(false);
      setShareMenuPosition(null);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (shareButtonRef.current?.contains(target)) return;
      if (shareMenuRef.current?.contains(target)) return;

      closeShareMenuFromOutside();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [showShareMenu]);

  useEffect(() => {
    if (!showShareMenu) return;

    const closeOnViewportChange = () => {
      setShowShareMenu(false);
      setShareMenuPosition(null);
    };

    window.addEventListener('scroll', closeOnViewportChange, true);
    window.addEventListener('resize', closeOnViewportChange);

    return () => {
      window.removeEventListener('scroll', closeOnViewportChange, true);
      window.removeEventListener('resize', closeOnViewportChange);
    };
  }, [showShareMenu]);

  useEffect(() => {
    if (!showLimeDropPanel) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowLimeDropPanel(false);
        setLimeDropSendingUserId(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showLimeDropPanel]);

  // リアクションとカスタム絵文字のデータ取得
  useEffect(() => {
    if (!id) return;

    getCurrentUserId().then(uid => {
      setCurrentUserId(uid);
      if (uid) {
        const saved = localStorage.getItem(`recent_emojis_${uid}`);
        if (saved) {
          try { setRecentEmojis(JSON.parse(saved)); } catch (e) { console.error(e); }
        }
      }
    });

    fetchReactions();
    fetchCustomEmojis();

    const channels = supabase
      .channel(`post-detail-reactions-${id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'post_reactions',
          filter: `post_id=eq.${id}`
        },
        () => {
          fetchReactions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channels);
    };
  }, [id]);

  const fetchReactions = async () => {
    if (!id) return;
    try {
      const { data: reactionData, error: reactionError } = await supabase
        .from('post_reactions')
        .select('emoji, user_id')
        .eq('post_id', id);

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
      const { data: emojiData, error } = await supabase
        .from('custom_emojis')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (emojiData) setCustomEmojis(emojiData);
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
    if (!currentUserId || !id) return;

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
        .eq('post_id', id)
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
            post_id: id,
            user_id: currentUserId,
            emoji: emoji
          });

        if (error) throw error;
      }
      setShowPicker(false);
      fetchReactions();
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

  // 画像クリック時の処理
  const handleImageClick = (e: React.MouseEvent, url: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedImageUrl(url);
  };

  // --- URLをリンク化する関数 ---
  const renderTextWithUrls = (text: string) => {
    if (!text) return null;

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    return parts.map((part, index) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={`url-${index}`}
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

  // --- メンションとハッシュタグをリンク化する関数 ---
  const renderContentWithLinks = (text: string) => {
    if (!text) return null;
    
    // @username と #hashtag 形式にマッチさせる正規表現
    const parts = text.split(/(@\w+|#[^\s#　.,!?:;'"()\[\]{}<>]+)/g);
    
    return parts.map((part, index) => {
      // メンション処理
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
      // ハッシュタグ処理
      if (part.startsWith('#')) {
        return (
          <Link
            key={`hashtag-${index}`}
            to={`/search?q=${encodeURIComponent(part)}`}
            className="text-pink-500 hover:underline transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </Link>
        );
      }
      // メンション・ハッシュタグ以外に対してURLリンク処理を適用
      return renderTextWithUrls(part);
    });
  };
  // ------------------------------

  // 画像URLを判定する正規表現
  const imageRegex = /https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s]*)?|https?:\/\/pbs\.twimg\.com\/media\/[^\s?]+(?:\?[^\s]*)?/gi;

  // 本文から画像URLを抽出
  const extractedImageUrls = data?.content.match(imageRegex) || [];
  
  // 元々の画像配列と、本文から抽出した画像を合体させ、最大4枚に制限
  const allImageUrls = data ? [...(data.imageUrls || []), ...extractedImageUrls].slice(0, 4) : [];
  const singleImageUrl = allImageUrls.length === 1 ? allImageUrls[0] : null;

  useEffect(() => {
    setSingleImageNaturalSize(null);
  }, [singleImageUrl]);

  const getSingleImageFrameStyle = (): CSSProperties => {
    if (!singleImageNaturalSize) {
      return {
        width: '100%',
        maxWidth: '100%',
      };
    }

    const naturalWidth = Math.max(1, singleImageNaturalSize.width);
    const naturalHeight = Math.max(1, singleImageNaturalSize.height);
    const ratio = naturalWidth / naturalHeight;

    const maxTimelineImageHeight = isMobile ? 300 : 480;
    const minimumReadableWidth = isMobile ? 88 : 110;
    const heightLimitedWidth = Math.max(
      minimumReadableWidth,
      Math.round(maxTimelineImageHeight * ratio)
    );
    const shouldLimitByHeight = ratio < (isMobile ? 1.64 : 1.72);
    const shouldAvoidUpscale = naturalWidth <= (isMobile ? 360 : 520);
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
        width: isMobile ? '100%' : 'min(100%, 560px)',
        maxWidth: '100%',
      };
    }

    return {
      width: '100%',
      maxWidth: '100%',
    };
  };

  const getSingleImageDisplayStyle = (): CSSProperties => ({
    width: '100%',
    height: 'auto',
    objectFit: 'contain',
  });

  // YouTube IDの抽出と本文の加工（YouTube URLと画像URLを除去）
  const youtubeId = data ? getYouTubeId(data.content) : null;
  const displayContent = (data && (youtubeId || extractedImageUrls.length > 0))
    ? data.content
        .replace(/(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/(watch\?v=|embed\/|shorts\/)?([a-zA-Z0-9_-]{11})([^?\s\n]*)?(\S+)?/g, '')
        .replace(imageRegex, '')
        .trim()
    : data?.content;

  const useMobileThreadLayout = isMobile;

  const getPostShareUrl = () => {
    if (!data) return '';

    if (typeof window === 'undefined') {
      return `/post/${data.id}`;
    }

    const baseUrl = import.meta.env.BASE_URL || '/';
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    return new URL(`post/${data.id}`, new URL(normalizedBaseUrl, window.location.origin)).toString();
  };

  const getPostShareText = () => {
    if (!data) return 'ポスト';

    const rawText = (displayContent || data.content || '').replace(/\s+/g, ' ').trim();
    if (!rawText) {
      return `${data.author.displayName}さんのポスト`;
    }

    const clippedText = rawText.length > 120 ? `${rawText.slice(0, 120)}...` : rawText;
    return `${data.author.displayName}さんのポスト: ${clippedText}`;
  };

  const copyTextToClipboard = async (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      document.execCommand('copy');
    } finally {
      document.body.removeChild(textarea);
    }
  };

  const closeShareMenu = () => {
    setShowShareMenu(false);
    setShareMenuPosition(null);
  };

  const handleShareButtonClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (showShareMenu) {
      closeShareMenu();
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    setShareMenuPosition({
      top: rect.bottom + 4,
      right: Math.max(8, window.innerWidth - rect.right),
    });
    setShowPicker(false);
    setShowShareMenu(true);
  };

  const handleCopyPostLink = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      await copyTextToClipboard(getPostShareUrl());
      setShareFeedback('リンクをコピーしました');
      window.setTimeout(() => {
        setShareFeedback(null);
      }, 1400);
      closeShareMenu();
    } catch (err) {
      console.error('Copy post link failed:', err);
      setShareFeedback('コピーに失敗しました');
      window.setTimeout(() => {
        setShareFeedback(null);
      }, 1400);
    }
  };

  const handleNativePostShare = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (!data) return;

    const url = getPostShareUrl();
    const title = `${data.author.displayName}さんのポスト`;
    const text = getPostShareText();

    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title, text, url });
        closeShareMenu();
        return;
      }

      await copyTextToClipboard(url);
      setShareFeedback('共有非対応のためリンクをコピーしました');
      window.setTimeout(() => {
        setShareFeedback(null);
      }, 1800);
      closeShareMenu();
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        closeShareMenu();
        return;
      }

      console.error('Native post share failed:', err);
      setShareFeedback('共有に失敗しました');
      window.setTimeout(() => {
        setShareFeedback(null);
      }, 1400);
    }
  };

  const fetchLimeDropTargets = async () => {
    if (!currentUserId) {
      setLimeDropTargets([]);
      setLimeDropFeedback('ログイン状態を確認できません');
      return;
    }

    setLimeDropLoading(true);
    setLimeDropFeedback(null);

    try {
      const { data: currentProfile, error: currentProfileError } = await supabase
        .from('profiles')
        .select('is_official')
        .eq('id', currentUserId)
        .maybeSingle();

      if (currentProfileError) throw currentProfileError;

      if (currentProfile?.is_official === true) {
        const { data: allProfileRows, error: allProfileError } = await supabase
          .from('profiles')
          .select('id, username, display_name, avatar_url')
          .neq('id', currentUserId)
          .order('display_name', { ascending: true });

        if (allProfileError) throw allProfileError;

        const targets: LimeDropTarget[] = (allProfileRows || []).map((profile: any) => ({
          id: profile.id,
          username: profile.username || 'unknown',
          displayName: profile.display_name || profile.username || 'ユーザー',
          avatarUrl: profile.avatar_url || '',
        }));

        setLimeDropTargets(targets);
        return;
      }

      const { data: followingRows, error: followingError } = await supabase
        .from('follows')
        .select('followee_id')
        .eq('follower_id', currentUserId);

      if (followingError) throw followingError;

      const followingIds = Array.from(
        new Set(
          (followingRows || [])
            .map((row: any) => row.followee_id)
            .filter(Boolean)
        )
      );

      const { data: followerRows, error: followerError } = followingIds.length > 0
        ? await supabase
            .from('follows')
            .select('follower_id')
            .eq('followee_id', currentUserId)
            .in('follower_id', followingIds)
        : { data: [], error: null };

      if (followerError) throw followerError;

      const mutualIds = Array.from(
        new Set(
          (followerRows || [])
            .map((row: any) => row.follower_id)
            .filter(Boolean)
        )
      );

      const { data: mutualProfileRows, error: mutualProfileError } = mutualIds.length > 0
        ? await supabase
            .from('profiles')
            .select('id, username, display_name, avatar_url')
            .in('id', mutualIds)
        : { data: [], error: null };

      if (mutualProfileError) throw mutualProfileError;

      const targets: LimeDropTarget[] = (mutualProfileRows || [])
        .map((profile: any) => ({
          id: profile.id,
          username: profile.username || 'unknown',
          displayName: profile.display_name || profile.username || 'ユーザー',
          avatarUrl: profile.avatar_url || '',
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'));

      setLimeDropTargets(targets);
    } catch (err) {
      console.error('Fetch LimeDrop targets failed:', err);
      setLimeDropTargets([]);
      setLimeDropFeedback('送信先の取得に失敗しました');
    } finally {
      setLimeDropLoading(false);
    }
  };

  const handleOpenLimeDropPanel = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    closeShareMenu();
    setShowPicker(false);
    setLimeDropFeedback(null);
    setShowLimeDropPanel(true);
    await fetchLimeDropTargets();
  };

  const handleCloseLimeDropPanel = () => {
    setShowLimeDropPanel(false);
    setLimeDropSendingUserId(null);
  };

  const handleSendLimeDrop = async (target: LimeDropTarget) => {
    if (!currentUserId) {
      setLimeDropFeedback('ログイン状態を確認できません');
      return;
    }

    if (!data) {
      setLimeDropFeedback('ポストを確認できません');
      return;
    }

    setLimeDropSendingUserId(target.id);
    setLimeDropFeedback(null);

    try {
      const url = getPostShareUrl();
      const text = getPostShareText();

      const { error } = await supabase
        .from('lime_drops')
        .insert({
          sender_id: currentUserId,
          recipient_id: target.id,
          post_id: data.id,
          post_url: url,
          post_author_id: data.author.id,
          post_author_username: data.author.username,
          post_author_display_name: data.author.displayName,
          post_text: text,
          status: 'pending',
        });

      if (error) throw error;

      setLimeDropFeedback(`${target.displayName}さんに送信しました`);
      window.setTimeout(() => {
        handleCloseLimeDropPanel();
        setLimeDropFeedback(null);
      }, 900);
    } catch (err) {
      console.error('Send LimeDrop failed:', err);
      setLimeDropFeedback('LimeDropの送信に失敗しました');
    } finally {
      setLimeDropSendingUserId(null);
    }
  };

  return (
    <>
      <div className={useMobileThreadLayout ? 'post-detail-mobile-thread relative z-[1]' : 'relative z-[1] space-y-5'}>
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

        @media (max-width: 639px) {
          .post-detail-mobile-thread {
            width: 100vw;
            min-height: 100dvh;
            margin-left: calc(50% - 50vw);
            margin-right: calc(50% - 50vw);
            padding-bottom: 16px;
            color: hsl(var(--foreground));
          }

          .post-detail-mobile-simple-back {
            margin: 8px 16px 6px !important;
          }

          .post-detail-mobile-article {
            border: 0 !important;
            border-bottom: 0 !important;
            border-radius: 0 !important;
            background: transparent !important;
            margin-top: 0 !important;
            padding: 10px 16px 0 !important;
            box-shadow: none !important;
          }

          .post-detail-mobile-author-row {
            gap: 12px !important;
          }

          .post-detail-mobile-avatar {
            width: 48px !important;
            height: 48px !important;
            border: 1px solid hsl(var(--border) / 0.62) !important;
          }

          .post-detail-mobile-name {
            font-size: 16px;
            font-weight: 700;
            line-height: 1.15;
            color: hsl(var(--foreground));
          }

          .post-detail-mobile-username {
            margin-top: 2px;
            font-size: 15px !important;
            line-height: 1.2;
            color: hsl(var(--muted-foreground)) !important;
          }

          .post-detail-mobile-content {
            margin-top: 20px !important;
            font-size: 18px !important;
            font-weight: 400;
            line-height: 1.5 !important;
            color: hsl(var(--foreground)) !important;
          }

          .post-detail-mobile-meta {
            margin-top: 18px !important;
            font-size: 13px !important;
            line-height: 1.35;
            color: hsl(var(--muted-foreground)) !important;
          }

          .post-detail-mobile-comments-shell {
            margin-top: 0 !important;
          }

          .post-detail-mobile-action-row {
            height: 42px !important;
            margin-top: 8px !important;
            margin-left: -16px !important;
            margin-right: -16px !important;
            padding: 0 16px 7px !important;
            border-top: 0 !important;
            border-bottom: 1px solid hsl(var(--border) / 0.62) !important;
          }

          .post-detail-mobile-action-hit,
          .post-detail-mobile-reply-count,
          .post-detail-mobile-plus-button,
          .post-detail-mobile-share-button {
            display: inline-flex !important;
            min-width: 46px !important;
            height: 32px !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 6px !important;
            padding: 0 8px !important;
            border-radius: 9999px !important;
            font-size: 15px !important;
            line-height: 1 !important;
          }

          .post-detail-mobile-action-hit > *,
          .post-detail-mobile-action-hit button,
          .post-detail-mobile-reply-count > *,
          .post-detail-mobile-plus-button > *,
          .post-detail-mobile-share-button > * {
            display: inline-flex !important;
            height: 32px !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 6px !important;
            padding-top: 0 !important;
            padding-bottom: 0 !important;
          }

          .post-detail-mobile-action-row svg {
            width: 20px !important;
            height: 20px !important;
          }

          .post-detail-mobile-action-row .tabular-nums,
          .post-detail-mobile-action-row span {
            font-size: 15px !important;
            line-height: 1 !important;
          }

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

      {isMobile && activePopupEmoji && (
        <div
          className="fixed inset-0 bg-transparent"
          style={{ zIndex: 50 }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setActivePopupEmoji(null);
          }}
          aria-hidden="true"
        />
      )}

      <button
        type="button"
        onClick={() => navigate(-1)}
        className={useMobileThreadLayout
          ? "post-detail-mobile-simple-back inline-flex items-center gap-1 text-sm font-bold text-muted-foreground transition hover:text-primary"
          : "inline-flex items-center gap-1 text-sm font-bold text-muted-foreground transition hover:text-primary"
        }
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
        <article className={useMobileThreadLayout
          ? "post-detail-mobile-article relative"
          : "rounded-3xl border border-border/60 bg-card p-6 shadow-soft relative"
        }>
          <div className="flex items-center justify-between">
            <div className={`flex items-center gap-3 ${useMobileThreadLayout ? 'post-detail-mobile-author-row' : ''}`}>
              <Link to={`/u/${data.author.username}`}>
                <Avatar className={useMobileThreadLayout ? "post-detail-mobile-avatar" : "h-12 w-12 border-2 border-primary/30"}>
                  <AvatarImage src={data.author.avatarUrl} alt={data.author.displayName} />
                  <AvatarFallback>{data.author.displayName.slice(0, 1)}</AvatarFallback>
                </Avatar>
              </Link>
              <div className="min-w-0">
                <Link to={`/u/${data.author.username}`} className="flex items-center gap-0.5 min-w-0 font-display font-bold hover:underline">
                  <span className={`truncate ${useMobileThreadLayout ? 'post-detail-mobile-name' : ''}`}>
                    {data.author.displayName}
                  </span>
                  {data.author.isOfficial && (
                    <img 
                      src={`${import.meta.env.BASE_URL}verified.png`}
                      alt="Official" 
                      className="h-4 w-4 shrink-0 transform translate-y-[0.5px]"
                      loading="eager"
                    />
                  )}
                </Link>
                <p className={`truncate text-xs text-muted-foreground ${useMobileThreadLayout ? 'post-detail-mobile-username' : ''}`}>
                  @{data.author.username}
                </p>
              </div>
            </div>

            {/* 限定公開ラベル（カード右上に配置） */}
            {data.visibility === 'following' && (
              <span className="text-[14px] font-bold text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-md whitespace-nowrap -translate-y-[30px]">
                限定公開
              </span>
            )}
          </div>

          {/* 加工した本文を表示（メンション・ハッシュタグ・URL処理を適用） */}
          {displayContent && (
            <p className={`mt-4 whitespace-pre-wrap break-words text-base leading-relaxed text-foreground ${useMobileThreadLayout ? 'post-detail-mobile-content' : ''}`}>
              {renderContentWithLinks(displayContent)}
            </p>
          )}

          {/* 画像読み込み失敗時のURL表示 */}
          {failedUrls.length > 0 && (
            <div className="mt-2 space-y-1">
              {failedUrls.map((url, idx) => (
                <div key={`failed-${idx}`}>
                  {renderTextWithUrls(url)}
                </div>
              ))}
            </div>
          )}

          {/* YouTube埋め込みを追加 */}
          {youtubeId && <YouTubeEmbed videoId={youtubeId} />}

          {singleImageUrl ? (
            <div className="mt-3 flex max-w-full justify-start" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="block max-w-full cursor-zoom-in overflow-hidden rounded-2xl border border-border/50 bg-black/[0.025] text-left shadow-none dark:bg-white/[0.035]"
                style={getSingleImageFrameStyle()}
                onClick={(e) => handleImageClick(e, singleImageUrl)}
                aria-label="画像を拡大表示"
              >
                <img
                  src={singleImageUrl}
                  alt="投稿画像"
                  className="block select-none"
                  style={getSingleImageDisplayStyle()}
                  draggable={false}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    if (img.naturalWidth && img.naturalHeight) {
                      setSingleImageNaturalSize({
                        width: img.naturalWidth,
                        height: img.naturalHeight,
                      });
                    }
                  }}
                  onError={() => {
                    if (!failedUrls.includes(singleImageUrl)) {
                      setFailedUrls((prev) => [...prev, singleImageUrl]);
                    }
                  }}
                />
              </button>
            </div>
          ) : (
            <div 
              className="cursor-zoom-in"
              onClick={(e) => {
                const target = e.target as HTMLElement;
                if (target.tagName === 'IMG' && (target as HTMLImageElement).src) {
                  handleImageClick(e, (target as HTMLImageElement).src);
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
          )}

          {/* --- リアクションバッジエリア（本文・画像と日時表示の間に挿入） --- */}
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

          <p className={`mt-4 text-xs text-muted-foreground ${useMobileThreadLayout ? 'post-detail-mobile-meta' : ''}`} title={formatDate(data.createdAt)}>
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

          <div className={isMobile ? "mt-3 flex items-center gap-1 relative h-9 post-detail-mobile-action-row" : "mt-3 flex items-center gap-1 border-t border-border/60 pt-3 relative h-9"}>
            <div onClick={(e) => e.stopPropagation()} className={`flex items-center h-full ${isMobile ? 'post-detail-mobile-action-hit' : ''}`}>
              <LikeButton 
                postId={data.id} 
                liked={data.likedByMe} 
                count={data.likesCount}
              />
            </div>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm text-muted-foreground ${isMobile ? 'post-detail-mobile-reply-count' : ''}`}>
              <MessageCircle className="h-5 w-5" />
              <span className="font-bold tabular-nums">{formatDisplayCount(data.commentsCount)}</span>
            </span>

            {/* --- プラスボタンエリア --- */}
            <div className="relative inline-flex items-center h-full" onClick={(e) => e.stopPropagation()}>
              <button
                ref={buttonRef}
                onClick={() => setShowPicker(!showPicker)}
                className={`inline-flex items-center justify-center p-1.5 rounded-full transition-colors hover:text-accent h-8 w-8 origin-center ${isMobile ? 'post-detail-mobile-plus-button' : ''} ${
                  showPicker ? 'text-accent bg-accent/10' : 'text-muted-foreground'
                }`}
              >
                <Plus className="h-5 w-5" />
              </button>

              {showPicker && (
                <>
                  {isMobile && typeof document !== 'undefined' ? createPortal(
                    <>
                      {/* コメント欄のピッカーと同じく body 直下に出して、親の backdrop/transform の影響を受けないようにする */}
                      <div
                        className="fixed inset-0 bg-transparent"
                        style={{ zIndex: 2147483646 }}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setShowPicker(false);
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      />
                      <div
                        ref={pickerPanelRef}
                        className="fixed left-1/2 w-[92vw] max-w-[340px] h-[430px] rounded-[24px] border border-border/80 bg-white dark:bg-[#1e222b] shadow-2xl p-4 animate-slide-up-mobile overflow-y-auto overflow-x-hidden touch-pan-y"
                        style={{
                          bottom: 'calc(76px + env(safe-area-inset-bottom))',
                          zIndex: 2147483647,
                          transform: 'translateX(-50%)',
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
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
                    </>,
                    document.body
                  ) : (
                    <>
                      <div className="fixed inset-0 bg-transparent z-[9998]" onClick={() => setShowPicker(false)} />
                      {/* =========================================================================
                         【PC専用ポップアップ：バー全体をスクロール対応化・縦幅 h-[280px]】
                         ========================================================================= */}
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

                      {/* 検索バー（PC版のみ最下部に固定表示されますが、ポップアップ全体をスクロールしてアクセス可能です） */}
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
                    </>
                  )}
                </>
              )}
            </div>

            {/* --- 共有ボタンエリア --- */}
            <div className="relative ml-auto inline-flex items-center h-full shrink-0" onClick={(e) => e.stopPropagation()}>
              <button
                ref={shareButtonRef}
                onClick={handleShareButtonClick}
                aria-label="ポストを共有"
                className={`inline-flex items-center justify-center p-1.5 rounded-full transition-colors hover:text-accent h-8 w-8 origin-center ${isMobile ? 'post-detail-mobile-share-button' : ''} ${
                  showShareMenu ? 'text-accent bg-accent/10' : 'text-muted-foreground'
                }`}
              >
                <Upload className="h-5 w-5" />
              </button>

              {showShareMenu && typeof document !== 'undefined' && createPortal(
                <>
                  <div
                    className="fixed inset-0 bg-transparent"
                    style={{ zIndex: 2147483646 }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      closeShareMenu();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  />
                  <div
                    ref={shareMenuRef}
                    className="fixed w-[min(calc(100vw-16px),16rem)] rounded-xl border border-border bg-card p-1 shadow-lg overflow-hidden animate-in fade-in zoom-in duration-100"
                    style={{
                      top: shareMenuPosition?.top ?? 0,
                      right: shareMenuPosition?.right ?? 8,
                      zIndex: 2147483647,
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={handleOpenLimeDropPanel}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted transition-colors"
                    >
                      <Send className="h-4 w-4 shrink-0" />
                      <span>LimeDropで送信</span>
                    </button>

                    <button
                      onClick={handleCopyPostLink}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted transition-colors"
                    >
                      <LinkIcon className="h-4 w-4 shrink-0" />
                      <span>{shareFeedback ?? 'リンクをコピー'}</span>
                    </button>

                    <button
                      onClick={handleNativePostShare}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-foreground hover:bg-muted transition-colors"
                    >
                      <Upload className="h-4 w-4 shrink-0" />
                      <span>その他の方法でポストを送信</span>
                    </button>
                  </div>
                </>,
                document.body
              )}
            </div>

          </div>
        </article>
      )}

      {data && (
        <>
          {!useMobileThreadLayout && (
            <div>
              <CommentForm postId={data.id} variant="default" />
            </div>
          )}
          <div className={useMobileThreadLayout ? "post-detail-mobile-comments-shell" : ""}>
            {!useMobileThreadLayout && (
              <h2 className="mb-3 font-display text-base font-bold text-foreground">コメント</h2>
            )}
            <CommentList postId={data.id} mobileFlat={useMobileThreadLayout} />
          </div>
        </>
      )}

      {showLimeDropPanel && data && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          style={{ zIndex: 2147483647 }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              handleCloseLimeDropPanel();
            }
          }}
        >
          <div
            ref={limeDropPanelRef}
            className="w-full max-w-[520px] overflow-hidden rounded-t-[28px] border border-border bg-card shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 sm:rounded-[28px]"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-border/70 px-5 py-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Send className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-muted-foreground">LimeDrop</p>
                <h2 className="truncate text-lg font-black text-foreground">ポストを共有</h2>
              </div>
              <button
                type="button"
                onClick={handleCloseLimeDropPanel}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-muted/80"
                aria-label="LimeDropを閉じる"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-5 py-4">
              <div className="mb-4 rounded-2xl border border-border/70 bg-muted/35 px-4 py-3">
                <p className="line-clamp-2 text-sm font-medium leading-relaxed text-foreground">
                  {getPostShareText()}
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {getPostShareUrl()}
                </p>
              </div>

              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-black text-foreground">人</h3>
                {limeDropLoading && (
                  <span className="text-xs font-bold text-muted-foreground">読み込み中...</span>
                )}
              </div>

              {limeDropFeedback && (
                <div className="mb-3 rounded-xl bg-primary/10 px-3 py-2 text-sm font-bold text-primary">
                  {limeDropFeedback}
                </div>
              )}

              {!limeDropLoading && limeDropTargets.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center">
                  <p className="text-sm font-bold text-foreground">送信できるユーザーがいません</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    LimeDropは相互フォロー中のユーザーにだけ送信できます。
                  </p>
                </div>
              )}

              {limeDropTargets.length > 0 && (
                <div className="grid max-h-[320px] grid-cols-3 gap-3 overflow-y-auto pb-1 sm:grid-cols-4">
                  {limeDropTargets.map((target) => {
                    const isSending = limeDropSendingUserId === target.id;

                    return (
                      <button
                        key={target.id}
                        type="button"
                        disabled={Boolean(limeDropSendingUserId)}
                        onClick={() => handleSendLimeDrop(target)}
                        className="flex min-w-0 flex-col items-center rounded-2xl px-2 py-3 text-center transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-70"
                      >
                        <Avatar className="h-14 w-14 border border-border">
                          <AvatarImage src={target.avatarUrl} alt={target.displayName} />
                          <AvatarFallback>{target.displayName.slice(0, 1)}</AvatarFallback>
                        </Avatar>
                        <span className="mt-2 w-full truncate text-xs font-black text-foreground">
                          {isSending ? '送信中...' : target.displayName}
                        </span>
                        <span className="mt-0.5 w-full truncate text-[11px] text-muted-foreground">
                          @{target.username}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
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
                  count={data.likesCount}
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
    </>
  );
}
