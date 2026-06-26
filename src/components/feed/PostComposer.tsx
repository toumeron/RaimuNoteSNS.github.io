import { memo, useCallback, useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type PointerEvent as ReactPointerEvent, type UIEvent as ReactUIEvent } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { ImagePlus, Loader2, Send, X, AtSign, Hash, Globe, Users } from 'lucide-react'; // Globe, Usersを追加
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { useCreatePost } from '@/hooks/useFeed';
import { getPostById } from '@/api/posts';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { PostWithAuthor } from '@/types';
import { formatRelative } from '@/lib/format';
import { supabase } from '@/lib/supabase';
// 公開範囲選択用のDropdown MenuをUIに合わせてインポート（既存のUIライブラリ想定）
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const MAX_LEN = 500;
const MAX_IMAGES = 4;

const MENTION_SEARCH_DEBOUNCE_MS = 180;
const HASHTAG_SEARCH_DEBOUNCE_MS = 180;
const SUGGESTION_CACHE_LIMIT = 24;
const QUOTED_POST_CACHE_LIMIT = 8;

const mentionSuggestionCache = new Map<string, any[]>();
const hashtagSuggestionCache = new Map<string, any[]>();
const quotedPostCache = new Map<string, PostWithAuthor>();
const quotedPostFetches = new Map<string, Promise<PostWithAuthor | null>>();

const normalizeSuggestionQuery = (query: string) => query.trim().toLowerCase();

const setLimitedCache = <K, V>(map: Map<K, V>, key: K, value: V, limit: number) => {
  map.delete(key);
  map.set(key, value);

  while (map.size > limit) {
    const firstKey = map.keys().next().value as K | undefined;
    if (firstKey === undefined) break;
    map.delete(firstKey);
  }
};

const getLimitedCache = <K, V>(map: Map<K, V>, key: K) => {
  const cached = map.get(key);
  if (cached === undefined) return undefined;

  map.delete(key);
  map.set(key, cached);
  return cached;
};

const getQuotedPostCached = async (postId: string) => {
  const cached = getLimitedCache(quotedPostCache, postId);
  if (cached) return cached;

  const pending = quotedPostFetches.get(postId);
  if (pending) return pending;

  const request = getPostById(postId)
    .then((post) => {
      setLimitedCache(quotedPostCache, postId, post, QUOTED_POST_CACHE_LIMIT);
      return post;
    })
    .catch((error) => {
      console.error('Fetch quoted post failed:', error);
      return null;
    })
    .finally(() => {
      quotedPostFetches.delete(postId);
    });

  quotedPostFetches.set(postId, request);
  return request;
};

interface PostComposerProps {
  initialQuotedPost?: PostWithAuthor | null;
  initialContent?: string;
  onSuccess?: () => void;
  timelineGlass?: boolean;
}

type CropOffset = { x: number; y: number };

type CropDragState = {
  dragging: boolean;
  startX: number;
  startY: number;
  baseX: number;
  baseY: number;
};

type CropPointer = { x: number; y: number };

type CropPinchState = {
  active: boolean;
  startDistance: number;
  startZoom: number;
};

type CropAspectId = 'original' | 'square' | 'portrait' | 'landscape' | 'wide';

const CROP_ASPECT_OPTIONS: Array<{
  id: CropAspectId;
  label: string;
  width: number;
  height: number;
  outputWidth: number;
  outputHeight: number;
  iconWidth: number;
  iconHeight: number;
}> = [
  // 一番左は「原寸」。画像本来の縦横比を使うので、編集を開いただけではトリミングしない。
  { id: 'original', label: '原寸', width: 1, height: 1, outputWidth: 1, outputHeight: 1, iconWidth: 22, iconHeight: 16 },
  { id: 'square', label: '1:1', width: 1, height: 1, outputWidth: 1080, outputHeight: 1080, iconWidth: 18, iconHeight: 18 },
  { id: 'portrait', label: '3:4', width: 3, height: 4, outputWidth: 1080, outputHeight: 1440, iconWidth: 15, iconHeight: 20 },
  { id: 'landscape', label: '4:3', width: 4, height: 3, outputWidth: 1440, outputHeight: 1080, iconWidth: 22, iconHeight: 16 },
  { id: 'wide', label: '16:9', width: 16, height: 9, outputWidth: 1600, outputHeight: 900, iconWidth: 24, iconHeight: 14 },
];

const clampCropZoomValue = (value: number) => Math.min(3, Math.max(1, value));

const getPointerDistance = (a: CropPointer, b: CropPointer) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
};

// テキストエリア内のカーソル座標を計算するためのヘルパー関数
function getCaretCoordinates(element: HTMLTextAreaElement, position: number) {
  const div = document.createElement('div');
  const style = window.getComputedStyle(element);

  ['width', 'height', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
   'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
   'fontSize', 'lineHeight', 'fontFamily', 'fontWeight', 'wordWrap', 'whiteSpace',
   'letterSpacing', 'boxSizing'].forEach((prop) => {
    (div.style as any)[prop] = style.getPropertyValue(prop);
  });

  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.overflow = 'hidden';

  div.textContent = element.value.substring(0, position);
  const span = document.createElement('span');
  span.textContent = element.value.substring(position) || '.';
  div.appendChild(span);

  document.body.appendChild(div);
  const coordinates = {
    top: span.offsetTop,
    left: span.offsetLeft,
    height: span.offsetHeight
  };
  document.body.removeChild(div);
  return coordinates;
}

function PostComposerComponent({ initialQuotedPost, initialContent = '', onSuccess, timelineGlass = false }: PostComposerProps) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const quoteId = searchParams.get('quote');
  
  const { mutateAsync, isPending } = useCreatePost();
  
  const [content, setContent] = useState(initialContent);
  const [previews, setPreviews] = useState<string[]>([]);
  const [previewOriginals, setPreviewOriginals] = useState<string[]>([]);
  const [editingImageIndex, setEditingImageIndex] = useState<number | null>(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropAspectId, setCropAspectId] = useState<CropAspectId>('original');
  const [cropOffset, setCropOffset] = useState<CropOffset>({ x: 0, y: 0 });
  const [cropImageSize, setCropImageSize] = useState({ width: 0, height: 0 });
  const [cropBoxSize, setCropBoxSize] = useState({ width: 0, height: 0 });
  const [cropStageSize, setCropStageSize] = useState({ width: 0, height: 0 });
  const [quotedPost, setQuotedPost] = useState<PostWithAuthor | null>(initialQuotedPost || null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewsRef = useRef<string[]>([]);
  const previewOriginalsRef = useRef<string[]>([]);
  const cropStageRef = useRef<HTMLDivElement>(null);
  const cropBoxRef = useRef<HTMLDivElement>(null);
  const cropImageElementRef = useRef<HTMLImageElement | null>(null);
  const cropDragRef = useRef<CropDragState>({ dragging: false, startX: 0, startY: 0, baseX: 0, baseY: 0 });
  const cropPointersRef = useRef<Map<number, CropPointer>>(new Map());
  const cropPinchRef = useRef<CropPinchState>({ active: false, startDistance: 0, startZoom: 1 });
  const cropOffsetRef = useRef<CropOffset>({ x: 0, y: 0 });
  const cropZoomRef = useRef(1);
  const cropNativeTouchRef = useRef<{
    active: boolean;
    mode: 'drag' | 'pinch' | null;
    startX: number;
    startY: number;
    startMidX: number;
    startMidY: number;
    startDistance: number;
    startZoom: number;
    baseX: number;
    baseY: number;
  }>({
    active: false,
    mode: null,
    startX: 0,
    startY: 0,
    startMidX: 0,
    startMidY: 0,
    startDistance: 0,
    startZoom: 1,
    baseX: 0,
    baseY: 0,
  });
  const cropRafRef = useRef<number | null>(null);
  const suppressPointerUntilRef = useRef(0);

  // 公開範囲用ステート (追加)
  const [visibility, setVisibility] = useState<'public' | 'following'>('public');

  // メンション・ハッシュタグ機能用ステートとRef
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<any[]>([]);
  const [hashtagQuery, setHashtagQuery] = useState<string | null>(null); // 追加
  const [hashtagResults, setHashtagResults] = useState<any[]>([]); // 追加
  const [cursorPosition, setCursorPosition] = useState(0);
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 }); // 汎用的な名に変更
  const [scrollTop, setScrollTop] = useState(0);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cropOffsetRef.current = cropOffset;
  }, [cropOffset]);

  useEffect(() => {
    cropZoomRef.current = cropZoom;
  }, [cropZoom]);

  useEffect(() => {
    if (initialContent) {
      setContent(initialContent);
    }
  }, [initialContent]);

  useEffect(() => {
    if (!quoteId || initialQuotedPost) return;

    let cancelled = false;

    getQuotedPostCached(quoteId).then((post) => {
      if (cancelled) return;

      if (post) {
        setQuotedPost(post);
        return;
      }

      toast.error('引用元の投稿が見つかりませんでした');
      setSearchParams({});
    });

    return () => {
      cancelled = true;
    };
  }, [quoteId, initialQuotedPost, setSearchParams]);

  useEffect(() => {
    if (initialQuotedPost) {
      setQuotedPost(initialQuotedPost);
    }
  }, [initialQuotedPost]);

  // メンション候補の検索ロジック
  useEffect(() => {
    const query = mentionQuery === null ? '' : normalizeSuggestionQuery(mentionQuery);
    if (!query) {
      setMentionResults([]);
      return;
    }

    const cached = getLimitedCache(mentionSuggestionCache, query);
    if (cached) {
      setMentionResults(cached);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .ilike('username', `${query}%`)
        .limit(5);

      if (cancelled) return;

      if (error) {
        console.error('Fetch mention suggestions failed:', error);
        setMentionResults([]);
        return;
      }

      const rows = data || [];
      setLimitedCache(mentionSuggestionCache, query, rows, SUGGESTION_CACHE_LIMIT);
      setMentionResults(rows);
    }, MENTION_SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mentionQuery]);

  // ハッシュタグ候補の検索ロジック (追加)
  useEffect(() => {
    const query = hashtagQuery === null ? '' : normalizeSuggestionQuery(hashtagQuery);
    if (!query) {
      setHashtagResults([]);
      return;
    }

    const cached = getLimitedCache(hashtagSuggestionCache, query);
    if (cached) {
      setHashtagResults(cached);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const { data, error } = await supabase
        .from('hashtags')
        .select('tag')
        .ilike('tag', `${query}%`)
        .order('usage_count', { ascending: false })
        .limit(5);

      if (cancelled) return;

      if (error) {
        console.error('Fetch hashtag suggestions failed:', error);
        setHashtagResults([]);
        return;
      }

      const rows = data || [];
      setLimitedCache(hashtagSuggestionCache, query, rows, SUGGESTION_CACHE_LIMIT);
      setHashtagResults(rows);
    }, HASHTAG_SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hashtagQuery]);

  // 外側クリックで候補を閉じる
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMentionQuery(null);
        setHashtagQuery(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    previewsRef.current = previews;
  }, [previews]);

  useEffect(() => {
    previewOriginalsRef.current = previewOriginals;
  }, [previewOriginals]);

  useEffect(() => {
    return () => {
      const urls = new Set([...previewsRef.current, ...previewOriginalsRef.current]);
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const addImageFiles = useCallback((incomingFiles: File[]) => {
    const imageFiles = incomingFiles.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return false;

    const slots = MAX_IMAGES - previewsRef.current.length;
    if (slots <= 0) {
      toast.error(`画像は最大${MAX_IMAGES}枚までです`);
      return true;
    }

    if (imageFiles.length > slots) {
      toast.error(`画像は最大${MAX_IMAGES}枚までです`);
    }

    const next = imageFiles.slice(0, slots).map((file) => URL.createObjectURL(file));
    setPreviews((current) => [...current, ...next]);
    setPreviewOriginals((current) => [...current, ...next]);
    return true;
  }, []);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardItems = Array.from(event.clipboardData?.items ?? []);
    const imageFiles = clipboardItems
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (imageFiles.length === 0) return;

    event.preventDefault();
    addImageFiles(imageFiles);
  }, [addImageFiles]);

  const editingImageSrc = editingImageIndex !== null ? (previewOriginals[editingImageIndex] ?? previews[editingImageIndex]) : null;
  const selectedCropAspectBase = CROP_ASPECT_OPTIONS.find((option) => option.id === cropAspectId) ?? CROP_ASPECT_OPTIONS[0];
  const selectedCropAspect = selectedCropAspectBase.id === 'original'
    ? {
        ...selectedCropAspectBase,
        width: cropImageSize.width || 1,
        height: cropImageSize.height || 1,
        outputWidth: cropImageSize.width || 1,
        outputHeight: cropImageSize.height || 1,
      }
    : selectedCropAspectBase;

  const cropAspectRatio = selectedCropAspect.width / selectedCropAspect.height || 1;
  const cropFrameSize = (() => {
    const availableWidth = Math.max(1, cropStageSize.width || 560);
    const availableHeight = Math.max(1, cropStageSize.height || 480);
    const maxWidth = Math.min(availableWidth, 620);
    const maxHeight = availableHeight;

    let width = maxWidth;
    let height = width / cropAspectRatio;

    if (height > maxHeight) {
      height = maxHeight;
      width = height * cropAspectRatio;
    }

    return {
      width: Math.max(48, Math.round(width)),
      height: Math.max(48, Math.round(height)),
    };
  })();

  const getCropAspectIconSize = (option: (typeof CROP_ASPECT_OPTIONS)[number]) => {
    if (option.id !== 'original' || !cropImageSize.width || !cropImageSize.height) {
      return { width: option.iconWidth, height: option.iconHeight };
    }

    const ratio = cropImageSize.width / cropImageSize.height;
    const maxWidth = 24;
    const maxHeight = 20;

    if (ratio >= maxWidth / maxHeight) {
      return { width: maxWidth, height: Math.max(10, Math.round(maxWidth / ratio)) };
    }

    return { width: Math.max(10, Math.round(maxHeight * ratio)), height: maxHeight };
  };

  useEffect(() => {
    if (!editingImageSrc) return;

    const previous = {
      bodyOverflow: document.body.style.overflow,
      htmlOverflow: document.documentElement.style.overflow,
      bodyOverscrollBehavior: document.body.style.overscrollBehavior,
      htmlOverscrollBehavior: document.documentElement.style.overscrollBehavior,
      bodyTouchAction: document.body.style.touchAction,
      htmlTouchAction: document.documentElement.style.touchAction,
      bodyUserSelect: document.body.style.userSelect,
      htmlUserSelect: document.documentElement.style.userSelect,
    };

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.style.overscrollBehavior = 'none';
    document.body.style.touchAction = 'none';
    document.documentElement.style.touchAction = 'none';
    document.body.style.userSelect = 'none';
    document.documentElement.style.userSelect = 'none';

    document.body.classList.add('limenote-crop-editor-open');
    document.documentElement.classList.add('limenote-crop-editor-open');

    const style = document.createElement('style');
    style.setAttribute('data-limenote-crop-editor-lock', 'true');
    style.textContent = `
      html.limenote-crop-editor-open,
      body.limenote-crop-editor-open {
        overflow: hidden !important;
        overscroll-behavior: none !important;
        touch-action: none !important;
        -webkit-user-select: none !important;
        user-select: none !important;
      }

      .limenote-crop-editor-overlay,
      .limenote-crop-editor-overlay * {
        touch-action: none !important;
        -webkit-user-select: none !important;
        user-select: none !important;
        -webkit-touch-callout: none !important;
      }
    `;
    document.head.appendChild(style);

    const preventNativeGesture = (event: Event) => {
      // iOS Safari のページ全体ズームだけ止める。stopPropagation すると画像枠側のピンチ処理まで止まる。
      if (event.cancelable) event.preventDefault();
    };

    const preventEditorTouchZoom = (event: TouchEvent) => {
      if (event.touches.length < 2) return;
      // 2本指ジェスチャーをブラウザズームへ渡さない。ただし画像枠側のtouch handlerには届かせる。
      if (event.cancelable) event.preventDefault();
    };

    const preventCtrlWheelZoom = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      if (event.cancelable) event.preventDefault();
    };

    const options: AddEventListenerOptions = { passive: false, capture: true };
    const gestureTargets: Array<Window | Document | HTMLElement> = [window, document, document.documentElement, document.body];

    gestureTargets.forEach((target) => {
      target.addEventListener('gesturestart', preventNativeGesture as EventListener, options);
      target.addEventListener('gesturechange', preventNativeGesture as EventListener, options);
      target.addEventListener('gestureend', preventNativeGesture as EventListener, options);
      target.addEventListener('touchstart', preventEditorTouchZoom, options);
      target.addEventListener('touchmove', preventEditorTouchZoom, options);
      target.addEventListener('wheel', preventCtrlWheelZoom as EventListener, options);
    });

    return () => {
      document.body.style.overflow = previous.bodyOverflow;
      document.documentElement.style.overflow = previous.htmlOverflow;
      document.body.style.overscrollBehavior = previous.bodyOverscrollBehavior;
      document.documentElement.style.overscrollBehavior = previous.htmlOverscrollBehavior;
      document.body.style.touchAction = previous.bodyTouchAction;
      document.documentElement.style.touchAction = previous.htmlTouchAction;
      document.body.style.userSelect = previous.bodyUserSelect;
      document.documentElement.style.userSelect = previous.htmlUserSelect;
      document.body.classList.remove('limenote-crop-editor-open');
      document.documentElement.classList.remove('limenote-crop-editor-open');
      style.remove();

      gestureTargets.forEach((target) => {
        target.removeEventListener('gesturestart', preventNativeGesture as EventListener, options);
        target.removeEventListener('gesturechange', preventNativeGesture as EventListener, options);
        target.removeEventListener('gestureend', preventNativeGesture as EventListener, options);
        target.removeEventListener('touchstart', preventEditorTouchZoom, options);
        target.removeEventListener('touchmove', preventEditorTouchZoom, options);
        target.removeEventListener('wheel', preventCtrlWheelZoom as EventListener, options);
      });
    };
  }, [editingImageSrc]);

  const getCropBoxSize = useCallback(() => {
    const rect = cropBoxRef.current?.getBoundingClientRect();
    return {
      width: cropBoxSize.width || rect?.width || 320,
      height: cropBoxSize.height || rect?.height || 320,
    };
  }, [cropBoxSize.height, cropBoxSize.width]);

  const clampCropOffset = useCallback((nextOffset: CropOffset, nextZoom = cropZoom) => {
    if (!cropImageSize.width || !cropImageSize.height) return nextOffset;

    const box = getCropBoxSize();
    const baseScale = cropAspectId === 'original'
      ? Math.min(box.width / cropImageSize.width, box.height / cropImageSize.height)
      : Math.max(box.width / cropImageSize.width, box.height / cropImageSize.height);
    const scale = baseScale * nextZoom;
    const renderedWidth = cropImageSize.width * scale;
    const renderedHeight = cropImageSize.height * scale;
    const maxX = Math.max(0, (renderedWidth - box.width) / 2);
    const maxY = Math.max(0, (renderedHeight - box.height) / 2);

    return {
      x: Math.min(maxX, Math.max(-maxX, nextOffset.x)),
      y: Math.min(maxY, Math.max(-maxY, nextOffset.y)),
    };
  }, [cropAspectId, cropImageSize.height, cropImageSize.width, cropZoom, getCropBoxSize]);

  const applyCropTransformRaf = useCallback((nextZoom: number, nextOffset: CropOffset) => {
    if (cropRafRef.current !== null) {
      window.cancelAnimationFrame(cropRafRef.current);
    }

    cropRafRef.current = window.requestAnimationFrame(() => {
      cropRafRef.current = null;
      setCropZoom(nextZoom);
      setCropOffset(nextOffset);
    });
  }, []);

  const openImageEditor = useCallback((index: number) => {
    cropPointersRef.current.clear();
    cropNativeTouchRef.current.active = false;
    cropNativeTouchRef.current.mode = null;
    cropDragRef.current.dragging = false;
    cropPinchRef.current = { active: false, startDistance: 0, startZoom: 1 };
    if (cropRafRef.current !== null) {
      window.cancelAnimationFrame(cropRafRef.current);
      cropRafRef.current = null;
    }
    cropImageElementRef.current = null;
    setEditingImageIndex(index);
    setCropAspectId('original');
    setCropZoom(1);
    setCropOffset({ x: 0, y: 0 });
    setCropImageSize({ width: 0, height: 0 });
    setCropBoxSize({ width: 0, height: 0 });
    setCropStageSize({ width: 0, height: 0 });
  }, []);

  const closeImageEditor = useCallback(() => {
    cropPointersRef.current.clear();
    cropNativeTouchRef.current.active = false;
    cropNativeTouchRef.current.mode = null;
    cropDragRef.current.dragging = false;
    cropPinchRef.current = { active: false, startDistance: 0, startZoom: 1 };
    if (cropRafRef.current !== null) {
      window.cancelAnimationFrame(cropRafRef.current);
      cropRafRef.current = null;
    }
    cropImageElementRef.current = null;
    setEditingImageIndex(null);
    setCropAspectId('original');
    setCropZoom(1);
    setCropOffset({ x: 0, y: 0 });
    setCropImageSize({ width: 0, height: 0 });
    setCropBoxSize({ width: 0, height: 0 });
    setCropStageSize({ width: 0, height: 0 });
  }, []);

  useEffect(() => {
    if (!editingImageSrc) return;

    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      cropImageElementRef.current = img;
      setCropImageSize({ width: img.naturalWidth, height: img.naturalHeight });
      setCropOffset({ x: 0, y: 0 });
      setCropZoom(1);
    };
    img.onerror = () => {
      if (!cancelled) toast.error('画像を読み込めませんでした');
    };
    img.src = editingImageSrc;

    return () => {
      cancelled = true;
    };
  }, [editingImageSrc]);

  useEffect(() => {
    if (!editingImageSrc || !cropStageRef.current) return;

    const target = cropStageRef.current;
    const updateCropStageSize = () => {
      const rect = target.getBoundingClientRect();
      setCropStageSize({ width: rect.width, height: rect.height });
    };

    updateCropStageSize();

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateCropStageSize) : null;
    observer?.observe(target);
    window.addEventListener('resize', updateCropStageSize);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateCropStageSize);
    };
  }, [editingImageSrc]);

  useEffect(() => {
    if (!editingImageSrc || !cropBoxRef.current) return;

    const target = cropBoxRef.current;
    const updateCropBoxSize = () => {
      const rect = target.getBoundingClientRect();
      setCropBoxSize({ width: rect.width, height: rect.height });
    };

    updateCropBoxSize();

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateCropBoxSize) : null;
    observer?.observe(target);
    window.addEventListener('resize', updateCropBoxSize);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateCropBoxSize);
    };
  }, [cropAspectId, editingImageSrc]);

  useEffect(() => {
    if (editingImageIndex === null) return;
    setCropOffset((current) => clampCropOffset(current, cropZoom));
  }, [clampCropOffset, cropAspectId, cropBoxSize.height, cropBoxSize.width, cropImageSize.height, cropImageSize.width, cropZoom, editingImageIndex]);

  useEffect(() => {
    if (editingImageIndex === null) return;

    const handlePointerMove = (event: PointerEvent) => {
      const pointers = cropPointersRef.current;
      if (Date.now() < suppressPointerUntilRef.current) return;

      if (pointers.has(event.pointerId)) {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }

      if (pointers.size >= 2) {
        event.preventDefault();
        cropDragRef.current.dragging = false;
        const [first, second] = Array.from(pointers.values()) as CropPointer[];
        const distance = getPointerDistance(first, second);

        if (!cropPinchRef.current.active || cropPinchRef.current.startDistance <= 0) {
          cropPinchRef.current = { active: true, startDistance: distance, startZoom: cropZoomRef.current };
          return;
        }

        const nextZoom = clampCropZoomValue(cropPinchRef.current.startZoom * (distance / cropPinchRef.current.startDistance));
        applyCropTransformRaf(nextZoom, clampCropOffset(cropOffsetRef.current, nextZoom));
        return;
      }

      if (!cropDragRef.current.dragging) return;

      event.preventDefault();
      const dx = event.clientX - cropDragRef.current.startX;
      const dy = event.clientY - cropDragRef.current.startY;
      applyCropTransformRaf(
        cropZoomRef.current,
        clampCropOffset({
          x: cropDragRef.current.baseX + dx,
          y: cropDragRef.current.baseY + dy,
        })
      );
    };

    const handlePointerUp = (event: PointerEvent) => {
      const pointers = cropPointersRef.current;
      pointers.delete(event.pointerId);

      if (pointers.size === 0) {
        cropDragRef.current.dragging = false;
        cropPinchRef.current = { active: false, startDistance: 0, startZoom: cropZoomRef.current };
        return;
      }

      if (pointers.size === 1) {
        const remaining = (Array.from(pointers.values()) as CropPointer[])[0];
        cropPinchRef.current = { active: false, startDistance: 0, startZoom: cropZoomRef.current };
        cropDragRef.current = {
          dragging: true,
          startX: remaining.x,
          startY: remaining.y,
          baseX: cropOffsetRef.current.x,
          baseY: cropOffsetRef.current.y,
        };
      }
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      cropPointersRef.current.clear();
      cropDragRef.current.dragging = false;
      cropPinchRef.current = { active: false, startDistance: 0, startZoom: cropZoomRef.current };
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [applyCropTransformRaf, clampCropOffset, editingImageIndex]);

  const startCropGesture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (Date.now() < suppressPointerUntilRef.current) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const pointers = cropPointersRef.current;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2) {
      const [first, second] = Array.from(pointers.values()) as CropPointer[];
      cropDragRef.current.dragging = false;
      cropPinchRef.current = {
        active: true,
        startDistance: getPointerDistance(first, second),
        startZoom: cropZoomRef.current,
      };
      return;
    }

    cropPinchRef.current = { active: false, startDistance: 0, startZoom: cropZoomRef.current };
    cropDragRef.current = {
      dragging: true,
      startX: event.clientX,
      startY: event.clientY,
      baseX: cropOffsetRef.current.x,
      baseY: cropOffsetRef.current.y,
    };
  }, []);

  const applyCropZoom = useCallback((nextZoomValue: number) => {
    const nextZoom = clampCropZoomValue(nextZoomValue);
    setCropZoom(nextZoom);
    setCropOffset((current) => clampCropOffset(current, nextZoom));
  }, [clampCropOffset]);

  const handleCropZoomChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    applyCropZoom(Number(event.target.value));
  }, [applyCropZoom]);

  useEffect(() => {
    if (!editingImageSrc || !cropBoxRef.current) return;

    const target = cropBoxRef.current;

    const midpoint = (first: Touch, second: Touch) => ({
      x: (first.clientX + second.clientX) / 2,
      y: (first.clientY + second.clientY) / 2,
    });

    const handleNativeWheel = (event: WheelEvent) => {
      if (!target.contains(event.target as Node)) return;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      const nextZoom = clampCropZoomValue(cropZoomRef.current - event.deltaY * 0.0014);
      applyCropTransformRaf(nextZoom, clampCropOffset(cropOffsetRef.current, nextZoom));
    };

    const handleNativeTouchStart = (event: TouchEvent) => {
      if (!target.contains(event.target as Node)) return;
      suppressPointerUntilRef.current = Date.now() + 450;
      cropPointersRef.current.clear();
      cropDragRef.current.dragging = false;

      if (event.cancelable) event.preventDefault();
      event.stopPropagation();

      if (event.touches.length >= 2) {
        const [first, second] = [event.touches[0], event.touches[1]];
        const mid = midpoint(first, second);
        cropNativeTouchRef.current = {
          active: true,
          mode: 'pinch',
          startX: first.clientX,
          startY: first.clientY,
          startMidX: mid.x,
          startMidY: mid.y,
          startDistance: getPointerDistance(
            { x: first.clientX, y: first.clientY },
            { x: second.clientX, y: second.clientY }
          ),
          startZoom: cropZoomRef.current,
          baseX: cropOffsetRef.current.x,
          baseY: cropOffsetRef.current.y,
        };
        return;
      }

      const first = event.touches[0];
      cropNativeTouchRef.current = {
        active: true,
        mode: 'drag',
        startX: first.clientX,
        startY: first.clientY,
        startMidX: first.clientX,
        startMidY: first.clientY,
        startDistance: 0,
        startZoom: cropZoomRef.current,
        baseX: cropOffsetRef.current.x,
        baseY: cropOffsetRef.current.y,
      };
    };

    const handleNativeTouchMove = (event: TouchEvent) => {
      if (!target.contains(event.target as Node)) return;
      suppressPointerUntilRef.current = Date.now() + 450;

      if (event.cancelable) event.preventDefault();
      event.stopPropagation();

      const state = cropNativeTouchRef.current;
      if (!state.active) return;

      if (event.touches.length >= 2) {
        const [first, second] = [event.touches[0], event.touches[1]];
        const currentDistance = getPointerDistance(
          { x: first.clientX, y: first.clientY },
          { x: second.clientX, y: second.clientY }
        );
        const currentMid = midpoint(first, second);
        const startDistance = state.mode === 'pinch' && state.startDistance > 0
          ? state.startDistance
          : currentDistance;
        const startZoom = state.mode === 'pinch' ? state.startZoom : cropZoomRef.current;
        const baseX = state.mode === 'pinch' ? state.baseX : cropOffsetRef.current.x;
        const baseY = state.mode === 'pinch' ? state.baseY : cropOffsetRef.current.y;
        const startMidX = state.mode === 'pinch' ? state.startMidX : currentMid.x;
        const startMidY = state.mode === 'pinch' ? state.startMidY : currentMid.y;

        if (state.mode !== 'pinch') {
          cropNativeTouchRef.current = {
            ...state,
            mode: 'pinch',
            startDistance,
            startZoom,
            startMidX,
            startMidY,
            baseX,
            baseY,
          };
        }

        const nextZoom = clampCropZoomValue(startZoom * (currentDistance / Math.max(1, startDistance)));
        const nextOffset = clampCropOffset({
          x: baseX + (currentMid.x - startMidX),
          y: baseY + (currentMid.y - startMidY),
        }, nextZoom);
        applyCropTransformRaf(nextZoom, nextOffset);
        return;
      }

      const first = event.touches[0];
      if (!first) return;

      if (state.mode !== 'drag') {
        cropNativeTouchRef.current = {
          active: true,
          mode: 'drag',
          startX: first.clientX,
          startY: first.clientY,
          startMidX: first.clientX,
          startMidY: first.clientY,
          startDistance: 0,
          startZoom: cropZoomRef.current,
          baseX: cropOffsetRef.current.x,
          baseY: cropOffsetRef.current.y,
        };
        return;
      }

      applyCropTransformRaf(
        cropZoomRef.current,
        clampCropOffset({
          x: state.baseX + (first.clientX - state.startX),
          y: state.baseY + (first.clientY - state.startY),
        })
      );
    };

    const handleNativeTouchEnd = (event: TouchEvent) => {
      if (event.cancelable && event.touches.length > 0) event.preventDefault();
      event.stopPropagation();

      if (event.touches.length === 1) {
        const first = event.touches[0];
        cropNativeTouchRef.current = {
          active: true,
          mode: 'drag',
          startX: first.clientX,
          startY: first.clientY,
          startMidX: first.clientX,
          startMidY: first.clientY,
          startDistance: 0,
          startZoom: cropZoomRef.current,
          baseX: cropOffsetRef.current.x,
          baseY: cropOffsetRef.current.y,
        };
        return;
      }

      cropNativeTouchRef.current.active = false;
      cropNativeTouchRef.current.mode = null;
    };

    const options: AddEventListenerOptions = { passive: false, capture: true };
    target.addEventListener('wheel', handleNativeWheel, options);
    target.addEventListener('touchstart', handleNativeTouchStart, options);
    target.addEventListener('touchmove', handleNativeTouchMove, options);
    target.addEventListener('touchend', handleNativeTouchEnd, options);
    target.addEventListener('touchcancel', handleNativeTouchEnd, options);

    return () => {
      target.removeEventListener('wheel', handleNativeWheel, options);
      target.removeEventListener('touchstart', handleNativeTouchStart, options);
      target.removeEventListener('touchmove', handleNativeTouchMove, options);
      target.removeEventListener('touchend', handleNativeTouchEnd, options);
      target.removeEventListener('touchcancel', handleNativeTouchEnd, options);
    };
  }, [applyCropTransformRaf, clampCropOffset, editingImageSrc]);

  const selectCropAspect = useCallback((nextAspectId: CropAspectId) => {
    setCropAspectId(nextAspectId);

    if (nextAspectId === 'original') {
      // 一番左のアイコンは「原寸」。画像本来の縦横比に戻し、全体が見える状態へ戻す。
      setCropZoom(1);
      setCropOffset({ x: 0, y: 0 });
      return;
    }

    // その他の比率変更ではズームや位置を初期化しない。
    // 画像の位置を保ったまま、変更後の枠内に収まる分だけ補正する。
    window.requestAnimationFrame(() => {
      setCropOffset((current) => clampCropOffset(current, cropZoom));
    });
  }, [clampCropOffset, cropZoom]);

  const saveCroppedImage = useCallback(async () => {
    if (editingImageIndex === null || !editingImageSrc || !cropImageSize.width || !cropImageSize.height) return;

    const box = getCropBoxSize();
    const baseScale = cropAspectId === 'original'
      ? Math.min(box.width / cropImageSize.width, box.height / cropImageSize.height)
      : Math.max(box.width / cropImageSize.width, box.height / cropImageSize.height);
    const scale = baseScale * cropZoom;
    const sourceWidth = Math.min(cropImageSize.width, box.width / scale);
    const sourceHeight = Math.min(cropImageSize.height, box.height / scale);
    const centerX = cropImageSize.width / 2 - cropOffset.x / scale;
    const centerY = cropImageSize.height / 2 - cropOffset.y / scale;
    const sourceX = Math.min(cropImageSize.width - sourceWidth, Math.max(0, centerX - sourceWidth / 2));
    const sourceY = Math.min(cropImageSize.height - sourceHeight, Math.max(0, centerY - sourceHeight / 2));

    const isOriginalUntouched =
      cropAspectId === 'original' &&
      Math.abs(cropZoom - 1) < 0.001 &&
      Math.abs(cropOffset.x) < 0.5 &&
      Math.abs(cropOffset.y) < 0.5;

    if (isOriginalUntouched) {
      const previousUrl = previewsRef.current[editingImageIndex];
      const originalUrl = previewOriginalsRef.current[editingImageIndex] ?? editingImageSrc;
      setPreviews((current) => current.map((src, index) => (index === editingImageIndex ? originalUrl : src)));
      if (previousUrl && previousUrl !== originalUrl) URL.revokeObjectURL(previousUrl);
      closeImageEditor();
      return;
    }

    let img = cropImageElementRef.current;
    if (!img || !img.complete || !img.naturalWidth || !img.naturalHeight) {
      img = new Image();
      await new Promise<void>((resolve, reject) => {
        img!.onload = () => resolve();
        img!.onerror = () => reject(new Error('crop image load failed'));
        img!.src = editingImageSrc;
      });
      cropImageElementRef.current = img;
    }

    const canvas = document.createElement('canvas');
    canvas.width = selectedCropAspect.outputWidth;
    canvas.height = selectedCropAspect.outputHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      toast.error('画像編集に失敗しました');
      return;
    }

    ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) {
      toast.error('画像編集に失敗しました');
      return;
    }

    const nextUrl = URL.createObjectURL(blob);
    const previousUrl = previewsRef.current[editingImageIndex];
    const originalUrl = previewOriginalsRef.current[editingImageIndex];

    setPreviews((current) => current.map((src, index) => (index === editingImageIndex ? nextUrl : src)));
    if (previousUrl && previousUrl !== originalUrl) URL.revokeObjectURL(previousUrl);
    closeImageEditor();
  }, [closeImageEditor, cropImageSize.height, cropImageSize.width, cropOffset.x, cropOffset.y, cropZoom, editingImageIndex, editingImageSrc, getCropBoxSize, cropAspectId, selectedCropAspect.outputHeight, selectedCropAspect.outputWidth]);

  const handleContentChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const pos = e.target.selectionStart;
    setContent(val);
    setCursorPosition(pos);

    const lastAtIdx = val.lastIndexOf('@', pos - 1);
    const lastHashIdx = val.lastIndexOf('#', pos - 1);

    // メンション判定
    if (lastAtIdx !== -1 && (lastHashIdx === -1 || lastAtIdx > lastHashIdx)) {
      const query = val.slice(lastAtIdx + 1, pos);
      if (!query.includes(' ') && !query.includes('\n')) {
        setMentionQuery(query);
        setHashtagQuery(null);
        updatePopupPosition(pos);
        return;
      }
    }
    
    // ハッシュタグ判定 (追加)
    if (lastHashIdx !== -1 && (lastAtIdx === -1 || lastHashIdx > lastAtIdx)) {
      const query = val.slice(lastHashIdx + 1, pos);
      if (!query.includes(' ') && !query.includes('\n')) {
        setHashtagQuery(query);
        setMentionQuery(null);
        updatePopupPosition(pos);
        return;
      }
    }

    setMentionQuery(null);
    setHashtagQuery(null);
  };

  const updatePopupPosition = (pos: number) => {
    if (textareaRef.current) {
      const coords = getCaretCoordinates(textareaRef.current, pos);
      setPopupPos({ 
        top: coords.top + coords.height, 
        left: Math.min(coords.left, 150) 
      });
    }
  };

  const handleScroll = (e: ReactUIEvent<HTMLTextAreaElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  const selectMention = (username: string) => {
    const lastAtIdx = content.lastIndexOf('@', cursorPosition - 1);
    const beforeAt = content.slice(0, lastAtIdx);
    const afterCursor = content.slice(cursorPosition);
    const newContent = `${beforeAt}@${username} ${afterCursor}`;
    setContent(newContent);
    setMentionQuery(null);
    setMentionResults([]);
    if (textareaRef.current) textareaRef.current.focus();
  };

  const selectHashtag = (tag: string) => {
    const lastHashIdx = content.lastIndexOf('#', cursorPosition - 1);
    const beforeHash = content.slice(0, lastHashIdx);
    const afterCursor = content.slice(cursorPosition);
    const newContent = `${beforeHash}#${tag} ${afterCursor}`;
    setContent(newContent);
    setHashtagQuery(null);
    setHashtagResults([]);
    if (textareaRef.current) textareaRef.current.focus();
  };

  const onFile = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    addImageFiles(Array.from(e.target.files ?? []));
    if (fileRef.current) fileRef.current.value = '';
  }, [addImageFiles]);

  const removePreview = useCallback((i: number) => {
    const previewUrl = previewsRef.current[i];
    const originalUrl = previewOriginalsRef.current[i];
    if (previewUrl && previewUrl !== originalUrl) URL.revokeObjectURL(previewUrl);
    if (originalUrl) URL.revokeObjectURL(originalUrl);

    setPreviews((p) => p.filter((_, idx) => idx !== i));
    setPreviewOriginals((p) => p.filter((_, idx) => idx !== i));
    setEditingImageIndex((current) => {
      if (current === null) return null;
      if (current === i) return null;
      return current > i ? current - 1 : current;
    });
  }, []);

  const cancelQuote = useCallback(() => {
    setSearchParams({});
    setQuotedPost(null);
  }, [setSearchParams]);

  const submit = async () => {
    if (!user) return;

    const trimmed = content.trim();
    if (!trimmed) {
      toast.error('本文を入力してください');
      return;
    }
    if (trimmed.length > MAX_LEN) {
      toast.error(`本文は${MAX_LEN}文字以内で入力してください`);
      return;
    }
    try {
      // 投稿処理を先に実行し、確実に完了を待つ (visibilityを追加)
      await mutateAsync({ 
        content: trimmed, 
        imageUrls: previews,
        parentId: quotedPost?.id,
        isQuote: !!quotedPost,
        user_id: user.id,
        visibility: visibility // 追加
      } as any);

      // ハッシュタグの抽出と統計更新 (投稿後に非同期で実行)
      const hashtagRegex = /#([a-zA-Z0-9_\u3041-\u3094\u30a1-\u30fa\u30fc\u4e00-\u9fa5]+)/g;
      const matches = trimmed.match(hashtagRegex);
      if (matches) {
        const uniqueTags = Array.from(new Set(matches.map(tag => tag.slice(1))));
        // 各ハッシュタグの処理。エラーが起きても全体が止まらないように個別にcatch
        uniqueTags.forEach(async (tag) => {
          try {
            await supabase.rpc('upsert_hashtag', { tag_name: tag });
          } catch (e) {
            console.warn(`Hashtag upsert failed for #${tag}:`, e);
          }
        });
      }

      setContent('');
      const urls = new Set([...previewsRef.current, ...previewOriginalsRef.current]);
      urls.forEach((url) => URL.revokeObjectURL(url));
      setPreviews([]);
      setPreviewOriginals([]);
      setVisibility('public'); // リセット
      cancelQuote();
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error("Submission failed:", err);
      /* エラーはHook側で処理されるが、デバッグ用にログ出力 */
    }
  };

  // メンション・ハッシュタグ部分のテキスト色付け描画
  const renderHighlightedText = (text: string) => {
    const regex = /(@[a-zA-Z0-9_]+|#[a-zA-Z0-9_\u3041-\u3094\u30a1-\u30fa\u30fc\u4e00-\u9fa5]+)/g;
    const parts = text.split(regex);
    return parts.map((part, i) => {
      if (part.match(regex)) {
        return <span key={i} className="text-primary ">{part}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  const remaining = MAX_LEN - content.length;
  const overLimit = remaining < 0;

  if (!user) return null;

  return (
    <>
      <div
        className={cn(
        "rounded-3xl bg-card p-5 shadow-soft transition-all duration-300",
        timelineGlass &&
          "border border-border/45 bg-card/70 shadow-none backdrop-blur-2xl supports-[backdrop-filter]:bg-card/60"
      )}
    >
      <div className="flex gap-3">
        <Avatar className="h-11 w-11 border-2 border-primary/30 shrink-0">
          <AvatarImage src={user.avatarUrl} alt={user.displayName} />
          <AvatarFallback>{user.displayName.slice(0, 1)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0 space-y-3 relative" ref={containerRef}>
          
          <div className="relative w-full overflow-hidden">
            {!content && (
              <div className="absolute inset-0 pointer-events-none px-0 py-2 text-[20px] leading-relaxed text-muted-foreground z-0">
                {quotedPost ? "コメントを添えてリポスト" : "いまどうしてる？"}
              </div>
            )}

            <div
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none whitespace-pre-wrap break-words px-0 py-2 text-[20px] leading-relaxed text-foreground z-0"
              style={{ transform: `translateY(-${scrollTop}px)` }}
            >
              {renderHighlightedText(content)}
              {content.endsWith('\n') ? <br /> : null}
            </div>

            <Textarea
              ref={textareaRef}
              value={content}
              onChange={handleContentChange}
              onPaste={handlePaste}
              onScroll={handleScroll}
              rows={3}
              spellCheck={false}
              className="relative z-10 resize-none border-0 bg-transparent px-0 py-2 text-[20px] leading-relaxed shadow-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none outline-none w-full text-transparent selection:bg-[#b4d7ff] selection:text-black dark:selection:bg-[#385474] dark:selection:text-white"
              style={{ color: "transparent", caretColor: "hsl(var(--foreground))" }}
            />
          </div>

          {/* 候補ポップアップ */}
          {(mentionResults.length > 0 && mentionQuery !== null) && (
            <div 
              className={cn("absolute z-[2147483647] w-64 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-xl backdrop-blur-md transition-all duration-150", timelineGlass && "bg-popover/85 backdrop-blur-xl")}
              style={{ top: popupPos.top - scrollTop, left: popupPos.left, zIndex: 2147483647 }}
            >
              <div className="p-2 text-xs font-bold text-muted-foreground bg-muted/30 flex items-center gap-1">
                <AtSign className="w-3 h-3" /> メンションします
              </div>
              {mentionResults.map((result) => (
                <button
                  key={result.id}
                  onClick={() => selectMention(result.username)}
                  className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-accent focus:bg-accent outline-none"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={result.avatar_url} />
                    <AvatarFallback>{result.username[0]}</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold truncate leading-none mb-1">
                      {result.display_name || result.username}
                    </span>
                    <span className="text-xs text-muted-foreground leading-none">
                      @{result.username}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {hashtagResults.length > 0 && hashtagQuery !== null && (
            <div 
              className={cn("absolute z-[2147483647] w-64 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-xl backdrop-blur-md transition-all duration-150", timelineGlass && "bg-popover/85 backdrop-blur-xl")}
              style={{ top: popupPos.top - scrollTop, left: popupPos.left, zIndex: 2147483647 }}
            >
              <div className="p-2 text-xs font-bold text-muted-foreground bg-muted/30 flex items-center gap-1">
                <Hash className="w-3 h-3" /> ハッシュタグを検索
              </div>
              {hashtagResults.map((result, idx) => (
                <button
                  key={idx}
                  onClick={() => selectHashtag(result.tag)}
                  className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-accent focus:bg-accent outline-none"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                    <Hash className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-bold truncate">#{result.tag}</span>
                </button>
              ))}
            </div>
          )}

          {quotedPost && (
            <div className={cn("relative mt-2 overflow-hidden rounded-2xl border border-border/60 bg-muted/20 p-4 transition-all", timelineGlass && "bg-background/35 backdrop-blur-xl")}>
              {!initialQuotedPost && (
                <button
                  type="button"
                  onClick={cancelQuote}
                  className="absolute right-2 top-2 z-10 rounded-full bg-background/80 p-1 backdrop-blur hover:bg-background"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
              
              <div className="flex items-center gap-2 mb-1.5">
                <Avatar className="h-5 w-5">
                  <AvatarImage src={quotedPost.author.avatarUrl} />
                  <AvatarFallback>{quotedPost.author.displayName[0]}</AvatarFallback>
                </Avatar>
                <span className="text-sm font-bold text-foreground truncate">{quotedPost.author.displayName}</span>
                <span className="text-xs text-muted-foreground">@{quotedPost.author.username}</span>
                <span className="text-xs text-muted-foreground">· {formatRelative(quotedPost.createdAt)}</span>
              </div>
              <p className="text-[14px] text-foreground line-clamp-2 leading-snug whitespace-pre-wrap">
                {quotedPost.content}
              </p>
              {quotedPost.imageUrls.length > 0 && (
                <div className="mt-2 text-xs text-accent font-bold">
                  [画像あり]
                </div>
              )}
            </div>
          )}

          {previews.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {previews.map((src, i) => (
                <div key={src} className="relative overflow-hidden rounded-2xl border border-border/60">
                  <img src={src} alt="" className="aspect-square w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => openImageEditor(i)}
                    className="absolute left-1.5 top-1.5 inline-flex items-center rounded-full bg-black/55 px-3 py-1.5 text-xs font-bold text-white shadow-sm backdrop-blur-md transition hover:bg-black/70"
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    onClick={() => removePreview(i)}
                    className="absolute right-1.5 top-1.5 rounded-full bg-background/80 p-1 backdrop-blur transition hover:bg-background"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className={cn("flex items-center justify-between border-t border-border/60 pt-3", timelineGlass && "border-border/40")}>
            <div className="flex items-center gap-2">
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFile} />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-9 rounded-full text-accent hover:bg-accent-soft hover:text-accent"
                onClick={() => fileRef.current?.click()}
                disabled={previews.length >= MAX_IMAGES}
              >
                <ImagePlus className="sm:mr-1.5 h-4 w-4" />
                <span className="hidden sm:inline">画像</span>
              </Button>

              {/* 公開範囲選択 (追加) */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-9 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {visibility === 'public' ? (
                      <>
                        <Globe className="sm:mr-1.5 h-4 w-4" />
                        <span className="hidden sm:inline">全員</span>
                      </>
                    ) : (
                      <>
                        <Users className="sm:mr-1.5 h-4 w-4 text-accent" />
                        <span className="text-accent hidden sm:inline">限定</span>
                      </>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  sideOffset={8}
                  className="z-[2147483647] rounded-xl"
                  style={{ zIndex: 2147483647 }}
                >
                  <DropdownMenuItem onClick={() => setVisibility('public')}>
                    <Globe className="mr-2 h-4 w-4" />
                    全員
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setVisibility('following')}>
                    <Users className="mr-2 h-4 w-4" />
                    フォロー中
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <span className={cn('text-xs tabular-nums', overLimit ? 'font-bold text-destructive' : 'text-muted-foreground')}>
                {remaining}
              </span>
            </div>
            <Button
              type="button"
              onClick={submit}
              disabled={isPending || overLimit || !content.trim()}
              className="rounded-full bg-gradient-primary px-5 font-bold shadow-soft transition hover:shadow-pop"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Send className="mr-1.5 h-4 w-4" />
                  {quotedPost ? '引用ポスト' : 'ポスト'}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
      </div>
      {editingImageSrc && typeof document !== 'undefined' && createPortal(
        <div
          className="limenote-crop-editor-overlay fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/78 p-2 sm:p-3 backdrop-blur-sm"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeImageEditor();
          }}
        >
          <div className="flex h-[min(92svh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-border/60 bg-card text-card-foreground shadow-2xl">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border/60 px-4">
              <button
                type="button"
                onClick={closeImageEditor}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="編集を閉じる"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="text-lg font-black">メディアをトリミング</div>
              <Button type="button" size="sm" className="rounded-full px-4 font-bold" onClick={saveCroppedImage}>
                保存
              </Button>
            </div>

            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2 sm:p-4">
              <div ref={cropStageRef} className="relative mx-auto flex h-full w-full max-w-[620px] items-center justify-center overflow-hidden bg-transparent touch-none select-none">
                <div
                  ref={cropBoxRef}
                  className="relative z-10 cursor-grab overflow-hidden bg-transparent shadow-2xl touch-none select-none active:cursor-grabbing"
                  style={{
                    width: `${cropFrameSize.width}px`,
                    height: `${cropFrameSize.height}px`,
                    maxWidth: '100%',
                    maxHeight: '100%',
                    aspectRatio: `${selectedCropAspect.width} / ${selectedCropAspect.height}`,
                    touchAction: 'none',
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  }}
                  onPointerDown={startCropGesture}
                >
                  <div
                    className="absolute inset-0 bg-center bg-no-repeat"
                    style={{
                      backgroundImage: `url(${editingImageSrc})`,
                      backgroundSize: cropImageSize.width && cropImageSize.height
                        ? (() => {
                            const baseScale = cropAspectId === 'original'
                              ? Math.min((cropBoxSize.width || 320) / cropImageSize.width, (cropBoxSize.height || 320) / cropImageSize.height)
                              : Math.max((cropBoxSize.width || 320) / cropImageSize.width, (cropBoxSize.height || 320) / cropImageSize.height);

                            return `${cropImageSize.width * baseScale * cropZoom}px ${cropImageSize.height * baseScale * cropZoom}px`;
                          })()
                        : 'contain',
                      backgroundPosition: `calc(50% + ${cropOffset.x}px) calc(50% + ${cropOffset.y}px)`,
                    }}
                  />
                  <div className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-accent" />
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 border-t border-border/60 px-3 py-3 sm:gap-3 sm:px-4">
              <div className="flex shrink-0 items-center gap-2">
                {CROP_ASPECT_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => selectCropAspect(option.id)}
                    className={cn(
                      'inline-flex h-9 w-9 items-center justify-center rounded-full transition',
                      cropAspectId === option.id
                        ? 'text-accent'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                    aria-label={`${option.label}でトリミング`}
                    title={option.label}
                  >
                    {(() => {
                      const iconSize = getCropAspectIconSize(option);

                      return (
                        <span
                          className={cn(
                            'block rounded-[3px] border-2',
                            cropAspectId === option.id ? 'border-current' : 'border-current/70'
                          )}
                          style={{ width: `${iconSize.width}px`, height: `${iconSize.height}px` }}
                        />
                      );
                    })()}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => applyCropZoom(cropZoom - 0.15)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="縮小"
              >
                −
              </button>
              <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={cropZoom}
                onChange={handleCropZoomChange}
                className="min-w-0 flex-1 accent-current"
              />
              <button
                type="button"
                onClick={() => applyCropZoom(cropZoom + 0.15)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="拡大"
              >
                +
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export const PostComposer = memo(PostComposerComponent);
PostComposer.displayName = 'PostComposer';
