import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ImagePlus,
  Loader2,
  LogOut,
  Moon,
  Sun,
  Monitor,
  Sparkles,
  Check,
  Bot,
  MessageSquareText,
  Smile,
  Trash2,
  Upload,
  Crown,
  CreditCard,
  X,
  Plus,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/hooks/useAuth';
import { useUpdateProfile } from '@/hooks/useProfile';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { toast } from 'sonner';
import { useTheme } from 'next-themes';
import { Switch } from '@/components/ui/switch';
import { User } from '@/types';
import { supabase } from '@/lib/supabase';
import {
  getConfiguredBlueskyHandles,
  normalizeBlueskyHandle,
  saveConfiguredBlueskyHandles,
  getStoredBlueskySession,
  loginToBluesky,
  logoutFromBluesky,
  type BlueskySession,
} from '@/lib/bluesky';

const schema = z.object({
  displayName: z.string().trim().min(1, '表示名を入力してください').max(30, '30文字以内で入力してください'),
  bio: z.string().max(160, '自己紹介は160文字以内で入力してください'),
});

interface CustomEmoji {
  id: string;
  name: string;
  public_id: string;
  format: string;
  uploaded_by: string | null;
  created_at: string;
}

interface BlueskyProfileInfo {
  handle: string;
  displayName?: string;
  avatar?: string;
}

const BLUESKY_PUBLIC_PROFILE_API = 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile';

// Blueskyの本家プロフィールではなく、サイト内のユーザーページ（/u/handle）へ遷移させる
const getInternalProfilePath = (handle: string) => `/u/${handle}`;

const fetchBlueskyProfile = async (handle: string): Promise<BlueskyProfileInfo> => {
  try {
    const res = await fetch(`${BLUESKY_PUBLIC_PROFILE_API}?actor=${encodeURIComponent(handle)}`);
    if (!res.ok) {
      return { handle };
    }
    const data = await res.json();
    return {
      handle,
      displayName: data?.displayName || undefined,
      avatar: data?.avatar || undefined,
    };
  } catch (err) {
    console.error('Fetch Bluesky Profile Error:', err);
    return { handle };
  }
};

type ProfileImageCropTarget = 'avatar' | 'cover';

type ProfileCropOffset = { x: number; y: number };

const PROFILE_CROP_LIMIT = { min: 1, max: 3 };

interface ProfileImageCropperProps {
  src: string;
  target: ProfileImageCropTarget;
  onApply: (url: string) => void;
  onClose: () => void;
}

function ProfileImageCropper({ src, target, onApply, onClose }: ProfileImageCropperProps) {
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<ProfileCropOffset>({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const offsetRef = useRef<ProfileCropOffset>({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const dragRef = useRef({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0 });
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef({ active: false, startDistance: 0, startZoom: 1, startMidX: 0, startMidY: 0, baseX: 0, baseY: 0 });

  // 切り抜き画面は、完成後の比率をそのまま操作しやすいサイズで表示する。
  // アイコンは正方形、ヘッダーは3:1の横長。
  const outputSize = target === 'avatar'
    ? { width: 512, height: 512 }
    : { width: 1500, height: 500 };

  const isAvatar = target === 'avatar';

  const cropFrameStyle = isAvatar
    ? {
        width: 'min(86vw, 520px)',
        aspectRatio: '1 / 1',
        borderRadius: '0',
      }
    : {
        width: 'min(94vw, 960px)',
        aspectRatio: '3 / 1',
        borderRadius: '0.75rem',
      };

  const modalClassName = isAvatar
    ? 'flex w-[min(94vw,620px)] max-w-[620px] flex-col overflow-hidden rounded-2xl bg-card text-card-foreground shadow-2xl'
    : 'flex w-[min(96vw,1120px)] max-w-[1120px] flex-col overflow-hidden rounded-2xl bg-card text-card-foreground shadow-2xl';

  const cropAreaClassName = isAvatar
    ? 'flex min-h-0 flex-none items-center justify-center overflow-hidden bg-muted/20 px-3 py-4 sm:px-6 sm:py-6'
    : 'flex min-h-0 flex-none items-center justify-center overflow-hidden bg-muted/20 px-2 py-3 sm:px-5 sm:py-5';

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      imageRef.current = img;
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    img.onerror = () => {
      if (!cancelled) {
        toast.error('画像を読み込めませんでした');
        onClose();
      }
    };
    img.src = src;
    return () => { cancelled = true; };
  }, [onClose, src]);

  useEffect(() => {
    const update = () => {
      const rect = boxRef.current?.getBoundingClientRect();
      if (rect) setBoxSize({ width: rect.width, height: rect.height });
    };
    update();
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver !== 'undefined' && boxRef.current
      ? new ResizeObserver(update)
      : null;
    if (boxRef.current) observer?.observe(boxRef.current);
    return () => {
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, []);

  const clampOffset = useCallback((next: ProfileCropOffset, nextZoom = zoomRef.current) => {
    if (!imageSize.width || !imageSize.height || !boxSize.width || !boxSize.height) return next;
    const baseScale = Math.max(boxSize.width / imageSize.width, boxSize.height / imageSize.height);
    const scale = baseScale * nextZoom;
    const renderedWidth = imageSize.width * scale;
    const renderedHeight = imageSize.height * scale;
    const maxX = Math.max(0, (renderedWidth - boxSize.width) / 2);
    const maxY = Math.max(0, (renderedHeight - boxSize.height) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  }, [boxSize.height, boxSize.width, imageSize.height, imageSize.width]);

  const updateTransform = useCallback((nextZoom: number, nextOffset: ProfileCropOffset) => {
    const z = Math.min(PROFILE_CROP_LIMIT.max, Math.max(PROFILE_CROP_LIMIT.min, nextZoom));
    const o = clampOffset(nextOffset, z);
    zoomRef.current = z;
    offsetRef.current = o;
    setZoom(z);
    setOffset(o);
  }, [clampOffset]);

  const startGesture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const pointers = pointersRef.current;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2) {
      const [a, b] = Array.from(pointers.values());
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      pinchRef.current = {
        active: true,
        startDistance: distance,
        startZoom: zoomRef.current,
        startMidX: (a.x + b.x) / 2,
        startMidY: (a.y + b.y) / 2,
        baseX: offsetRef.current.x,
        baseY: offsetRef.current.y,
      };
      dragRef.current.active = false;
      return;
    }

    pinchRef.current.active = false;
    dragRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      baseX: offsetRef.current.x,
      baseY: offsetRef.current.y,
    };
  }, []);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const pointers = pointersRef.current;
      if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      if (pointers.size >= 2) {
        event.preventDefault();
        const [a, b] = Array.from(pointers.values());
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const pinch = pinchRef.current;
        if (!pinch.active) {
          pinchRef.current = {
            active: true,
            startDistance: distance,
            startZoom: zoomRef.current,
            startMidX: midX,
            startMidY: midY,
            baseX: offsetRef.current.x,
            baseY: offsetRef.current.y,
          };
          return;
        }
        const nextZoom = pinch.startZoom * distance / Math.max(1, pinch.startDistance);
        updateTransform(nextZoom, {
          x: pinch.baseX + midX - pinch.startMidX,
          y: pinch.baseY + midY - pinch.startMidY,
        });
        return;
      }

      if (!dragRef.current.active) return;
      event.preventDefault();
      const drag = dragRef.current;
      updateTransform(zoomRef.current, {
        x: drag.baseX + event.clientX - drag.startX,
        y: drag.baseY + event.clientY - drag.startY,
      });
    };

    const end = (event: PointerEvent) => {
      pointersRef.current.delete(event.pointerId);
      if (pointersRef.current.size === 0) {
        dragRef.current.active = false;
        pinchRef.current.active = false;
      } else if (pointersRef.current.size === 1) {
        const remaining = Array.from(pointersRef.current.values())[0];
        pinchRef.current.active = false;
        dragRef.current = {
          active: true,
          startX: remaining.x,
          startY: remaining.y,
          baseX: offsetRef.current.x,
          baseY: offsetRef.current.y,
        };
      }
    };

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [updateTransform]);

  useEffect(() => {
    const targetBox = boxRef.current;
    if (!targetBox) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      updateTransform(zoomRef.current - event.deltaY * 0.0015, offsetRef.current);
    };
    targetBox.addEventListener('wheel', wheel, { passive: false });
    return () => targetBox.removeEventListener('wheel', wheel);
  }, [updateTransform]);

  const save = async () => {
    if (saving || !imageRef.current || !imageSize.width || !imageSize.height || !boxSize.width || !boxSize.height) return;
    setSaving(true);
    try {
      const baseScale = Math.max(boxSize.width / imageSize.width, boxSize.height / imageSize.height);
      const scale = baseScale * zoomRef.current;
      const sourceWidth = Math.min(imageSize.width, boxSize.width / scale);
      const sourceHeight = Math.min(imageSize.height, boxSize.height / scale);
      const centerX = imageSize.width / 2 - offsetRef.current.x / scale;
      const centerY = imageSize.height / 2 - offsetRef.current.y / scale;
      const sourceX = Math.max(0, Math.min(imageSize.width - sourceWidth, centerX - sourceWidth / 2));
      const sourceY = Math.max(0, Math.min(imageSize.height - sourceHeight, centerY - sourceHeight / 2));

      const canvas = document.createElement('canvas');
      canvas.width = outputSize.width;
      canvas.height = outputSize.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas context unavailable');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(imageRef.current, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) throw new Error('canvas blob unavailable');
      onApply(URL.createObjectURL(blob));
    } catch (error) {
      console.error('Profile image crop failed:', error);
      toast.error('画像の切り抜きに失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const changeZoom = (delta: number) => {
    updateTransform(zoomRef.current + delta, offsetRef.current);
  };

  const displayedScale = imageSize.width && imageSize.height && boxSize.width && boxSize.height
    ? Math.max(boxSize.width / imageSize.width, boxSize.height / imageSize.height) * zoom
    : 1;

  return createPortal(
    <div
      className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/50 p-2 sm:p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={modalClassName}>
        <div className="flex h-12 shrink-0 items-center justify-between px-3 sm:h-14 sm:px-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="閉じる"
          >
            <X className="h-5 w-5" />
          </button>
          <span className="text-sm font-bold">{target === 'avatar' ? 'アイコン' : 'ヘッダー'}</span>
          <Button
            type="button"
            size="sm"
            className="h-9 rounded-full px-4 font-bold"
            onClick={save}
            disabled={saving || !imageSize.width}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : '適用'}
          </Button>
        </div>

        <div className={cropAreaClassName}>
          <div
            ref={boxRef}
            className="relative cursor-grab overflow-hidden bg-background touch-none select-none active:cursor-grabbing"
            style={{
              ...cropFrameStyle,
              maxWidth: 'calc(100vw - 20px)',
              maxHeight: 'calc(92svh - 132px)',
              touchAction: 'none',
              userSelect: 'none',
              WebkitUserSelect: 'none',
            }}
            onPointerDown={startGesture}
          >
            <div
              className="absolute inset-0 bg-center bg-no-repeat"
              style={{
                backgroundImage: `url(${src})`,
                backgroundSize: imageSize.width && imageSize.height
                  ? `${imageSize.width * displayedScale}px ${imageSize.height * displayedScale}px`
                  : 'contain',
                backgroundPosition: `calc(50% + ${offset.x}px) calc(50% + ${offset.y}px)`,
              }}
            />
            <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/70" />
          </div>
        </div>

        <div className="flex h-12 shrink-0 items-center gap-2 px-3 sm:h-14 sm:px-5">
          <button
            type="button"
            onClick={() => changeZoom(-0.15)}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="縮小"
          >
            −
          </button>
          <input
            type="range"
            min={PROFILE_CROP_LIMIT.min}
            max={PROFILE_CROP_LIMIT.max}
            step="0.01"
            value={zoom}
            onChange={(event) => updateTransform(Number(event.target.value), offsetRef.current)}
            className="min-w-0 flex-1 accent-current"
            aria-label="ズーム"
          />
          <button
            type="button"
            onClick={() => changeZoom(0.15)}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="拡大"
          >
            +
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function Settings() {
  const { user: authUser, logout } = useAuth();
  const user = (authUser as unknown) as User | null;
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const { mutateAsync, isPending } = useUpdateProfile(user?.id ?? '');

  const getInitialEmoji = () => {
    if (user?.emojiEffect) return user.emojiEffect;
    return localStorage.getItem('lime_emoji_pref') ?? '';
  };

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '');
  const [coverUrl, setCoverUrl] = useState(user?.coverUrl ?? '');
  const [timelineBackgroundUrl, setTimelineBackgroundUrl] = useState(
    (user as any)?.timelineBackgroundUrl ??
      (user as any)?.timeline_background_url ??
      localStorage.getItem('lime_timeline_background_url') ??
      ''
  );
  const [timelineBackgroundPublicId, setTimelineBackgroundPublicId] = useState(
    (user as any)?.timelineBackgroundPublicId ?? (user as any)?.timeline_background_public_id ?? ''
  );
  const [isTimelineBackgroundUploading, setIsTimelineBackgroundUploading] = useState(false);
  const [isTimelineBackgroundLoading, setIsTimelineBackgroundLoading] = useState(false);
  const [emojiEffect, setEmojiEffect] = useState(getInitialEmoji());
  const [botEnabled, setBotEnabled] = useState(user?.bot_enabled ?? false);
  const [botPrompt, setBotPrompt] = useState(user?.bot_prompt ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const avatarRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const timelineBackgroundRef = useRef<HTMLInputElement>(null);
  const [profileCropTarget, setProfileCropTarget] = useState<ProfileImageCropTarget | null>(null);
  const [profileCropSrc, setProfileCropSrc] = useState('');
  const profileCropObjectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (profileCropObjectUrlRef.current) URL.revokeObjectURL(profileCropObjectUrlRef.current);
    };
  }, []);
  const [customEmojis, setCustomEmojis] = useState<CustomEmoji[]>([]);
  const [emojiName, setEmojiName] = useState('');
  const [emojiFile, setEmojiFile] = useState<File | null>(null);
  const [emojiPreview, setEmojiPreview] = useState('');
  const [isEmojiUploading, setIsEmojiUploading] = useState(false);
  const emojiInputRef = useRef<HTMLInputElement>(null);
  const [hasLimePro, setHasLimePro] = useState(false);
  const [isLimeProPurchasing, setIsLimeProPurchasing] = useState(false);

  const [blueskyHandles, setBlueskyHandles] = useState<string[]>(getConfiguredBlueskyHandles);
  const [blueskyHandleInput, setBlueskyHandleInput] = useState('');
  const [blueskyProfiles, setBlueskyProfiles] = useState<Record<string, BlueskyProfileInfo>>({});
  const [blueskyProfilesLoading, setBlueskyProfilesLoading] = useState<Record<string, boolean>>({});

  // 自分のBlueskyアカウントでのログイン(アプリパスワード認証)状態
  const [blueskySession, setBlueskySession] = useState<BlueskySession | null>(getStoredBlueskySession);
  const [blueskyLoginHandle, setBlueskyLoginHandle] = useState('');
  const [blueskyAppPassword, setBlueskyAppPassword] = useState('');
  const [isBlueskyLoggingIn, setIsBlueskyLoggingIn] = useState(false);
  const [isBlueskyLoggingOut, setIsBlueskyLoggingOut] = useState(false);
  const [showBlueskyAppPassword, setShowBlueskyAppPassword] = useState(false);

  const fetchCustomEmojis = async () => {
    try {
      const { data, error } = await supabase
        .from('custom_emojis')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (data) setCustomEmojis(data as CustomEmoji[]);
    } catch (err) {
      console.error('Fetch Emojis Error:', err);
    }
  };

  const fetchLimeProStatus = async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase
        .from('user_entitlements')
        .select('feature')
        .eq('user_id', user.id)
        .eq('feature', 'limepro')
        .maybeSingle();

      if (error) throw error;
      setHasLimePro(!!data);
    } catch (err) {
      console.error('Fetch LimePro Status Error:', err);
    }
  };

  const applyTimelineBackgroundState = (url: string, publicId = '') => {
    setTimelineBackgroundUrl(url);
    setTimelineBackgroundPublicId(publicId);

    if (url) {
      localStorage.setItem('lime_timeline_background_url', url);
    } else {
      localStorage.removeItem('lime_timeline_background_url');
    }
  };

  const fetchProfileForSettings = async () => {
    try {
      // 設定画面だけを直接開いてもプロフィール画面の読み込み結果に依存しないよう、
      // Supabaseから現在ユーザーのプロフィールを直接取得する。
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;

      const userId = authData.user?.id ?? user?.id;
      if (!userId) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('display_name, bio, avatar_url, cover_url, emoji_effect, bot_enabled, bot_prompt')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return;

      setDisplayName(data.display_name ?? '');
      setBio(data.bio ?? '');
      setAvatarUrl(data.avatar_url ?? '');
      setCoverUrl(data.cover_url ?? '');
      setBotEnabled(data.bot_enabled ?? false);
      setBotPrompt(data.bot_prompt ?? '');
      setEmojiEffect(data.emoji_effect ?? localStorage.getItem('lime_emoji_pref') ?? '');
    } catch (err) {
      console.error('Fetch Profile For Settings Error:', err);
    }
  };

  const fetchTimelineBackgroundSetting = async () => {
    if (!user?.id) return;

    setIsTimelineBackgroundLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('timeline_background_url, timeline_background_public_id')
        .eq('id', user.id)
        .maybeSingle();

      if (error) throw error;

      const url = data?.timeline_background_url ?? '';
      const publicId = data?.timeline_background_public_id ?? '';
      applyTimelineBackgroundState(url, publicId);
    } catch (err) {
      console.error('Fetch Timeline Background Error:', err);

      const fallbackUrl =
        (user as any)?.timelineBackgroundUrl ??
        (user as any)?.timeline_background_url ??
        localStorage.getItem('lime_timeline_background_url') ??
        '';
      const fallbackPublicId =
        (user as any)?.timelineBackgroundPublicId ??
        (user as any)?.timeline_background_public_id ??
        '';

      applyTimelineBackgroundState(fallbackUrl, fallbackPublicId);
    } finally {
      setIsTimelineBackgroundLoading(false);
    }
  };

  useEffect(() => {
    // プロフィール画面を経由しなくても、設定画面自身で最新プロフィールを取得する。
    fetchProfileForSettings();

    if (!user) return;

    setDisplayName(user.displayName ?? '');
    setBio(user.bio ?? '');
    setAvatarUrl(user.avatarUrl ?? '');
    setCoverUrl(user.coverUrl ?? '');

    const localTimelineBackgroundUrl = localStorage.getItem('lime_timeline_background_url') ?? '';
    const userTimelineBackgroundUrl =
      (user as any)?.timelineBackgroundUrl ?? (user as any)?.timeline_background_url ?? '';
    const userTimelineBackgroundPublicId =
      (user as any)?.timelineBackgroundPublicId ?? (user as any)?.timeline_background_public_id ?? '';

    applyTimelineBackgroundState(
      userTimelineBackgroundUrl || localTimelineBackgroundUrl,
      userTimelineBackgroundPublicId
    );

    setBotEnabled(user.bot_enabled ?? false);
    setBotPrompt(user.bot_prompt ?? '');

    const currentEmoji = user.emojiEffect ?? localStorage.getItem('lime_emoji_pref') ?? '';
    setEmojiEffect(currentEmoji);

    setBlueskyHandles(getConfiguredBlueskyHandles());
    fetchCustomEmojis();
    fetchLimeProStatus();
    fetchTimelineBackgroundSetting();
  }, [user?.id]);

  useEffect(() => {
    const handleBlueskyHandlesChanged = () => {
      setBlueskyHandles(getConfiguredBlueskyHandles());
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'lime_bluesky_author_handles') {
        setBlueskyHandles(getConfiguredBlueskyHandles());
      }
    };

    window.addEventListener('lime-bluesky-handles-changed', handleBlueskyHandlesChanged);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener('lime-bluesky-handles-changed', handleBlueskyHandlesChanged);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // 自分のBlueskyアカウントのログイン状態が(このタブ内・他タブ問わず)変わったら同期する
  useEffect(() => {
    const handleBlueskySessionChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ session: BlueskySession | null }>).detail;
      setBlueskySession(detail?.session ?? getStoredBlueskySession());
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'lime_bluesky_session') {
        setBlueskySession(getStoredBlueskySession());
      }
    };

    window.addEventListener('lime-bluesky-session-changed', handleBlueskySessionChanged);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener('lime-bluesky-session-changed', handleBlueskySessionChanged);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // 登録済みのBlueskyハンドルに対応するプロフィール（アイコン・表示名）を取得する
  useEffect(() => {
    const handlesToFetch = blueskyHandles.filter(
      (handle) => !blueskyProfiles[handle] && !blueskyProfilesLoading[handle]
    );

    if (handlesToFetch.length === 0) return;

    setBlueskyProfilesLoading((prev) => {
      const next = { ...prev };
      handlesToFetch.forEach((handle) => {
        next[handle] = true;
      });
      return next;
    });

    handlesToFetch.forEach((handle) => {
      fetchBlueskyProfile(handle).then((profile) => {
        setBlueskyProfiles((prev) => ({ ...prev, [handle]: profile }));
        setBlueskyProfilesLoading((prev) => ({ ...prev, [handle]: false }));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blueskyHandles]);

  if (!user) return null;

  const onPickImage = (e: ChangeEvent<HTMLInputElement>, target: ProfileImageCropTarget) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('画像ファイルを選択してください');
      return;
    }

    if (profileCropObjectUrlRef.current) {
      URL.revokeObjectURL(profileCropObjectUrlRef.current);
    }

    const url = URL.createObjectURL(file);
    profileCropObjectUrlRef.current = url;
    setProfileCropTarget(target);
    setProfileCropSrc(url);
  };

  const closeProfileCrop = () => {
    setProfileCropTarget(null);
    setProfileCropSrc('');
    if (profileCropObjectUrlRef.current) {
      URL.revokeObjectURL(profileCropObjectUrlRef.current);
      profileCropObjectUrlRef.current = null;
    }
  };

  const applyProfileCrop = (url: string) => {
    if (profileCropTarget === 'avatar') {
      setAvatarUrl(url);
    } else if (profileCropTarget === 'cover') {
      setCoverUrl(url);
    }
    closeProfileCrop();
  };

  const notifyTimelineBackgroundChanged = (url: string) => {
    if (url) {
      localStorage.setItem('lime_timeline_background_url', url);
    } else {
      localStorage.removeItem('lime_timeline_background_url');
    }

    window.dispatchEvent(
      new CustomEvent('timeline-background-changed', {
        detail: { url },
      })
    );

    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel('timeline-background');
      channel.postMessage({ url });
      channel.close();
    }
  };

  const handleTimelineBackgroundUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('背景には画像ファイルを選択してください');
      return;
    }

    const maxSize = 8 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error('背景画像は8MB以下にしてください');
      return;
    }

    setIsTimelineBackgroundUploading(true);

    try {
      const cloudinaryCloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
      const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

      if (!cloudinaryCloudName || !uploadPreset) {
        throw new Error('Cloudinaryの環境設定が不足しています');
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', uploadPreset);
      formData.append('folder', `timeline_backgrounds/${user.id}`);

      const clRes = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/image/upload`,
        {
          method: 'POST',
          body: formData,
        }
      );

      if (!clRes.ok) throw new Error('Cloudinaryへのアップロードに失敗しました');

      const clData = await clRes.json();
      const uploadedUrl = clData.secure_url as string;
      const uploadedPublicId = clData.public_id as string;

      const { error } = await supabase
        .from('profiles')
        .update({
          timeline_background_url: uploadedUrl,
          timeline_background_public_id: uploadedPublicId,
        })
        .eq('id', user.id);

      if (error) throw error;

      applyTimelineBackgroundState(uploadedUrl, uploadedPublicId);
      notifyTimelineBackgroundChanged(uploadedUrl);
      toast.success('タイムライン背景を更新しました');
    } catch (err: any) {
      console.error('Timeline Background Upload Error:', err);
      toast.error(err.message || 'タイムライン背景の更新に失敗しました');
    } finally {
      setIsTimelineBackgroundUploading(false);
    }
  };

  const handleRemoveTimelineBackground = async () => {
    if (!timelineBackgroundUrl && !timelineBackgroundPublicId) return;
    if (!confirm('背景を削除しますか？')) return;

    setIsTimelineBackgroundUploading(true);

    try {
      const { error } = await supabase.functions.invoke('delete-timeline-background', {
        body: {
          publicId: timelineBackgroundPublicId || null,
        },
      });

      if (error) {
        const maybeContext = (error as any).context;
        if (maybeContext?.json) {
          try {
            const payload = await maybeContext.json();
            throw new Error(payload?.error || error.message);
          } catch (parseError) {
            if (parseError instanceof Error && parseError.message) {
              throw parseError;
            }
          }
        }
        throw error;
      }

      applyTimelineBackgroundState('', '');
      notifyTimelineBackgroundChanged('');
      toast.success('タイムライン背景を削除しました');
    } catch (err: any) {
      console.error('Timeline Background Remove Error:', err);
      toast.error(err.message || 'タイムライン背景の削除に失敗しました');
    } finally {
      setIsTimelineBackgroundUploading(false);
    }
  };

  const onPickEmojiFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setEmojiFile(file);
    const url = URL.createObjectURL(file);
    setEmojiPreview(url);
  };

  const handleUploadCustomEmoji = async () => {
    if (!emojiName.trim()) {
      toast.error('絵文字名を入力してください');
      return;
    }

    if (!emojiFile) {
      toast.error('画像ファイルを選択してください');
      return;
    }

    let formattedName = emojiName.trim();
    if (!formattedName.startsWith(':')) formattedName = `:${formattedName}`;
    if (!formattedName.endsWith(':')) formattedName = `${formattedName}:`;

    const nameRegex = /^:[a-zA-Z0-9_-]+:$/;
    if (!nameRegex.test(formattedName) || formattedName.length < 3) {
      toast.error('絵文字名は英数字、アンダースコア、ハイフンのみを使用し、前後にコロンを付けてください（例: :my_emoji:）');
      return;
    }

    setIsEmojiUploading(true);

    try {
      const cloudinaryCloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
      const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

      if (!cloudinaryCloudName || !uploadPreset) {
        throw new Error('Cloudinaryの環境設定が不足しています');
      }

      const formData = new FormData();
      formData.append('file', emojiFile);
      formData.append('upload_preset', uploadPreset);
      formData.append('folder', 'custom_emojis');

      const clRes = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/image/upload`,
        {
          method: 'POST',
          body: formData,
        }
      );

      if (!clRes.ok) throw new Error('Cloudinaryへのアップロードに失敗しました');

      const clData = await clRes.json();

      const { error: dbError } = await supabase
        .from('custom_emojis')
        .insert([
          {
            name: formattedName,
            public_id: clData.public_id,
            format: clData.format,
            uploaded_by: user.id,
          },
        ]);

      if (dbError) {
        if (dbError.code === '23505') {
          toast.error(`「${formattedName}」は既に登録されています。別の名前を入力してください。`);
          return;
        }
        throw dbError;
      }

      toast.success('カスタム絵文字を登録しました');
      setEmojiName('');
      setEmojiFile(null);
      setEmojiPreview('');

      if (emojiInputRef.current) {
        emojiInputRef.current.value = '';
      }

      await fetchCustomEmojis();
    } catch (err: any) {
      console.error('Emoji Upload Error:', err);
      toast.error(err.message || 'カスタム絵文字の登録に失敗しました');
    } finally {
      setIsEmojiUploading(false);
    }
  };

  const handleDeleteCustomEmoji = async (id: string) => {
    if (!confirm('このカスタム絵文字を削除しますか？関連するすべてのリアクションも削除されます。')) return;

    try {
      const { error } = await supabase
        .from('custom_emojis')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast.success('カスタム絵文字を削除しました');
      await fetchCustomEmojis();
    } catch (err) {
      console.error('Delete Emoji Error:', err);
      toast.error('カスタム絵文字の削除に失敗しました');
    }
  };

  const handleAddBlueskyHandle = () => {
    const normalized = normalizeBlueskyHandle(blueskyHandleInput);
    if (!normalized) {
      toast.error('Blueskyのユーザー名を入力してください');
      return;
    }

    if (blueskyHandles.includes(normalized)) {
      toast.info(`@${normalized} はすでに登録されています`);
      setBlueskyHandleInput('');
      return;
    }

    const nextHandles = [...blueskyHandles, normalized];
    const savedHandles = saveConfiguredBlueskyHandles(nextHandles);
    setBlueskyHandles(savedHandles);
    setBlueskyHandleInput('');
    toast.success(`@${normalized} をBluesky連携に追加しました`);
  };

  const handleRemoveBlueskyHandle = (handle: string) => {
    const nextHandles = blueskyHandles.filter((item) => item !== handle);
    const savedHandles = saveConfiguredBlueskyHandles(nextHandles);
    setBlueskyHandles(savedHandles);
    setBlueskyProfiles((prev) => {
      const next = { ...prev };
      delete next[handle];
      return next;
    });
    toast.success(`@${handle} をBluesky連携から削除しました`);
  };

  const handleBlueskyLogin = async () => {
    if (!blueskyLoginHandle.trim() || !blueskyAppPassword.trim()) {
      toast.error('ユーザー名とアプリパスワードを入力してください');
      return;
    }

    setIsBlueskyLoggingIn(true);
    try {
      const session = await loginToBluesky(blueskyLoginHandle, blueskyAppPassword);
      setBlueskySession(session);
      setBlueskyLoginHandle('');
      setBlueskyAppPassword('');
      toast.success(`@${session.handle} でBlueskyにログインしました`);
    } catch (err: any) {
      console.error('Bluesky Login Error:', err);
      toast.error(err.message || 'Blueskyログインに失敗しました');
    } finally {
      setIsBlueskyLoggingIn(false);
    }
  };

  const handleBlueskyLogout = async () => {
    setIsBlueskyLoggingOut(true);
    try {
      await logoutFromBluesky();
      setBlueskySession(null);
      toast.success('Blueskyからログアウトしました');
    } catch (err) {
      console.error('Bluesky Logout Error:', err);
      toast.error('ログアウトに失敗しました');
    } finally {
      setIsBlueskyLoggingOut(false);
    }
  };

  const handleDummyLimeProPurchase = async () => {
    if (!user?.id) return;

    const previousStatus = hasLimePro;
    const nextStatus = !hasLimePro;

    const notifyLimeProStatus = (status: boolean) => {
      setHasLimePro(status);
      localStorage.setItem('limepro_status', String(status));
      window.dispatchEvent(
        new CustomEvent('limepro-status-changed', {
          detail: { hasLimePro: status },
        })
      );

      if ('BroadcastChannel' in window) {
        const channel = new BroadcastChannel('limepro-status');
        channel.postMessage({ hasLimePro: status });
        channel.close();
      }
    };

    setIsLimeProPurchasing(true);
    notifyLimeProStatus(nextStatus);

    try {
      if (nextStatus) {
        const { error } = await supabase
          .from('user_entitlements')
          .insert({
            user_id: user.id,
            feature: 'limepro',
          });

        if (error) {
          if (error.code === '23505') {
            notifyLimeProStatus(true);
            toast.info('すでにLimeProが有効です');
            return;
          }
          throw error;
        }

        toast.success('LimeProを有効化しました');
        return;
      }

      const { error } = await supabase
        .from('user_entitlements')
        .delete()
        .eq('user_id', user.id)
        .eq('feature', 'limepro');

      if (error) throw error;
      toast.success('LimeProを解約しました');
    } catch (err) {
      console.error('Dummy LimePro Purchase Error:', err);
      notifyLimeProStatus(previousStatus);
      toast.error(nextStatus ? 'LimeProの有効化に失敗しました' : 'LimeProの解約に失敗しました');
    } finally {
      setIsLimeProPurchasing(false);
    }
  };

  const updateEmojiOnly = async () => {
    const emojiCount = Array.from(emojiEffect).length;
    if (emojiCount > 1) {
      toast.error('エフェクトには1文字だけ入力してください');
      return;
    }

    try {
      await mutateAsync({
        displayName,
        bio,
        avatarUrl,
        coverUrl,
        emojiEffect,
        bot_enabled: botEnabled,
        bot_prompt: botPrompt,
      });
      localStorage.setItem('lime_emoji_pref', emojiEffect);
      toast.success('エフェクト設定を更新しました');
    } catch (err) {
      console.error('Emoji Update Error:', err);
      toast.error('エフェクトの保存に失敗しました');
    }
  };

  const updateBotSettings = async (nextEnabled?: boolean) => {
    const targetEnabled = nextEnabled !== undefined ? nextEnabled : botEnabled;

    try {
      await mutateAsync({
        displayName,
        bio,
        avatarUrl,
        coverUrl,
        emojiEffect,
        bot_enabled: targetEnabled,
        bot_prompt: botPrompt,
      });
    } catch (err) {
      console.error('Bot Update Error:', err);
      toast.error('Bot設定の保存に失敗しました');
      setBotEnabled(!targetEnabled);
    }
  };

  const handleBotSwitchChange = async (checked: boolean) => {
    setBotEnabled(checked);
    await updateBotSettings(checked);
  };

  const submit = async () => {
    const parsed = schema.safeParse({ displayName, bio });

    if (!parsed.success) {
      const fe: Record<string, string> = {};
      parsed.error.issues.forEach((i) => {
        fe[i.path[0] as string] = i.message;
      });
      setErrors(fe);
      return;
    }

    const emojiCount = Array.from(emojiEffect).length;
    if (emojiCount > 1) {
      toast.error('エフェクトには1文字だけ入力してください');
      return;
    }

    setErrors({});

    try {
      await mutateAsync({
        displayName,
        bio,
        avatarUrl,
        coverUrl,
        emojiEffect,
        bot_enabled: botEnabled,
        bot_prompt: botPrompt,
      });
      localStorage.setItem('lime_emoji_pref', emojiEffect);
      toast.success('プロフィールを更新しました');
    } catch (err) {
      console.error('Settings Update Error:', err);
      toast.error('保存に失敗しました。DBのカラム名を確認してください。');
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-black">設定</h1>

      <div className="overflow-hidden rounded-3xl border border-border/60 bg-card shadow-soft">
        <div className="relative h-40 bg-gradient-cream sm:h-48">
          {coverUrl && <img src={coverUrl} alt="" className="h-full w-full object-cover" />}
          <button
            type="button"
            onClick={() => coverRef.current?.click()}
            className="absolute inset-0 flex items-center justify-center bg-foreground/30 text-primary-foreground opacity-0 transition hover:opacity-100"
          >
            <ImagePlus className="mr-2 h-5 w-5" /> カバー画像を変更
          </button>
          <input
            ref={coverRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => onPickImage(e, 'cover')}
          />
        </div>

        <div className="px-5 pb-6 pt-3 sm:px-6">
          <div className="-mt-12 flex items-end gap-3 sm:-mt-14">
            <div className="relative">
              <Avatar className="h-24 w-24 border-4 border-card shadow-pop sm:h-28 sm:w-28">
                <AvatarImage src={avatarUrl} alt={displayName} />
                <AvatarFallback>{displayName.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <button
                type="button"
                onClick={() => avatarRef.current?.click()}
                className="absolute bottom-0 right-0 rounded-full bg-gradient-primary p-2 text-primary-foreground shadow-soft transition hover:scale-110"
              >
                <ImagePlus className="h-4 w-4" />
              </button>
              <input
                ref={avatarRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => onPickImage(e, 'avatar')}
              />
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="displayName">表示名</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={30}
                className="rounded-full bg-background"
              />
              {errors.displayName && <p className="text-xs text-destructive">{errors.displayName}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="username">ユーザー名</Label>
              <Input id="username" value={user.username} disabled className="rounded-full bg-muted" />
              <p className="text-xs text-muted-foreground">※ ユーザー名は変更できません</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bio">自己紹介</Label>
              <Textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
                maxLength={200}
                className="resize-none rounded-2xl"
              />
              <div className="flex justify-end">
                <span
                  className={`text-xs ${bio.length > 160 ? 'font-bold text-destructive' : 'text-muted-foreground'}`}
                >
                  {bio.length} / 160
                </span>
              </div>
              {errors.bio && <p className="text-xs text-destructive">{errors.bio}</p>}
            </div>

            <Button
              onClick={submit}
              disabled={isPending}
              className="w-full rounded-full bg-gradient-primary py-6 font-bold shadow-soft hover:shadow-pop"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存する'}
            </Button>
          </div>
        </div>
      </div>

      <Separator />

      <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="font-display text-base font-bold">Bluesky連携</h2>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Input
            value={blueskyHandleInput}
            onChange={(e) => setBlueskyHandleInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddBlueskyHandle();
              }
            }}
            placeholder="例: @nakkar7.bsky.social"
            className="h-11 rounded-full bg-background"
            aria-label="追加するBlueskyユーザー"
          />
          <Button
            type="button"
            onClick={handleAddBlueskyHandle}
            className="h-11 rounded-full bg-gradient-primary font-bold shadow-soft"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            追加
          </Button>
        </div>

        <div className="mt-4 space-y-2">
          <Label>登録済みアカウント（{blueskyHandles.length}）</Label>
          {blueskyHandles.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/60 bg-background/50 px-4 py-4 text-sm text-muted-foreground">
              登録されているBlueskyユーザーはありません。
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {blueskyHandles.map((handle) => {
                const profile = blueskyProfiles[handle];
                const isProfileLoading = !!blueskyProfilesLoading[handle];
                const profilePath = getInternalProfilePath(handle);

                return (
                  <div
                    key={handle}
                    className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background py-1 pl-1.5 pr-1.5 text-sm font-bold"
                  >
                    <Link
                      to={profilePath}
                      className="flex min-w-0 items-center gap-2 rounded-full py-0.5 pr-2 transition hover:bg-muted"
                      title={`@${handle} のプロフィールを開く`}
                    >
                      <Avatar className="h-6 w-6 shrink-0 border border-border/40">
                        <AvatarImage src={profile?.avatar} alt={profile?.displayName || handle} />
                        <AvatarFallback className="text-[10px] font-bold">
                          {handle.slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="flex min-w-0 flex-col leading-tight">
                        <span className="max-w-[200px] truncate">
                          {isProfileLoading
                            ? '読み込み中...'
                            : profile?.displayName || `@${handle}`}
                        </span>
                        {profile?.displayName && (
                          <span className="max-w-[200px] truncate text-[10px] font-normal text-muted-foreground">
                            @{handle}
                          </span>
                        )}
                      </span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleRemoveBlueskyHandle(handle)}
                      className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`@${handle}を削除`}
                      title={`@${handle}を削除`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-6 space-y-3 rounded-2xl border border-border/40 bg-background/50 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-muted-foreground">Blueskyアカウント</h3>
            {blueskySession && (
              <span className="rounded-full bg-primary-soft px-2.5 py-1 text-[10px] font-bold text-primary">
                連携中
              </span>
            )}
          </div>

          {blueskySession ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Avatar className="h-9 w-9 border border-border/40">
                  <AvatarFallback className="text-xs font-bold">
                    {blueskySession.handle.slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 leading-tight">
                  <p className="truncate text-sm font-bold">@{blueskySession.handle}</p>
                  <p className="text-[11px] text-muted-foreground">ログイン中</p>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleBlueskyLogout}
                disabled={isBlueskyLoggingOut}
                className="rounded-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {isBlueskyLoggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : 'ログアウト'}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                value={blueskyLoginHandle}
                onChange={(e) => setBlueskyLoginHandle(e.target.value)}
                placeholder="ユーザー名（例: nakkar7.bsky.social）"
                className="h-10 rounded-full bg-background"
                autoComplete="username"
              />
              <div className="relative">
                <Input
                  type={showBlueskyAppPassword ? 'text' : 'password'}
                  value={blueskyAppPassword}
                  onChange={(e) => setBlueskyAppPassword(e.target.value)}
                  placeholder="アプリパスワード（xxxx-xxxx-xxxx-xxxx）"
                  className="h-10 rounded-full bg-background pr-16"
                  autoComplete="current-password"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleBlueskyLogin();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowBlueskyAppPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                >
                  {showBlueskyAppPassword ? '隠す' : '表示'}
                </button>
              </div>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                通常のログインパスワードではなく、Blueskyが発行する
                <a
                  href="https://bsky.app/settings/app-passwords"
                  target="_blank"
                  rel="noreferrer"
                  className="mx-1 font-bold text-primary underline"
                >
                  アプリパスワード
                </a>
                を使用してください。
              </p>
              <Button
                type="button"
                onClick={handleBlueskyLogin}
                disabled={isBlueskyLoggingIn}
                className="w-full rounded-full bg-gradient-primary font-bold shadow-soft"
              >
                {isBlueskyLoggingIn ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Blueskyにログイン
              </Button>
            </div>
          )}
        </div>
      </div>

      <Separator />

      <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <h2 className="font-display text-base font-bold">自動投稿の設定</h2>
          </div>
          <Switch checked={botEnabled} onCheckedChange={handleBotSwitchChange} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          AIがあなたに代わって自動的に投稿を行います
        </p>

        {botEnabled && (
          <div className="mt-4 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <MessageSquareText className="h-3.5 w-3.5 text-muted-foreground" />
                <Label htmlFor="botPrompt">性格・指示</Label>
              </div>
              <Textarea
                id="botPrompt"
                value={botPrompt}
                onChange={(e) => setBotPrompt(e.target.value)}
                placeholder="例:猫が好きな人として振る舞ってください"
                rows={3}
                className="resize-none rounded-2xl bg-background"
              />
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                ※ AIへの指示を入力してください。この指示に基づいて自動投稿が生成されます。
              </p>
            </div>

            <Button
              onClick={() => updateBotSettings()}
              disabled={isPending}
              variant="secondary"
              className="w-full rounded-full font-bold shadow-sm"
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              自動投稿の設定を更新
            </Button>
          </div>
        )}
      </div>

      <Separator />

      <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft">
        <div className="flex items-center gap-2">
          <Smile className="h-4 w-4 text-primary" />
          <h2 className="font-display text-base font-bold">絵文字の管理</h2>
        </div>

        <div className="mt-4 space-y-4 rounded-2xl border border-border/40 bg-background/50 p-4">
          <h3 className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
            <Upload className="h-3 w-3" /> 新規絵文字の登録
          </h3>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="emojiName">絵文字名</Label>
              <Input
                id="emojiName"
                value={emojiName}
                onChange={(e) => setEmojiName(e.target.value)}
                placeholder="例: Nakkar"
                className="rounded-full bg-background"
              />
            </div>

            <div className="space-y-1.5">
              <Label>画像ファイル</Label>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => emojiInputRef.current?.click()}
                  className="rounded-full border-dashed"
                >
                  画像を選択
                </Button>
                <input
                  ref={emojiInputRef}
                  type="file"
                  accept="image/png, image/jpeg, image/gif, image/webp"
                  hidden
                  onChange={onPickEmojiFile}
                />
                {emojiPreview && (
                  <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-border/40 bg-muted">
                    <img src={emojiPreview} alt="Preview" className="h-full w-full object-contain" />
                  </div>
                )}
              </div>
            </div>
          </div>

          <Button
            onClick={handleUploadCustomEmoji}
            disabled={isEmojiUploading || !emojiName || !emojiFile}
            className="w-full rounded-full bg-gradient-primary font-bold shadow-soft"
          >
            {isEmojiUploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            絵文字をアップロードして登録
          </Button>
        </div>

        <div className="mt-6 space-y-2">
          <h3 className="text-xs font-bold text-muted-foreground">
            登録済みのカスタム絵文字（{customEmojis.length}個）
          </h3>

          {customEmojis.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              登録されているカスタム絵文字はありません。
            </p>
          ) : (
            <div className="grid max-h-60 grid-cols-2 gap-2 overflow-y-auto rounded-2xl border border-border/40 bg-background/30 p-1 sm:grid-cols-3 md:grid-cols-4">
              {customEmojis.map((emoji) => {
                const optimizedUrl = `https://res.cloudinary.com/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/image/upload/f_auto,q_auto,w_48,h_48,c_limit/${emoji.public_id}.${emoji.format}`;

                return (
                  <div
                    key={emoji.id}
                    className="flex items-center justify-between rounded-xl border border-border/40 bg-card p-2 shadow-sm"
                  >
                    <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/20 bg-muted">
                        <img src={optimizedUrl} alt={emoji.name} className="h-full w-full object-contain" />
                      </div>
                      <span className="truncate font-mono text-xs text-foreground/80" title={emoji.name}>
                        {emoji.name}
                      </span>
                    </div>

                    {emoji.uploaded_by === user.id && (
                      <button
                        type="button"
                        onClick={() => handleDeleteCustomEmoji(emoji.id)}
                        className="rounded-md p-1 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                        title="削除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Separator />

      <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft">
        <h2 className="font-display text-base font-bold">外観の設定</h2>
        <p className="mt-1 text-sm text-muted-foreground">LimeNoteの表示を切り替えます</p>

        <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-muted p-1">
          <button
            onClick={() => setTheme('light')}
            className={`flex items-center justify-center gap-2 rounded-xl py-2 text-sm font-bold transition ${
              theme === 'light' ? 'bg-background text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Sun className="h-4 w-4" /> ライト
          </button>
          <button
            onClick={() => setTheme('dark')}
            className={`flex items-center justify-center gap-2 rounded-xl py-2 text-sm font-bold transition ${
              theme === 'dark' ? 'bg-background text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Moon className="h-4 w-4" /> ダーク
          </button>
          <button
            onClick={() => setTheme('system')}
            className={`flex items-center justify-center gap-2 rounded-xl py-2 text-sm font-bold transition ${
              theme === 'system' ? 'bg-background text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Monitor className="h-4 w-4" /> システム
          </button>
        </div>
      </div>

      <Separator />

      <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="font-display text-base font-bold">エフェクト設定</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">謎機能 ※空白にして更新すると消せる</p>

        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="emojiEffect">降らせる文字</Label>
              <div className="relative">
                <Input
                  id="emojiEffect"
                  value={emojiEffect}
                  onChange={(e) => setEmojiEffect(e.target.value)}
                  placeholder="絵文字を入力..."
                  className="rounded-full bg-background pr-10"
                />
                {emojiEffect && (
                  <button
                    type="button"
                    onClick={() => setEmojiEffect('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    クリア
                  </button>
                )}
              </div>
            </div>

            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/40 bg-muted text-2xl shadow-inner">
              {emojiEffect ? Array.from(emojiEffect)[0] : '？'}
            </div>
          </div>

          <Button
            onClick={updateEmojiOnly}
            disabled={isPending}
            variant="secondary"
            className="w-full rounded-full font-bold shadow-sm"
          >
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            エフェクトを更新
          </Button>
        </div>
      </div>

      <Separator />

      <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-background text-primary shadow-sm">
            <Crown className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-bold">LimePro</h2>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                  hasLimePro ? 'bg-primary-soft text-primary' : 'bg-muted text-muted-foreground'
                }`}
              >
                {hasLimePro ? '有効' : '未加入'}
              </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              開発者向けの機能です。ONにすると挙動が不安定になる場合がございますのでご注意ください。
            </p>
          </div>
        </div>

        <Button
          onClick={handleDummyLimeProPurchase}
          disabled={isLimeProPurchasing}
          variant={hasLimePro ? 'outline' : 'default'}
          className={`mt-5 w-full rounded-full py-6 font-bold shadow-sm ${
            hasLimePro
              ? 'border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive'
              : 'bg-gradient-primary hover:shadow-pop'
          }`}
        >
          {isLimeProPurchasing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : hasLimePro ? (
            <Check className="mr-2 h-4 w-4" />
          ) : (
            <CreditCard className="mr-2 h-4 w-4" />
          )}
          {isLimeProPurchasing
            ? '処理中...'
            : hasLimePro
              ? 'LimeProを無効化'
              : 'LimeProを有効化'}
        </Button>
      </div>

      <Separator />

      <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-background text-primary shadow-sm">
            <ImagePlus className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-base font-bold">背景</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              タイムラインに表示する背景画像を設定できます。
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-3xl border border-border/60 bg-muted">
          <div
            className="relative flex h-44 items-center justify-center bg-gradient-cream bg-cover bg-center sm:h-56"
            style={timelineBackgroundUrl ? { backgroundImage: `url(${timelineBackgroundUrl})` } : undefined}
          >
            {timelineBackgroundUrl && (
              <div className="absolute inset-0 bg-background/10 backdrop-blur-md" />
            )}
            <div className="relative z-10 rounded-full border border-border/60 bg-card/70 px-4 py-2 text-xs font-bold text-foreground shadow-soft backdrop-blur-md">
              {isTimelineBackgroundLoading
                ? '背景設定を確認中...'
                : timelineBackgroundUrl
                  ? '現在の背景プレビュー'
                  : '背景未設定'}
            </div>
          </div>
        </div>

        <input
          ref={timelineBackgroundRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleTimelineBackgroundUpload}
        />

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => timelineBackgroundRef.current?.click()}
            disabled={isTimelineBackgroundUploading || isTimelineBackgroundLoading}
            className="rounded-full bg-gradient-primary font-bold shadow-soft hover:shadow-pop"
          >
            {isTimelineBackgroundUploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {timelineBackgroundUrl ? '背景を変更' : '背景をアップロード'}
          </Button>

          {timelineBackgroundUrl && (
            <Button
              type="button"
              variant="outline"
              onClick={handleRemoveTimelineBackground}
              disabled={isTimelineBackgroundUploading || isTimelineBackgroundLoading}
              className="rounded-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              背景を削除
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-soft">
        <h2 className="font-display text-base font-bold">アカウント</h2>
        <p className="mt-1 text-sm text-muted-foreground">ログアウトすると認証画面に戻ります</p>
        <Button
          variant="outline"
          className="mt-4 rounded-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => {
            logout();
            toast.success('ログアウトしました');
            navigate('/auth');
          }}
        >
          <LogOut className="mr-1.5 h-4 w-4" /> ログアウト
        </Button>
      </div>
      {profileCropTarget && profileCropSrc && (
        <ProfileImageCropper
          src={profileCropSrc}
          target={profileCropTarget}
          onApply={applyProfileCrop}
          onClose={closeProfileCrop}
        />
      )}
    </div>
  );
}