import { AVATAR_DECORATION_KINDS, type AvatarDecoration, type AvatarDecorationKind } from "@/types/index";
import { supabase } from "@/lib/supabase";
import * as React from "react";
import { memo, forwardRef, useEffect, useState, type ImgHTMLAttributes, useRef, type MutableRefObject, type ReactNode, cloneElement, type ReactElement } from "react";
import { isDeferredPrivateMedia, resolvePrivateMediaUrl, retainPrivateMediaUrl } from "@/lib/privateMediaFetch";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn } from "@/lib/utils";
import { SpaceIcon, useSpaces } from "@/components/spaces/SpaceProvider";
import { type User } from "@/types/index";
import { useInView } from "react-intersection-observer";
import { PostVideoThumbnail } from "@/components/video/PostVideoPlayer";
import { fitLegacyImageFrame, mediaThumbnailUrl } from "@/lib/mediaThumbnail";
import { ChevronRight } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/button";
import { observeElementVisibility, useIsPWA } from "@/hooks/useViewportWidth";

// Batch public profile decoration reads across all visible avatars. No polling.
const santaEntries = new Map<string, { value: AvatarDecoration | null; time: number; owner?: string; listeners: Set<() => void> }>();
const santaQueue = new Set<string>();
let santaTimer: ReturnType<typeof setTimeout> | undefined;
let santaSchemaUnavailable = false;
const santaUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function santaEntry(key: string) {
  let entry = santaEntries.get(key);
  if (!entry) {
    if (santaEntries.size >= 320) {
      const unused = [...santaEntries].find(([, item]) => !item.listeners.size);
      if (unused) santaEntries.delete(unused[0]);
    }
    entry = { value: null, time: 0, listeners: new Set() }; santaEntries.set(key, entry);
  }
  return entry;
}
async function loadSantaAvatars() {
  santaTimer = undefined;
  const pending = [...santaQueue]; santaQueue.clear();
  for (const kind of ['id:', 'src:']) {
    const keys = pending.filter(key => key.startsWith(kind));
    for (let offset = 0; offset < keys.length; offset += 80) {
      const batch = keys.slice(offset, offset + 80);
      const versions = new Map(batch.map(key => [key, santaEntries.get(key)?.time]));
      try {
        const { data, error } = await supabase.from('profiles').select('id, avatar_url, avatar_decoration, avatar_decoration_options')
          .in(kind === 'id:' ? 'id' : 'avatar_url', batch.map(key => key.slice(kind.length)));
        if (error) {
          if (error.code === '42703' || error.code === 'PGRST204') {
            santaSchemaUnavailable = true;
            santaQueue.clear();
            return;
          }
          continue;
        }
        for (const key of batch) {
          const entry = santaEntries.get(key); if (!entry || entry.time !== versions.get(key)) continue;
          const rows = (data || []).filter(row => kind === 'id:' ? row.id === key.slice(3) : row.avatar_url === key.slice(4));
          entry.value = rows.length === 1 ? parseAvatarDecoration(rows[0].avatar_decoration, rows[0].avatar_decoration_options) : null;
          entry.owner = rows.length === 1 ? rows[0].id : undefined;
          entry.time = Date.now(); entry.listeners.forEach(listener => listener());
        }
      } catch { /* A later focus or mount can retry a failed read. */ }
    }
  }
}
function queueSantaAvatar(key: string) {
  if (santaSchemaUnavailable) return;
  santaQueue.add(key);
  santaTimer ??= setTimeout(() => { void loadSantaAvatars(); }, 15);
}
export function parseAvatarDecoration(type: unknown, options?: any): AvatarDecoration | null {
  if (!AVATAR_DECORATION_KINDS.includes(type as AvatarDecorationKind)) return null;
  const bound = (value: unknown, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(-max, Math.min(max, value)) : 0;
  return { type: type as AvatarDecorationKind, angle: bound(options?.angle, 180), x: bound(options?.x, 100), y: bound(options?.y, 100), flip: options?.flip === true };
}
export function setAvatarDecorationSnapshot(userId: string, decoration: AvatarDecoration | null) {
  santaSchemaUnavailable = false;
  santaEntry(`id:${userId}`);
  for (const [key, entry] of santaEntries) if (key === `id:${userId}` || entry.owner === userId) {
    santaQueue.delete(key);
    entry.value = decoration; entry.time = Date.now(); entry.listeners.forEach(listener => listener());
  }
}
export function setAvatarSantaSnapshot(userId: string, _source: string, enabled: boolean) {
  setAvatarDecorationSnapshot(userId, enabled ? parseAvatarDecoration('santa') : null);
}
export function useAvatarDecoration(userId: string, source: string) {
  const key = userId ? santaUuid.test(userId) ? `id:${userId}` : '' : /^https?:\/\//.test(source) ? `src:${source}` : '';
  const subscribe = React.useCallback((listener: () => void) => {
    if (!key) return () => {};
    const entry = santaEntry(key); entry.listeners.add(listener);
    if (Date.now() - entry.time > 60000) queueSantaAvatar(key);
    return () => { entry.listeners.delete(listener); };
  }, [key]);
  const snapshot = React.useCallback(() => key ? santaEntry(key).value : null, [key]);
  return React.useSyncExternalStore(subscribe, snapshot, () => null);
}
export function useAvatarSanta(userId: string, source: string) {
  return useAvatarDecoration(userId, source)?.type === 'santa';
}
export const AVATAR_DECORATIONS: { type: AvatarDecorationKind; label: string; symbol: string; file: string; left: number; top: number; width: number; height: number }[] = [
  {type:'santa',label:'サンタ',symbol:'🎅',file:'santa-hat.svg',left:-34,top:-25,width:125,height:125},
  {type:'sunglasses',label:'サングラス',symbol:'😎',file:'decoration-sunglasses.svg',left:-2,top:34,width:104,height:40},
  {type:'censored',label:'口元の記号',symbol:'🤬',file:'decoration-censored.svg',left:18,top:55,width:66,height:25},
  {type:'sleep',label:'Zzz',symbol:'💤',file:'decoration-sleep.svg',left:-16,top:-14,width:50,height:58},
];
export function AvatarDecorationOverlay({decoration}: {decoration: AvatarDecoration}) {
  const item = AVATAR_DECORATIONS.find(item => item.type === decoration.type);
  if (!item) return null;
  return <img src={`${import.meta.env.BASE_URL}${item.file}`} data-avatar-decoration={item.type} alt="" aria-hidden="true" draggable={false}
    className="pointer-events-none absolute z-10 max-w-none select-none object-contain"
    style={{left:`${item.left + decoration.x}%`,top:`${item.top + decoration.y}%`,width:`${item.width}%`,height:`${item.height}%`,transform:`rotate(${decoration.angle}deg) scaleX(${decoration.flip ? -1 : 1})`}}/>;
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const refreshSanta = () => {
    if (document.visibilityState === 'hidden') return;
    for (const [key, entry] of santaEntries) if (entry.listeners.size && Date.now() - entry.time > 1000) queueSantaAvatar(key);
  };
  window.addEventListener('focus', refreshSanta);
  window.addEventListener('online', refreshSanta);
  document.addEventListener('visibilitychange', refreshSanta);
  import.meta.hot?.dispose(() => {
    window.removeEventListener('focus', refreshSanta);
    window.removeEventListener('online', refreshSanta);
    document.removeEventListener('visibilitychange', refreshSanta);
    clearTimeout(santaTimer); santaQueue.clear();
  });
}

// avatar
// avatar
// twitterAvatar
/** Twitter's avatar suffix selects a thumbnail; omit it to use the uploaded image. */
function twitterAvatarUrl(value: string | undefined): string | undefined {
  if (!value) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'pbs.twimg.com' || !url.pathname.startsWith('/profile_images/')) return value;
    url.pathname = url.pathname.replace(/_(?:normal|bigger|mini|\d+x\d+)(\.[a-z0-9]+)$/i, '$1');
    return url.href;
  } catch { return value; }
}

// avatar
const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & { userId?: string; decoration?: AvatarDecoration | null }
>(({ className, userId, decoration: previewDecoration, children, ...props }, ref) => {
  const image = React.Children.toArray(children).find(child => React.isValidElement<{src?: string}>(child) && typeof child.props.src === 'string') as React.ReactElement<{src?: string}> | undefined;
  const storedDecoration = useAvatarDecoration(previewDecoration === undefined ? userId ?? '' : '', previewDecoration === undefined ? image?.props.src ?? '' : '');
  const decoration = previewDecoration === undefined ? storedDecoration : previewDecoration;
  const { spaces, open } = useSpaces();
  const live = userId ? spaces.find(space => space.host_id === userId) : undefined;
  return (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn("relative isolate flex h-10 w-10 shrink-0 overflow-hidden rounded-full", className, live && 'lime-space-avatar', decoration && 'overflow-visible')}
    {...props}
    {...(live ? {
      role: 'button', tabIndex: 0, 'aria-label': `${live.title}に参加`,
      onClick: (event: React.MouseEvent) => { event.preventDefault(); event.stopPropagation(); open(live.id); },
      onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); open(live.id); } },
    } : {})}
  >{decoration ? <><span className="flex h-full w-full overflow-hidden" style={{borderRadius:'inherit'}}>{children}</span><AvatarDecorationOverlay decoration={decoration}/></> : children}{live && <span aria-hidden="true" className="lime-space-avatar-badge"><SpaceIcon /></span>}</AvatarPrimitive.Root>
); });
Avatar.displayName = AvatarPrimitive.Root.displayName;

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => {
  const src=usePrivateMediaUrl(props.src);
  return <AvatarPrimitive.Image ref={ref} className={cn("aspect-square h-full w-full", className)} {...props} src={twitterAvatarUrl(src)} referrerPolicy={props.referrerPolicy??(/^https:\/\/pbs[.]twimg[.]com\//.test(src??'')?'no-referrer':undefined)} />;
});
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn("flex h-full w-full items-center justify-center rounded-full bg-muted", className)}
    {...props}
  />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

// OfficialBadge
const OfficialBadge = () => {
  return (
    <img
      src="/verified.png" // publicフォルダに置いた画像名
      alt="Official"
      className="ml-1 h-4 w-4 inline-block align-text-bottom"
    />
  );
};

function PrivateAccountBadge({ className = 'h-4 w-4' }: { className?: string }) {
  return <svg role="img" aria-label="非公開アカウント" viewBox="0 0 24 24" className={`inline-block shrink-0 text-current ${className}`}>
    <path fillRule="evenodd" fill="currentColor" d="M6 8.5V6a6 6 0 0 1 12 0v2.5c2.4.7 4 2.7 4 5.5v4a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6v-4c0-2.8 1.6-4.8 4-5.5Zm2.5-.5h7V6a3.5 3.5 0 0 0-7 0v2ZM9 14v2.5h6V14H9Z" />
  </svg>;
}

// ProviderVerificationBadge
/** Reuse LimeNote's badge artwork without changing the account's official status. */
function ProviderVerificationBadge({verification,className='ml-1 h-4 w-4 inline-block align-text-bottom'}:{verification?:User['providerVerification'];className?:string}){
 if(!verification)return null;
 return <img src={`${import.meta.env.BASE_URL}verified.png`} alt="twitter認証済み" className={className}/>;
}

// ProfileMediaPreview
// ProfileMediaPreview
// PrivateMediaImage
/** Keep attachment downloads outside the post metadata request. */
function usePrivateMediaUrl(src:string|undefined,enabled=true){
 const [resolved,setResolved]=useState<{input:string;url:string|null}>();
 const deferred=!!src&&isDeferredPrivateMedia(src);
 useEffect(()=>{
  if(!src||!enabled)return;
  if(!deferred)return retainPrivateMediaUrl(src);
  let active=true,release=()=>{};
  void resolvePrivateMediaUrl(src).then(url=>{if(active){if(url)release=retainPrivateMediaUrl(url);setResolved({input:src,url});}}).catch(()=>{if(active)setResolved({input:src,url:null});});
  return()=>{active=false;release();};
 },[src,deferred,enabled]);
 return deferred?(resolved?.input===src?resolved.url??undefined:undefined):src;
}
const PrivateMediaImage=forwardRef<HTMLImageElement,ImgHTMLAttributes<HTMLImageElement>>(({src,...props},ref)=>{
 const pwa=useIsPWA(),element=useRef<HTMLImageElement|null>(null);
 const [near,setNear]=useState<string>();
 const defer=pwa&&props.loading==='lazy'&&!!src&&isDeferredPrivateMedia(src);
 const ready=!defer||near===src;
 useEffect(()=>{
  if(ready||!element.current)return;
  return observeElementVisibility(element.current,visible=>{if(visible)setNear(src);},'400px 0px');
 },[src,ready]);
 const resolved=usePrivateMediaUrl(src,ready);
 const attach=React.useCallback((node:HTMLImageElement|null)=>{element.current=node;if(typeof ref==='function')ref(node);else if(ref)ref.current=node;},[ref]);
 const [loaded,setLoaded]=useState<string>();
 const framed=!!(props as Record<string,unknown>)['data-lime-media-loading-frame'];
 return <img {...props} ref={attach} src={resolved} style={{...props.style,...(framed&&(!resolved||loaded!==resolved)?{opacity:0}:{} )}} onLoad={event=>{if(framed){fitLegacyImageFrame(event.currentTarget);setLoaded(resolved);}props.onLoad?.(event);}} onError={event=>{if(framed)setLoaded(undefined);props.onError?.(event);}}/>;
});
PrivateMediaImage.displayName='PrivateMediaImage';

// ProfileMediaPreview
/** Preserve grid geometry, releasing decoded images/posters outside the nearby rows. */
const ProfileMediaPreview=memo(function ProfileMediaPreview({src,postId,duration,thumbnail,external}:{src?:string;postId?:string;duration?:number;thumbnail?:string;external?:boolean}){
 const {ref,inView}=useInView({initialInView:false,rootMargin:'400px 0px'});
 return <div ref={ref} className="h-full w-full">{inView&&(duration!==undefined&&postId?<PostVideoThumbnail postId={postId} duration={duration} thumbnail={thumbnail} external={external}/>:src?<PrivateMediaImage src={mediaThumbnailUrl(src)} referrerPolicy={/^https:\/\/pbs[.]twimg[.]com\//.test(src)?'no-referrer':undefined} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async"/>:null)}</div>;
});

// ProfileVirtualizedRow
const PROFILE_VIRTUALIZATION_ROOT_MARGIN = '1600px 0px 1600px 0px';

const useProfileRowVisibility = (
  rowKey: string,
  heightCache: MutableRefObject<Map<string, number>>
) => {
  // initialInView: true にすることで、新しく読み込まれた（＝今まさに
  // 画面付近にある）カードは今まで通り即座にフル描画される。実際に
  // 遠くへスクロールされたと Observer が判定して初めて非表示化される
  // ため、初回表示時のちらつき・見た目の変化は発生しない。
  const { ref: inViewRef, inView } = useInView({
    initialInView: true,
    fallbackInView: true,
    rootMargin: PROFILE_VIRTUALIZATION_ROOT_MARGIN,
  });

  const measureRef = useRef<HTMLDivElement>(null);
  const [placeholderHeight, setPlaceholderHeight] = useState<number | undefined>(
    () => heightCache.current.get(rowKey)
  );

  useEffect(() => {
    if (!inView && placeholderHeight) return;

    const node = measureRef.current;
    if (!node) return;

    const measure = () => {
      const height = node.offsetHeight;
      if (height > 0) {
        heightCache.current.set(rowKey, height);
        setPlaceholderHeight(height);
      }
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    // 画像読み込み完了などでカードの高さが後から変わるケースに備え、
    // 表示中は継続的に高さを追従してキャッシュを更新する。
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(node);

    return () => {
      resizeObserver.disconnect();
    };
  }, [inView, rowKey, heightCache, placeholderHeight]);

  return { inViewRef, measureRef, inView, placeholderHeight };
};

const ProfileVirtualizedListItem = memo(function ProfileVirtualizedListItem({
  rowKey,
  heightCache,
  children,
}: {
  rowKey: string;
  heightCache: MutableRefObject<Map<string, number>>;
  children: ReactNode;
}) {
  const { inViewRef, measureRef, inView, placeholderHeight } = useProfileRowVisibility(rowKey, heightCache);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const attachRow = React.useCallback((node: HTMLDivElement | null) => { rowRef.current = node; inViewRef(node); }, [inViewRef]);
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const play = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string; key?: string }>).detail;
      if (detail?.kind === 'youtube' && detail.key) setPlayingKey(detail.key);
    };
    row.addEventListener('lime-background-media-play', play);
    return () => row.removeEventListener('lime-background-media-play', play);
  }, []);
  useEffect(() => {
    if (!playingKey) return;
    const stop = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key;
      setPlayingKey(current => current === key ? null : current);
    };
    window.addEventListener('lime-background-media-stop', stop);
    return () => window.removeEventListener('lime-background-media-stop', stop);
  }, [playingKey]);

  return (
    <div ref={attachRow} data-lime-profile-row={rowKey}>
      {inView || playingKey || !placeholderHeight ? (
        <div ref={measureRef}>{children}</div>
      ) : (
        <div style={{ height: placeholderHeight ? `${placeholderHeight}px` : undefined }} aria-hidden="true" />
      )}
    </div>
  );
});

// PostTabMenu
type PostTabFilter = 'all' | 'posts';
type PostTabSort = 'latest' | 'popular';
function postTabMenuOffsets(button: { left: number; bottom: number }, label: { left: number; top: number }, viewport: { width: number; height: number }) {
  const left = Math.max(12, Math.min(label.left - 24, viewport.width - 156));
  const top = Math.max(12, Math.min(label.top, viewport.height - 174));
  return { alignOffset: left - button.left, sideOffset: top - button.bottom };
}
function PostTabMenu({ children, filter, sort, onFilterChange, onSortChange }: {
  children: ReactElement; filter: PostTabFilter; sort: PostTabSort;
  onFilterChange: (filter: PostTabFilter) => void; onSortChange: (sort: PostTabSort) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const [offsets, setOffsets] = useState({ alignOffset: 0, sideOffset: 0 });
  const changeOpen = (value: boolean) => {
    if (value && anchor.current) {
      const button = anchor.current.getBoundingClientRect();
      const label = anchor.current.querySelector('[data-lime-tab-label]')?.getBoundingClientRect() ?? { left: button.left + 28, top: button.top + button.height / 2 - 8 };
      setOffsets(postTabMenuOffsets(button, label, { width: window.innerWidth, height: window.innerHeight }));
    }
    setOpen(value);
    if (!value) setSortOpen(false);
  };
  const ios = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  if (ios) return <span className={`relative flex h-full flex-1 items-stretch ${children.props.className?.includes('min-w-max') ? 'min-w-max shrink-0' : 'min-w-0'}`}>
    {cloneElement(children, { className: `${children.props.className ?? ''} w-full h-full` })}
    <select aria-label="ポストの表示" value={filter}
      className="absolute inset-0 z-10 h-full w-full cursor-pointer text-base opacity-0"
      onChange={event => onFilterChange(event.target.value as PostTabFilter)}>
      <option value="all">すべて</option>
      <option value="posts">ポスト</option>
    </select>
  </span>;
  return <DropdownMenu open={open} onOpenChange={changeOpen}>
    <DropdownMenuTrigger asChild>{cloneElement(children, { ref: anchor, 'data-lime-post-tab-menu-anchor': '', 'data-state': 'active', 'aria-haspopup': 'menu', 'aria-expanded': open, onPointerDown: (event: React.PointerEvent) => { event.preventDefault(); }, onClick: () => changeOpen(!open) })}</DropdownMenuTrigger>
    <DropdownMenuContent align="start" side="bottom" {...offsets} avoidCollisions={false}
      className="relative overflow-visible w-[144px] rounded-[12px] border-0 bg-popover p-0 shadow-[0_1px_14px_rgba(0,0,0,0.18)]"
      onEscapeKeyDown={event => { if (sortOpen) { event.preventDefault(); setSortOpen(false); } }}>
      <DropdownMenuItem className="min-h-10 justify-between rounded-none px-[14px] py-2.5 text-sm font-bold first:rounded-t-[12px]" disabled={sortOpen} onSelect={() => { if (!sortOpen) onFilterChange('all'); }}>すべて{filter === 'all' && <span className="text-primary" aria-label="選択中">✓</span>}</DropdownMenuItem>
      <DropdownMenuItem className="min-h-10 justify-between rounded-none px-[14px] py-2.5 text-sm font-bold" disabled={sortOpen} onSelect={() => { if (!sortOpen) onFilterChange('posts'); }}>ポスト{filter === 'posts' && <span className="text-primary" aria-label="選択中">✓</span>}</DropdownMenuItem>
      <DropdownMenuSeparator className="m-0 bg-border/60" />
      <DropdownMenuItem disabled={sortOpen} aria-expanded={sortOpen} aria-haspopup="menu" className="min-h-10 justify-between rounded-none rounded-b-[12px] px-[14px] py-2.5 text-sm font-bold"
        onSelect={event => { event.preventDefault(); setSortOpen(value => !value); }}>並び替え<ChevronRight className="h-5 w-5" aria-hidden="true" /></DropdownMenuItem>
      {sortOpen && <div role="group" aria-label="並び替え" ref={element => { (element?.firstElementChild as HTMLElement | null)?.focus(); }} className="absolute -left-[5px] top-[calc(100%-41px)] z-10 w-[156px] overflow-hidden rounded-[12px] bg-popover shadow-[0_1px_14px_rgba(0,0,0,0.18)]">
        <DropdownMenuItem className="min-h-10 justify-between rounded-none px-[14px] py-2.5 text-sm font-bold" onSelect={() => onSortChange('latest')}>新しい順{sort === 'latest' && <span className="text-primary" aria-label="選択中">✓</span>}</DropdownMenuItem>
        <DropdownMenuItem className="min-h-10 justify-between rounded-none px-[14px] py-2.5 text-sm font-bold" onSelect={() => onSortChange('popular')}>人気順{sort === 'popular' && <span className="text-primary" aria-label="選択中">✓</span>}</DropdownMenuItem>
      </div>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

export { Avatar };
export { AvatarImage };
export { AvatarFallback };
export { twitterAvatarUrl };
export { PrivateAccountBadge };
export { OfficialBadge };
export { ProviderVerificationBadge };
export { ProfileMediaPreview };
export { usePrivateMediaUrl };
export { PrivateMediaImage };
export { ProfileVirtualizedListItem };
export { postTabMenuOffsets };
export { PostTabMenu };
export type { PostTabFilter };
export type { PostTabSort };
