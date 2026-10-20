import { useEffect, useRef, useState, type ChangeEvent, useCallback, type PointerEvent as ReactPointerEvent } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage, PrivateAccountBadge } from "@/components/ui/avatar";
import { Button, Input, Label, Textarea, Checkbox, Switch } from "@/components/ui/button";
import { DialogClose, DialogContent, DialogTitle } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useUpdateProfile } from "@/hooks/useFeed";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { z } from "zod";

import { createPortal } from "react-dom";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getUserById, updateProfile, getFollowRequests, respondFollowRequest } from "@/api/users";
import { getNotificationPreferences, setNotificationPreference, notificationLabels, getNotificationSubscriptions, removeNotificationSubscription, type NotificationPreference } from "@/api/users";
import { requestPermissionAndSubscribe } from "@/hooks/useOSNotification";

// ProfileImageCropper
type ProfileImageCropTarget = 'avatar' | 'cover';

type ProfileCropOffset = { x: number; y: number };

const PROFILE_CROP_LIMIT = { min: 1, max: 3 };

interface ProfileImageCropperProps {
  src: string;
  target: ProfileImageCropTarget;
  onApply: (url: string) => void;
  onClose: () => void;
  portalContainer?: HTMLElement;
}

function ProfileImageCropper({ src, target, onApply, onClose, portalContainer }: ProfileImageCropperProps) {
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

// ProfileEditor
const schema = z.object({
  displayName: z.string().trim().min(1, '表示名を入力してください').max(30, '30文字以内で入力してください'),
  bio: z.string().max(160, '自己紹介は160文字以内で入力してください'),
  location: z.string().trim().max(100, '場所は100文字以内で入力してください'),
});

function ProfileEditor({onSaved}:{onSaved:()=>void}) {
 const {user}=useAuth();
 const {mutateAsync,isPending}=useUpdateProfile(user?.id??'');
 const [displayName,setDisplayName]=useState(user?.displayName??'');
 const [bio,setBio]=useState(user?.bio??'');
 const [location,setLocation]=useState(user?.location??'');
 const [avatarUrl,setAvatarUrl]=useState(user?.avatarUrl??'');
 const [coverUrl,setCoverUrl]=useState(user?.coverUrl??'');
 const [errors,setErrors]=useState<Record<string,string>>({});
 const [isProfileLoading,setIsProfileLoading]=useState(true);
 const avatarRef=useRef<HTMLInputElement>(null),coverRef=useRef<HTMLInputElement>(null);
 const [profileCropTarget,setProfileCropTarget]=useState<ProfileImageCropTarget|null>(null);
 const [profileCropSrc,setProfileCropSrc]=useState('');
 const dialogRef=useRef<HTMLDivElement>(null);
 const profileCropObjectUrlRef=useRef<string|null>(null);
 useEffect(()=>{
  let active=true;
  if(user?.id)void Promise.resolve(supabase.from('profiles').select('display_name,bio,location,avatar_url,cover_url').eq('id',user.id).maybeSingle()).then(({data,error})=>{
   if(!active)return;
   if(error){toast.error('プロフィールを読み込めませんでした');return;}
   if(data){setDisplayName(data.display_name??'');setBio(data.bio??'');setLocation(data.location??'');setAvatarUrl(data.avatar_url??'');setCoverUrl(data.cover_url??'');}
  }).catch(()=>{if(active)toast.error('プロフィールを読み込めませんでした');}).finally(()=>{if(active)setIsProfileLoading(false);});
  return()=>{active=false;if(profileCropObjectUrlRef.current)URL.revokeObjectURL(profileCropObjectUrlRef.current);};
 },[user?.id]);
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

 const submit=async()=>{
  const parsed=schema.safeParse({displayName,bio,location});
  if(!parsed.success){const next:Record<string,string>={};parsed.error.issues.forEach(issue=>{next[issue.path[0] as string]=issue.message;});setErrors(next);return;}
  setErrors({});
  try{await mutateAsync({...parsed.data,avatarUrl,coverUrl});toast.success('プロフィールを更新しました');onSaved();}
  catch{toast.error('保存に失敗しました。DBのカラム名を確認してください。');}
 };
 if(!user)return null;
 return <DialogContent ref={dialogRef} onInteractOutside={event=>event.preventDefault()} aria-describedby={undefined} className="profile-editor z-[2147483200] flex h-[90dvh] max-h-[900px] flex-col gap-0 overflow-hidden p-0 [&>button]:hidden max-sm:inset-0 max-sm:data-[state=open]:animate-none max-sm:data-[state=closed]:animate-none max-sm:h-[100dvh] max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0 sm:max-w-2xl">
 <div className="profile-editor-header">
  <DialogClose asChild><Button variant="ghost" size="icon" className="profile-editor-cancel shrink-0 rounded-full" aria-label="閉じる"><X className="hidden h-5 w-5 sm:block" /><span className="sm:hidden">キャンセル</span></Button></DialogClose>
  <DialogTitle className="min-w-0 flex-1 truncate text-base max-[360px]:text-sm sm:text-lg font-bold">プロフィールを編集</DialogTitle>
  <Button onClick={submit} disabled={isPending || isProfileLoading} className="rounded-full bg-foreground px-5 font-bold text-background hover:bg-foreground/90">{isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存する'}</Button>
 </div>
 <div className="profile-editor-scroll" data-profile-editor-scroll>
      <div className="profile-editor-body">
        <div className="relative h-40 bg-gradient-cream sm:h-48">
          {coverUrl && <img src={coverUrl} alt="" className="h-full w-full object-cover" />}
          <button
            type="button"
            onClick={() => coverRef.current?.click()}
            className="absolute inset-0 flex items-center justify-center"
            aria-label="カバー画像を変更"
          >
            <span className="profile-editor-camera"><Camera className="h-5 w-5" /></span>
          </button>
          <input
            ref={coverRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => onPickImage(e, 'cover')}
          />
        </div>

        <div className="profile-editor-details px-5 pb-6 pt-3 sm:px-6">
          <div className="profile-editor-avatar -mt-12 flex items-end gap-3 sm:-mt-14">
            <div className="relative">
              <Avatar className="h-24 w-24 border-4 border-card shadow-pop sm:h-28 sm:w-28">
                <AvatarImage src={avatarUrl} alt={displayName} />
                <AvatarFallback>{displayName.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <button
                type="button"
                onClick={() => avatarRef.current?.click()}
                className="profile-editor-camera absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                aria-label="アイコンを変更"
              >
                <Camera className="h-5 w-5" />
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

          <div className="profile-editor-fields mt-6 space-y-4">
            <div className="profile-editor-field">
              <Label htmlFor="displayName">表示名</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={30}
                className="profile-editor-input"
              />
              {errors.displayName && <p className="text-xs text-destructive">{errors.displayName}</p>}
            </div>

            <div className="profile-editor-field">
              <Label htmlFor="username">ユーザー名</Label>
              <Input id="username" value={user.username} disabled className="profile-editor-input" />
              <p className="text-xs text-muted-foreground">※ ユーザー名は変更できません</p>
            </div>

            <div className="profile-editor-field">
              <Label htmlFor="bio">自己紹介</Label>
              <Textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
                maxLength={200}
                className="profile-editor-input resize-none"
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

            <div className="profile-editor-field">
              <Label htmlFor="profile-location">場所</Label>
              <Input
                id="profile-location"
                disabled={isProfileLoading}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                maxLength={100}
                className="profile-editor-input"
              />
              {errors.location && <p className="text-xs text-destructive">{errors.location}</p>}
            </div>

          </div>
        </div>
      </div>

 </div>
 {profileCropTarget&&profileCropSrc&&<ProfileImageCropper src={profileCropSrc} target={profileCropTarget} onApply={applyProfileCrop} onClose={closeProfileCrop} portalContainer={dialogRef.current??undefined}/>}
 </DialogContent>;
}

// AccountPrivacySettings
function AccountPrivacySettings({userId}:{userId:string}) {
 const qc=useQueryClient();
 const profile=useQuery({queryKey:['account-privacy',userId],queryFn:()=>getUserById(userId)});
 const requests=useQuery({queryKey:['follow-requests',userId],queryFn:getFollowRequests});
 const refresh=async()=>{await Promise.all([qc.invalidateQueries({queryKey:['account-privacy']}),qc.invalidateQueries({queryKey:['profile']}),qc.invalidateQueries({queryKey:['follow-stats']}),qc.invalidateQueries({queryKey:['posts']}),qc.invalidateQueries({queryKey:['auth-user']}),qc.invalidateQueries({queryKey:['desktop-account-profile']}),qc.invalidateQueries({queryKey:['saved-account-profiles']}),qc.invalidateQueries({queryKey:['author-badges']}),qc.invalidateQueries({queryKey:['notifications']}),qc.invalidateQueries({queryKey:['follow-requests']})]);};
 const privacy=useMutation({mutationFn:(enabled:boolean)=>updateProfile(userId,{isPrivate:enabled}),onSuccess:refresh,onError:()=>toast.error('プライバシー設定を保存できませんでした')});
 const respond=useMutation({mutationFn:({id,accept}:{id:string;accept:boolean})=>respondFollowRequest(id,accept),onSuccess:refresh,onError:()=>toast.error('フォローリクエストを更新できませんでした')});
 return <div className="w-full min-w-0 space-y-6 p-5" data-account-privacy-settings>
  <h2 className="font-display text-base font-bold">プライバシー</h2>
  <label className="flex cursor-pointer items-center justify-between gap-4">
   <span className="font-semibold">ポストを非公開</span>
   <Checkbox checked={profile.data?.isPrivate===true} disabled={!profile.data||privacy.isPending} onCheckedChange={checked=>privacy.mutate(checked===true)}/>
  </label>
  {profile.isError&&<p role="alert" className="text-sm text-destructive">設定を取得できませんでした。</p>}
  <div className="space-y-3">
   <h3 className="font-bold">フォローリクエスト</h3>
   {requests.isError?<p role="alert" className="text-sm text-destructive">リクエストを取得できませんでした。</p>:requests.data?.length===0?<p className="text-sm text-muted-foreground">フォローリクエストはありません</p>:null}
   {requests.data?.map(request=><div key={request.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
    <div className="h-10 w-10 shrink-0">{request.avatarUrl&&<img src={request.avatarUrl} alt="" className="h-full w-full rounded-full object-cover"/>}</div>
    <Link to={`/u/${encodeURIComponent(request.username)}`} className="min-w-0 flex-1">
     <span className="flex items-center gap-1 font-bold"><span className="truncate">{request.displayName||request.username}</span>{request.isPrivate&&<PrivateAccountBadge/>}{request.isOfficial&&<img src={`${import.meta.env.BASE_URL}verified.png`} alt="Official" className="h-4 w-4 shrink-0"/>}</span>
     <span className="block truncate text-sm text-muted-foreground">@{request.username}</span>
    </Link>
    <div className="col-span-2 flex flex-wrap justify-end gap-2">
    <Button size="sm" variant="outline" disabled={respond.isPending} onClick={()=>respond.mutate({id:request.id,accept:false})}>拒否</Button>
    <Button size="sm" disabled={respond.isPending} onClick={()=>respond.mutate({id:request.id,accept:true})}>承認</Button>
    </div>
   </div>)}
  </div>
 </div>;
}

// NotificationSettings
function NotificationSettings(){
 const {user}=useAuth();const client=useQueryClient();
 const prefs=useQuery({queryKey:['notification-preferences',user?.id],queryFn:()=>getNotificationPreferences(user!.id),enabled:!!user?.id});
 const targets=useQuery({queryKey:['notification-subscriptions',user?.id],queryFn:()=>getNotificationSubscriptions(user!.id),enabled:!!user?.id});
 const save=useMutation({mutationFn:({kind,enabled}:{kind:NotificationPreference;enabled:boolean})=>setNotificationPreference(kind,enabled),onSuccess:()=>void client.invalidateQueries({queryKey:['notification-preferences',user?.id]}),onError:()=>toast.error('通知設定を保存できませんでした')});
 const remove=useMutation({mutationFn:(id:string)=>removeNotificationSubscription(user!.id,id),onSuccess:()=>{void client.invalidateQueries({queryKey:['notification-subscriptions',user?.id]});void client.invalidateQueries({queryKey:['post-notification-subscription',user?.id]});},onError:()=>toast.error('投稿通知を解除できませんでした')});
 return <section id="notifications" className="scroll-mt-32 rounded-3xl border border-border/60 bg-card p-5 shadow-soft" aria-labelledby="notification-settings-title">
  <h2 id="notification-settings-title" className="mb-3 font-display text-base font-bold">通知設定</h2>
  {prefs.isError?<Button variant="ghost" onClick={()=>void prefs.refetch()}>通知設定を再読み込み</Button>:prefs.isPending?<p className="text-sm text-muted-foreground">読み込み中...</p>:Object.entries(notificationLabels).map(([kind,label])=><div key={kind} className="flex min-h-11 items-center justify-between gap-4 py-2"><label htmlFor={`notify-${kind}`} className="text-sm">{label}</label><Switch id={`notify-${kind}`} checked={prefs.data[kind as NotificationPreference]} disabled={save.isPending} onCheckedChange={enabled=>save.mutate({kind:kind as NotificationPreference,enabled})}/></div>)}
  <Button variant="ghost" className="mt-2 h-auto px-0 py-2 text-sm text-muted-foreground" onClick={()=>{void requestPermissionAndSubscribe(user!.id).then(ok=>toast(ok?'端末への通知を有効にしました':'端末の通知許可を確認してください'));}}>この端末で通知を受け取る</Button>
  <h3 className="mb-2 mt-6 text-sm font-bold">新着ポスト通知をONにしているユーザー</h3>
  {targets.isPending?<p className="text-sm text-muted-foreground">読み込み中...</p>:targets.isError?<Button variant="ghost" onClick={()=>void targets.refetch()}>ユーザー一覧を再読み込み</Button>:targets.data?.length===0?<p className="text-sm text-muted-foreground">通知をONにしているユーザーはいません</p>:targets.data?.map(target=>{const handle=target.profiles?.username??target.external_actor??'';const name=target.profiles?.display_name||target.target_name||handle;return <div key={target.id} className="flex items-center gap-3 border-b border-border/40 py-3"><Link to={`/u/${encodeURIComponent(handle)}`} className="flex min-w-0 flex-1 items-center gap-3"><Avatar className="h-9 w-9"><AvatarImage src={target.profiles?.avatar_url??target.target_avatar_url??undefined}/><AvatarFallback>{name[0]}</AvatarFallback></Avatar><div className="min-w-0"><p className="truncate text-sm font-bold">{name}</p><p className="truncate text-xs text-muted-foreground">@{handle} · {target.provider==='limenote'?'LimeNote':target.provider==='bluesky'?'Bluesky':'Misskey'}</p></div></Link><Button size="sm" variant="outline" disabled={remove.isPending} onClick={()=>remove.mutate(target.id)}>通知をOFF</Button></div>;})}
 </section>;
}

export { ProfileEditor as default };
export { ProfileImageCropper };
export type { ProfileImageCropTarget };
export { AccountPrivacySettings };
export { NotificationSettings };
