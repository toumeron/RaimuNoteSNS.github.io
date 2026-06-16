import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MessageCircle, X, Plus } from 'lucide-react'; // Plusを追加
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

function getRelativeLuminance(r: number, g: number, b: number) {
  const [rs, gs, bs] = [r, g, b].map((value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function getTimelineThemeFromImageStats({
  averageLuminance,
  medianLuminance,
  lowerQuartileLuminance,
  brightRatio,
  darkRatio,
  veryDarkRatio,
}: {
  averageLuminance: number;
  medianLuminance: number;
  lowerQuartileLuminance: number;
  brightRatio: number;
  darkRatio: number;
  veryDarkRatio: number;
}): 'light' | 'dark' {
  const clearlyLightBackground =
    lowerQuartileLuminance >= 0.58 ||
    (medianLuminance >= 0.70 && darkRatio <= 0.18) ||
    (averageLuminance >= 0.68 && brightRatio >= 0.50 && darkRatio <= 0.24 && veryDarkRatio <= 0.08);

  return clearlyLightBackground ? 'light' : 'dark';
}

export default function PostDetail() {
  const { id = '' } = useParams();
  const { data, isLoading, isError } = usePost(id);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null); // 拡大用
  const [failedUrls, setFailedUrls] = useState<string[]>([]); // 読み込み失敗URL管理
  const navigate = useNavigate();
  const [timelineBackgroundUrl, setTimelineBackgroundUrl] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('lime_timeline_background_url') || null;
  });
  const [timelineTheme, setTimelineTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'dark';
    return localStorage.getItem('lime_timeline_visual_theme') === 'light' ? 'light' : 'dark';
  });

  // --- カスタム絵文字・リアクション用ステート群 ---
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([]);
  const [reactions, setReactions] = useState<ReactionGroup[]>([]);
  const [activePopupEmoji, setActivePopupEmoji] = useState<string | null>(null);
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  const [showPicker, setShowPicker] = useState(false); // ピッカー表示
  const [searchQuery, setSearchQuery] = useState(''); // 絵文字検索
  const [isEmojisOpen, setIsEmojisOpen] = useState(true); // アコーディオン
  
  // スマホ・PC判定用
  const [isMobile, setIsMobile] = useState(false);
  const [initialMobileBackgroundFrame] = useState(() => {
    if (typeof window === 'undefined') {
      return { width: 0, height: 0 };
    }

    return {
      width: Math.ceil(window.innerWidth),
      height: Math.ceil(window.innerHeight),
    };
  });

  // --- 画像再現エフェクト用のステート ---
  const [activeRings, setActiveRings] = useState<ReplicatedRing[]>([]);
  const [activeDots, setActiveDots] = useState<ReplicatedDot[]>([]);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const pickerPanelRef = useRef<HTMLDivElement>(null);
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


  useEffect(() => {
    let cancelled = false;

    const applyLocalBackground = () => {
      const storedUrl = localStorage.getItem('lime_timeline_background_url');
      const storedTheme = localStorage.getItem('lime_timeline_visual_theme');

      setTimelineBackgroundUrl(storedUrl || null);
      if (storedTheme === 'light' || storedTheme === 'dark') {
        setTimelineTheme(storedTheme);
      }
    };

    const fetchTimelineBackground = async () => {
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;

        const currentUser = authData.user;
        if (!currentUser) {
          if (!cancelled) applyLocalBackground();
          return;
        }

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('timeline_background_url')
          .eq('id', currentUser.id)
          .maybeSingle();

        if (error) throw error;

        if (!cancelled) {
          const url = (profile?.timeline_background_url as string | null) ?? null;
          setTimelineBackgroundUrl(url);

          if (url) {
            localStorage.setItem('lime_timeline_background_url', url);
          } else {
            localStorage.removeItem('lime_timeline_background_url');
          }
        }
      } catch (err) {
        console.error('Fetch post detail timeline background error:', err);
        if (!cancelled) applyLocalBackground();
      }
    };

    const handleBackgroundChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string }>).detail;
      setTimelineBackgroundUrl(detail?.url || null);
    };

    const handleVisualThemeChanged = (event: Event) => {
      const detail = (event as CustomEvent<{
        theme?: 'light' | 'dark';
        hasTimelineBackground?: boolean;
        url?: string;
      }>).detail;

      if (detail?.theme === 'light' || detail?.theme === 'dark') {
        setTimelineTheme(detail.theme);
      }

      if (typeof detail?.hasTimelineBackground === 'boolean') {
        setTimelineBackgroundUrl(detail.hasTimelineBackground ? detail.url || localStorage.getItem('lime_timeline_background_url') : null);
      }
    };

    fetchTimelineBackground();

    window.addEventListener('timeline-background-changed', handleBackgroundChanged as EventListener);
    window.addEventListener('timeline-visual-theme-changed', handleVisualThemeChanged as EventListener);

    let backgroundChannel: BroadcastChannel | null = null;
    let visualThemeChannel: BroadcastChannel | null = null;

    if ('BroadcastChannel' in window) {
      backgroundChannel = new BroadcastChannel('timeline-background');
      backgroundChannel.onmessage = (event) => {
        setTimelineBackgroundUrl(event.data?.url || null);
      };

      visualThemeChannel = new BroadcastChannel('timeline-visual-theme');
      visualThemeChannel.onmessage = (event) => {
        if (event.data?.theme === 'light' || event.data?.theme === 'dark') {
          setTimelineTheme(event.data.theme);
        }
        if (typeof event.data?.hasTimelineBackground === 'boolean') {
          setTimelineBackgroundUrl(event.data.hasTimelineBackground ? event.data.url || localStorage.getItem('lime_timeline_background_url') : null);
        }
      };
    }

    return () => {
      cancelled = true;
      window.removeEventListener('timeline-background-changed', handleBackgroundChanged as EventListener);
      window.removeEventListener('timeline-visual-theme-changed', handleVisualThemeChanged as EventListener);
      backgroundChannel?.close();
      visualThemeChannel?.close();
    };
  }, []);

  useEffect(() => {
    const previous = {
      backgroundImage: document.body.style.backgroundImage,
      backgroundSize: document.body.style.backgroundSize,
      backgroundPosition: document.body.style.backgroundPosition,
      backgroundRepeat: document.body.style.backgroundRepeat,
      backgroundAttachment: document.body.style.backgroundAttachment,
    };

    if (timelineBackgroundUrl) {
      const safeBackgroundUrl = `url("${timelineBackgroundUrl}")`;

      if (isMobile) {
        // iPhone / モバイルでは body background fixed が不安定なので、JSX 側の fixed レイヤーで表示する。
        document.body.style.backgroundImage = 'none';
        document.body.style.backgroundSize = '';
        document.body.style.backgroundPosition = '';
        document.body.style.backgroundRepeat = '';
        document.body.style.backgroundAttachment = '';
      } else {
        document.body.style.backgroundImage = safeBackgroundUrl;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
        document.body.style.backgroundRepeat = 'no-repeat';
        document.body.style.backgroundAttachment = 'fixed';
      }
    }

    return () => {
      document.body.style.backgroundImage = previous.backgroundImage;
      document.body.style.backgroundSize = previous.backgroundSize;
      document.body.style.backgroundPosition = previous.backgroundPosition;
      document.body.style.backgroundRepeat = previous.backgroundRepeat;
      document.body.style.backgroundAttachment = previous.backgroundAttachment;
    };
  }, [timelineBackgroundUrl, isMobile]);

  useEffect(() => {
    if (!timelineBackgroundUrl) {
      setTimelineTheme('dark');
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = timelineBackgroundUrl;

    img.onload = () => {
      if (cancelled || !img.naturalWidth || !img.naturalHeight) return;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        setTimelineTheme('dark');
        return;
      }

      canvas.width = 48;
      canvas.height = 48;

      try {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const luminances: number[] = [];
        let luminanceSum = 0;
        let count = 0;
        let brightPixels = 0;
        let darkPixels = 0;
        let veryDarkPixels = 0;

        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3] / 255;
          if (alpha < 0.1) continue;

          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const lum = getRelativeLuminance(r, g, b);

          luminances.push(lum);
          luminanceSum += lum;
          count += 1;

          if (lum >= 0.68) brightPixels += 1;
          if (lum <= 0.30) darkPixels += 1;
          if (lum <= 0.16) veryDarkPixels += 1;
        }

        if (!cancelled) {
          luminances.sort((a, b) => a - b);

          const pick = (ratio: number) => {
            if (luminances.length === 0) return 0.5;
            const index = Math.min(luminances.length - 1, Math.max(0, Math.floor((luminances.length - 1) * ratio)));
            return luminances[index];
          };

          const averageLuminance = count > 0 ? luminanceSum / count : 0.5;
          const medianLuminance = pick(0.5);
          const lowerQuartileLuminance = pick(0.25);
          const brightRatio = count > 0 ? brightPixels / count : 0;
          const darkRatio = count > 0 ? darkPixels / count : 0;
          const veryDarkRatio = count > 0 ? veryDarkPixels / count : 0;

          setTimelineTheme(
            getTimelineThemeFromImageStats({
              averageLuminance,
              medianLuminance,
              lowerQuartileLuminance,
              brightRatio,
              darkRatio,
              veryDarkRatio,
            })
          );
        }
      } catch (error) {
        console.warn('Post detail luminance sampling failed:', error);
        if (!cancelled) setTimelineTheme('dark');
      }
    };

    img.onerror = () => {
      if (!cancelled) setTimelineTheme('dark');
    };

    return () => {
      cancelled = true;
    };
  }, [timelineBackgroundUrl]);

  useEffect(() => {
    const hasBackground = Boolean(timelineBackgroundUrl);
    const payload = {
      theme: timelineTheme,
      hasTimelineBackground: hasBackground,
      url: timelineBackgroundUrl ?? '',
    };

    localStorage.setItem('lime_timeline_visual_theme', timelineTheme);
    localStorage.setItem('lime_timeline_background_enabled', String(hasBackground));

    if (timelineBackgroundUrl) {
      localStorage.setItem('lime_timeline_background_url', timelineBackgroundUrl);
    } else {
      localStorage.removeItem('lime_timeline_background_url');
    }

    window.dispatchEvent(
      new CustomEvent('timeline-visual-theme-changed', {
        detail: payload,
      })
    );

    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel('timeline-visual-theme');
      channel.postMessage(payload);
      channel.close();
    }
  }, [timelineBackgroundUrl, timelineTheme]);

  // 背景ありの投稿詳細画面では、body直下に出るHoverCard等にもテーマを渡す。
  useEffect(() => {
    const hasBackground = Boolean(timelineBackgroundUrl);

    document.body.classList.toggle('post-detail-timeline-bg-active', hasBackground);
    document.body.classList.toggle('post-detail-timeline-bg-dark', hasBackground && timelineTheme === 'dark');
    document.body.classList.toggle('post-detail-timeline-bg-light', hasBackground && timelineTheme === 'light');

    return () => {
      document.body.classList.remove(
        'post-detail-timeline-bg-active',
        'post-detail-timeline-bg-dark',
        'post-detail-timeline-bg-light'
      );
    };
  }, [timelineBackgroundUrl, timelineTheme]);

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

  // YouTube IDの抽出と本文の加工（YouTube URLと画像URLを除去）
  const youtubeId = data ? getYouTubeId(data.content) : null;
  const displayContent = (data && (youtubeId || extractedImageUrls.length > 0))
    ? data.content
        .replace(/(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/(watch\?v=|embed\/|shorts\/)?([a-zA-Z0-9_-]{11})([^?\s\n]*)?(\S+)?/g, '')
        .replace(imageRegex, '')
        .trim()
    : data?.content;

  const hasTimelineBackground = Boolean(timelineBackgroundUrl);

  return (
    <>
      {hasTimelineBackground && isMobile && timelineBackgroundUrl && (
        <div
          className="post-detail-mobile-background-layer pointer-events-none fixed left-0 top-0 z-0 overflow-hidden bg-background"
          style={{
            width: initialMobileBackgroundFrame.width ? `${initialMobileBackgroundFrame.width}px` : '100vw',
            height: initialMobileBackgroundFrame.height ? `${initialMobileBackgroundFrame.height}px` : '100vh',
          }}
          aria-hidden="true"
        >
          <img
            src={timelineBackgroundUrl}
            alt=""
            className="absolute left-0 top-0 h-full w-full object-cover"
            style={{ objectPosition: 'center center' }}
            draggable={false}
          />
          <div
            className={`absolute inset-0 ${timelineTheme === 'dark' ? 'bg-black/8' : 'bg-white/0'}`}
          />
        </div>
      )}
      <div
        className={`relative z-[1] space-y-5 ${
          hasTimelineBackground
            ? timelineTheme === 'dark'
              ? 'pt-4 sm:pt-6 timeline-theme-scope timeline-theme-dark post-detail-background-mode'
              : 'pt-4 sm:pt-6 timeline-theme-scope timeline-theme-light post-detail-background-mode'
            : ''
        }`}
      >
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

        .post-detail-mobile-background-layer { max-width: 100vw !important; }

        .timeline-theme-scope { color: hsl(var(--foreground)); }

        .timeline-theme-dark {
          --background: 222 47% 7%;
          --foreground: 210 40% 98%;
          --card: 222 36% 8%;
          --card-foreground: 210 40% 98%;
          --popover: 222 36% 9%;
          --popover-foreground: 210 40% 98%;
          --muted: 217 28% 17%;
          --muted-foreground: 215 24% 82%;
          --border: 217 18% 28%;
          --timeline-link: 330 96% 66%;
        }

        .timeline-theme-light {
          --background: 0 0% 100%;
          --foreground: 24 12% 11%;
          --card: 0 0% 100%;
          --card-foreground: 24 12% 11%;
          --popover: 0 0% 100%;
          --popover-foreground: 24 12% 11%;
          --muted: 24 16% 92%;
          --muted-foreground: 24 8% 42%;
          --border: 24 10% 82%;
          --timeline-link: 330 88% 48%;
        }

        .post-detail-background-mode .text-pink-500 { color: hsl(var(--timeline-link)) !important; }

        .post-detail-glass-card,
        .post-detail-glass-section {
          color: hsl(var(--foreground));
          -webkit-backdrop-filter: blur(24px) saturate(165%);
          backdrop-filter: blur(24px) saturate(165%);
          box-shadow: none !important;
        }

        .timeline-theme-dark .post-detail-glass-card,
        .timeline-theme-dark .post-detail-glass-section {
          background: linear-gradient(135deg, rgba(12, 16, 28, 0.72), rgba(34, 24, 32, 0.66)) !important;
          border-color: rgba(255, 255, 255, 0.045) !important;
          color: rgba(255, 255, 255, 0.96) !important;
        }

        .timeline-theme-light .post-detail-glass-card,
        .timeline-theme-light .post-detail-glass-section {
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.62), rgba(255, 255, 255, 0.54)) !important;
          border-color: rgba(40, 30, 25, 0.045) !important;
          color: rgba(24, 22, 20, 0.96) !important;
        }

        .post-detail-back-button {
          border: 1px solid hsl(var(--border) / 0.08);
          -webkit-backdrop-filter: blur(20px) saturate(160%);
          backdrop-filter: blur(20px) saturate(160%);
        }

        .timeline-theme-dark .post-detail-back-button {
          background: rgba(12, 16, 28, 0.62) !important;
          color: rgba(255, 255, 255, 0.90) !important;
          border-color: rgba(255, 255, 255, 0.06) !important;
        }

        .timeline-theme-light .post-detail-back-button {
          background: rgba(255, 255, 255, 0.62) !important;
          color: rgba(24, 22, 20, 0.84) !important;
          border-color: rgba(24, 22, 20, 0.06) !important;
        }

        .post-detail-background-mode .text-foreground,
        .post-detail-background-mode p {
          color: hsl(var(--foreground) / 0.96) !important;
          text-shadow: none !important;
        }

        .post-detail-background-mode .text-muted-foreground,
        .post-detail-background-mode [class*="text-muted-foreground"] {
          color: hsl(var(--muted-foreground) / 0.90) !important;
          text-shadow: none !important;
        }

        .timeline-theme-dark .post-detail-picker-panel {
          background: rgba(18, 21, 30, 0.96) !important;
          color: rgba(255, 255, 255, 0.96) !important;
          border-color: rgba(255, 255, 255, 0.10) !important;
        }

        .timeline-theme-light .post-detail-picker-panel {
          background: rgba(255, 255, 255, 0.96) !important;
          color: rgba(24, 22, 20, 0.96) !important;
          border-color: rgba(24, 22, 20, 0.10) !important;
        }

        /*
          背景あり時のコメント周り専用。
          CommentForm / CommentList 側が元々カード枠を持っているので、
          PostDetail 側でさらに大きな枠を重ねない。
        */
        .post-detail-comment-form-shell {
          color: hsl(var(--foreground));
        }

        .post-detail-comment-form-shell > * {
          -webkit-backdrop-filter: blur(24px) saturate(165%);
          backdrop-filter: blur(24px) saturate(165%);
          box-shadow: none !important;
        }

        .timeline-theme-dark .post-detail-comment-form-shell > * {
          background: linear-gradient(135deg, rgba(12, 16, 28, 0.72), rgba(34, 24, 32, 0.66)) !important;
          border-color: rgba(255, 255, 255, 0.045) !important;
          color: rgba(255, 255, 255, 0.96) !important;
        }

        .timeline-theme-light .post-detail-comment-form-shell > * {
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.62), rgba(255, 255, 255, 0.54)) !important;
          border-color: rgba(40, 30, 25, 0.045) !important;
          color: rgba(24, 22, 20, 0.96) !important;
        }

        .post-detail-comments-shell {
          color: hsl(var(--foreground));
        }

        /*
          背景あり時は、コメント一覧の外側にはカード枠を作らない。
          CommentList / 空状態 / 各コメントが持つ既存カードだけをテーマに合わせて薄いガラスにする。
        */
        .post-detail-comments-shell [class*="rounded-3xl"][class*="border"],
        .post-detail-comments-shell [class*="rounded-2xl"][class*="border"],
        .post-detail-comments-shell [class*="rounded-xl"][class*="border"] {
          -webkit-backdrop-filter: blur(22px) saturate(160%);
          backdrop-filter: blur(22px) saturate(160%);
          box-shadow: none !important;
        }

        .timeline-theme-dark .post-detail-comments-shell [class*="rounded-3xl"][class*="border"],
        .timeline-theme-dark .post-detail-comments-shell [class*="rounded-2xl"][class*="border"],
        .timeline-theme-dark .post-detail-comments-shell [class*="rounded-xl"][class*="border"] {
          background: rgba(5, 8, 16, 0.46) !important;
          border-color: rgba(255, 255, 255, 0.050) !important;
          color: rgba(255, 255, 255, 0.96) !important;
        }

        .timeline-theme-light .post-detail-comments-shell [class*="rounded-3xl"][class*="border"],
        .timeline-theme-light .post-detail-comments-shell [class*="rounded-2xl"][class*="border"],
        .timeline-theme-light .post-detail-comments-shell [class*="rounded-xl"][class*="border"] {
          background: rgba(255, 255, 255, 0.50) !important;
          border-color: rgba(24, 22, 20, 0.055) !important;
          color: rgba(24, 22, 20, 0.96) !important;
        }

        /*
          CommentForm / CommentList 内の bg-card, bg-muted, border-border, dark:* は
          Feed側のタイムラインテーマ判定に従わせる。
        */
        .post-detail-background-mode .bg-card,
        .post-detail-background-mode [class*="bg-card"] {
          background-color: hsl(var(--card) / 0.48) !important;
        }

        .post-detail-background-mode .bg-muted,
        .post-detail-background-mode [class*="bg-muted"] {
          background-color: hsl(var(--muted) / 0.34) !important;
        }

        .post-detail-background-mode .border-border,
        .post-detail-background-mode [class*="border-border"] {
          border-color: hsl(var(--border) / 0.075) !important;
        }

        .timeline-theme-dark.post-detail-background-mode .border-t,
        .timeline-theme-dark.post-detail-background-mode [class*="border-t"] {
          border-color: rgba(255, 255, 255, 0.065) !important;
        }

        .timeline-theme-light.post-detail-background-mode .border-t,
        .timeline-theme-light.post-detail-background-mode [class*="border-t"] {
          border-color: rgba(24, 22, 20, 0.065) !important;
        }

        .timeline-theme-dark.post-detail-background-mode input,
        .timeline-theme-dark.post-detail-background-mode textarea {
          background: rgba(5, 8, 16, 0.46) !important;
          color: rgba(255, 255, 255, 0.96) !important;
          border-color: rgba(255, 255, 255, 0.070) !important;
        }

        .timeline-theme-light.post-detail-background-mode input,
        .timeline-theme-light.post-detail-background-mode textarea {
          background: rgba(255, 255, 255, 0.56) !important;
          color: rgba(24, 22, 20, 0.96) !important;
          border-color: rgba(24, 22, 20, 0.075) !important;
        }

        .timeline-theme-dark.post-detail-background-mode input::placeholder,
        .timeline-theme-dark.post-detail-background-mode textarea::placeholder {
          color: rgba(226, 232, 240, 0.58) !important;
        }

        .timeline-theme-light.post-detail-background-mode input::placeholder,
        .timeline-theme-light.post-detail-background-mode textarea::placeholder {
          color: rgba(86, 74, 66, 0.54) !important;
        }


        /*
          モバイル背景あり時のコメント欄だけ、一枚の背景を持たせる。
          投稿本体の透明度は前のまま維持し、CommentForm / CommentList の内側背景が
          透明になっても、外側の一枚で読めるようにする。
        */
        @media (max-width: 639px) {
          .post-detail-background-mode .post-detail-comment-form-shell,
          .post-detail-background-mode .post-detail-comments-shell {
            position: relative;
            border-radius: 28px;
            border: 1px solid hsl(var(--border) / 0.065);
            padding: 16px;
            color: hsl(var(--foreground));
            -webkit-backdrop-filter: blur(24px) saturate(165%);
            backdrop-filter: blur(24px) saturate(165%);
            box-shadow: none !important;
          }

          .timeline-theme-dark.post-detail-background-mode .post-detail-comment-form-shell,
          .timeline-theme-dark.post-detail-background-mode .post-detail-comments-shell {
            background: linear-gradient(135deg, rgba(12, 16, 28, 0.72), rgba(34, 24, 32, 0.66)) !important;
            border-color: rgba(255, 255, 255, 0.045) !important;
          }

          .timeline-theme-light.post-detail-background-mode .post-detail-comment-form-shell,
          .timeline-theme-light.post-detail-background-mode .post-detail-comments-shell {
            background: linear-gradient(135deg, rgba(255, 255, 255, 0.62), rgba(255, 255, 255, 0.54)) !important;
            border-color: rgba(40, 30, 25, 0.045) !important;
          }

          .post-detail-background-mode .post-detail-comment-form-shell > *,
          .post-detail-background-mode .post-detail-comments-shell > [class*="rounded-3xl"][class*="border"],
          .post-detail-background-mode .post-detail-comments-shell > [class*="rounded-2xl"][class*="border"],
          .post-detail-background-mode .post-detail-comments-shell > [class*="rounded-xl"][class*="border"] {
            background: transparent !important;
            border-color: transparent !important;
            box-shadow: none !important;
            -webkit-backdrop-filter: none !important;
            backdrop-filter: none !important;
          }

          .post-detail-background-mode .post-detail-comment-form-shell input,
          .post-detail-background-mode .post-detail-comment-form-shell textarea,
          .post-detail-background-mode .post-detail-comments-shell input,
          .post-detail-background-mode .post-detail-comments-shell textarea {
            -webkit-backdrop-filter: blur(18px) saturate(150%) !important;
            backdrop-filter: blur(18px) saturate(150%) !important;
          }

          .timeline-theme-dark.post-detail-background-mode .post-detail-comment-form-shell input,
          .timeline-theme-dark.post-detail-background-mode .post-detail-comment-form-shell textarea,
          .timeline-theme-dark.post-detail-background-mode .post-detail-comments-shell input,
          .timeline-theme-dark.post-detail-background-mode .post-detail-comments-shell textarea {
            background: rgba(5, 8, 16, 0.46) !important;
            border-color: rgba(255, 255, 255, 0.070) !important;
          }

          .timeline-theme-light.post-detail-background-mode .post-detail-comment-form-shell input,
          .timeline-theme-light.post-detail-background-mode .post-detail-comment-form-shell textarea,
          .timeline-theme-light.post-detail-background-mode .post-detail-comments-shell input,
          .timeline-theme-light.post-detail-background-mode .post-detail-comments-shell textarea {
            background: rgba(255, 255, 255, 0.56) !important;
            border-color: rgba(24, 22, 20, 0.075) !important;
          }
        }

        @media (max-width: 639px) {
          /* 背景ありのモバイルだけ、投稿本体をPC版と同じカード風に戻す。 */
          .post-detail-background-mode .post-detail-main-card {
            width: calc(100vw - 32px);
            max-width: 600px;
            margin-left: auto;
            margin-right: auto;
            border-radius: 28px;
            box-sizing: border-box;
            overflow: hidden;
            -webkit-backdrop-filter: blur(24px) saturate(165%);
            backdrop-filter: blur(24px) saturate(165%);
          }

          .timeline-theme-dark.post-detail-background-mode .post-detail-main-card {
            background: linear-gradient(135deg, rgba(12, 16, 28, 0.72), rgba(34, 24, 32, 0.66)) !important;
            border-color: rgba(255, 255, 255, 0.045) !important;
          }

          .timeline-theme-light.post-detail-background-mode .post-detail-main-card {
            background: linear-gradient(135deg, rgba(255, 255, 255, 0.62), rgba(255, 255, 255, 0.54)) !important;
            border-color: rgba(40, 30, 25, 0.045) !important;
          }

          /* コメント内の削除などの選択メニューは透明化しない。 */
          .post-detail-background-mode .post-detail-comments-shell [role="menu"],
          .post-detail-background-mode .post-detail-comments-shell [data-radix-menu-content],
          .post-detail-background-mode .post-detail-comments-shell [data-radix-dropdown-menu-content],
          .post-detail-background-mode .post-detail-comments-shell [class*="absolute"][class*="rounded"][class*="border"],
          .post-detail-background-mode .post-detail-comments-shell [class*="fixed"][class*="rounded"][class*="border"] {
            -webkit-backdrop-filter: blur(24px) saturate(170%) !important;
            backdrop-filter: blur(24px) saturate(170%) !important;
            box-shadow: 0 18px 48px rgba(0, 0, 0, 0.24) !important;
          }

          .timeline-theme-dark.post-detail-background-mode .post-detail-comments-shell [role="menu"],
          .timeline-theme-dark.post-detail-background-mode .post-detail-comments-shell [data-radix-menu-content],
          .timeline-theme-dark.post-detail-background-mode .post-detail-comments-shell [data-radix-dropdown-menu-content],
          .timeline-theme-dark.post-detail-background-mode .post-detail-comments-shell [class*="absolute"][class*="rounded"][class*="border"],
          .timeline-theme-dark.post-detail-background-mode .post-detail-comments-shell [class*="fixed"][class*="rounded"][class*="border"] {
            background: rgba(12, 16, 28, 0.97) !important;
            border-color: rgba(255, 255, 255, 0.12) !important;
            color: rgba(255, 255, 255, 0.96) !important;
          }

          .timeline-theme-light.post-detail-background-mode .post-detail-comments-shell [role="menu"],
          .timeline-theme-light.post-detail-background-mode .post-detail-comments-shell [data-radix-menu-content],
          .timeline-theme-light.post-detail-background-mode .post-detail-comments-shell [data-radix-dropdown-menu-content],
          .timeline-theme-light.post-detail-background-mode .post-detail-comments-shell [class*="absolute"][class*="rounded"][class*="border"],
          .timeline-theme-light.post-detail-background-mode .post-detail-comments-shell [class*="fixed"][class*="rounded"][class*="border"] {
            background: rgba(255, 255, 255, 0.97) !important;
            border-color: rgba(24, 22, 20, 0.12) !important;
            color: rgba(24, 22, 20, 0.96) !important;
          }

          .post-detail-background-mode .post-detail-comments-shell .text-destructive,
          .post-detail-background-mode .post-detail-comments-shell [class*="text-destructive"] {
            color: rgb(255, 77, 86) !important;
          }
        }

        /* body直下に出るプロフィールHoverCard等も、投稿詳細の背景テーマに合わせる。 */
        body.post-detail-timeline-bg-active [data-radix-popper-content-wrapper] [data-side] {
          -webkit-backdrop-filter: blur(28px) saturate(175%) !important;
          backdrop-filter: blur(28px) saturate(175%) !important;
          box-shadow: 0 18px 50px rgba(0, 0, 0, 0.24) !important;
        }

        body.post-detail-timeline-bg-dark [data-radix-popper-content-wrapper] [data-side] {
          background: rgba(12, 16, 28, 0.98) !important;
          color: rgba(255, 255, 255, 0.96) !important;
          border-color: rgba(255, 255, 255, 0.10) !important;
        }

        body.post-detail-timeline-bg-light [data-radix-popper-content-wrapper] [data-side] {
          background: rgba(255, 255, 255, 0.98) !important;
          color: rgba(24, 22, 20, 0.96) !important;
          border-color: rgba(24, 22, 20, 0.10) !important;
        }

        body.post-detail-timeline-bg-dark [data-radix-popper-content-wrapper] [data-side] [class*="text-muted-foreground"] {
          color: rgba(226, 232, 240, 0.78) !important;
        }

        body.post-detail-timeline-bg-light [data-radix-popper-content-wrapper] [data-side] [class*="text-muted-foreground"] {
          color: rgba(86, 74, 66, 0.74) !important;
        }


        body.post-detail-timeline-bg-active [data-radix-popper-content-wrapper] [data-side] .text-destructive,
        body.post-detail-timeline-bg-active [data-radix-popper-content-wrapper] [data-side] [class*="text-destructive"] {
          color: rgb(255, 77, 86) !important;
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
        className={hasTimelineBackground
          ? "post-detail-back-button inline-flex items-center gap-1 rounded-full px-3 py-2 text-sm font-bold text-muted-foreground transition hover:text-primary"
          : "inline-flex items-center gap-1 text-sm font-bold text-muted-foreground transition hover:text-primary"
        }
      >
        <ArrowLeft className="h-4 w-4" /> 戻る
      </button>

      {isLoading && (
        <div className={hasTimelineBackground
          ? "post-detail-glass-card rounded-3xl border border-border/60 p-5 shadow-soft"
          : "rounded-3xl border border-border/60 bg-card p-5 shadow-soft"
        }>
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
        <div className={hasTimelineBackground
          ? "post-detail-glass-section rounded-3xl border border-destructive/40 p-6 text-center"
          : "rounded-3xl border border-destructive/40 bg-destructive/5 p-6 text-center"
        }>
          <p className="text-sm text-destructive">投稿の読み込みに失敗しました。</p>
        </div>
      )}

      {data === null && (
        <div className={hasTimelineBackground
          ? "post-detail-glass-section rounded-3xl border border-border/60 p-8 text-center text-muted-foreground"
          : "rounded-3xl border border-border/60 bg-card p-8 text-center text-muted-foreground"
        }>
          投稿が見つかりませんでした。
        </div>
      )}

      {data && (
        <article className={hasTimelineBackground
          ? "post-detail-glass-card post-detail-main-card rounded-3xl border border-border/60 p-6 shadow-soft relative"
          : "rounded-3xl border border-border/60 bg-card p-6 shadow-soft relative"
        }>
          <div className="flex items-center justify-between">
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

            {/* 限定公開ラベル（カード右上に配置） */}
            {data.visibility === 'following' && (
              <span className="text-[14px] font-bold text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-md whitespace-nowrap -translate-y-[30px]">
                限定公開
              </span>
            )}
          </div>

          {/* 加工した本文を表示（メンション・ハッシュタグ・URL処理を適用） */}
          {displayContent && (
            <p className="mt-4 whitespace-pre-wrap break-words text-base leading-relaxed text-foreground">
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

          <div className="mt-3 flex items-center gap-1 border-t border-border/60 pt-3 relative h-9">
            <div onClick={(e) => e.stopPropagation()} className="flex items-center h-full">
              <LikeButton 
                postId={data.id} 
                liked={data.likedByMe} 
                count={data.likesCount}
              />
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm text-muted-foreground">
              <MessageCircle className="h-5 w-5" />
              <span className="font-bold tabular-nums">{formatDisplayCount(data.commentsCount)}</span>
            </span>

            {/* --- プラスボタンエリア --- */}
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
                        className={`fixed left-1/2 w-[92vw] max-w-[340px] h-[430px] rounded-[24px] border border-border/80 bg-white dark:bg-[#1e222b] shadow-2xl p-4 animate-slide-up-mobile overflow-y-auto overflow-x-hidden touch-pan-y ${hasTimelineBackground ? 'post-detail-picker-panel' : ''}`}
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
                      className={`absolute bottom-full left-0 mb-2 w-[260px] h-[280px] rounded-[20px] border border-border/80 bg-white dark:bg-[#1e222b] shadow-2xl z-[9999] p-2.5 animate-zoom-in-pc overflow-y-auto overflow-x-hidden ${hasTimelineBackground ? 'post-detail-picker-panel' : ''}`}
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

          </div>
        </article>
      )}

      {data && (
        <>
          <div className={hasTimelineBackground ? "post-detail-comment-form-shell" : ""}>
            <CommentForm postId={data.id} />
          </div>
          <div className={hasTimelineBackground ? "post-detail-comments-shell" : ""}>
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