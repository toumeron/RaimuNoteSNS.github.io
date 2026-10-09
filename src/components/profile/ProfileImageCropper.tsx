import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X, Check } from 'lucide-react';
import { toast } from 'sonner';
import { uploadProfileMedia } from '@/lib/uploadProfileMedia';
import { Button } from '@/components/ui/button';
export type ProfileImageCropTarget = 'avatar' | 'cover';

type ProfileCropOffset = { x: number; y: number };

const PROFILE_CROP_LIMIT = { min: 1, max: 3 };

interface ProfileImageCropperProps {
  src: string;
  target: ProfileImageCropTarget;
  onApply: (url: string) => void;
  onClose: () => void;
  portalContainer?: HTMLElement;
}

export function ProfileImageCropper({ src, target, onApply, onClose, portalContainer }: ProfileImageCropperProps) {
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
      data-profile-image-cropper
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
    portalContainer ?? document.body
  );
}
