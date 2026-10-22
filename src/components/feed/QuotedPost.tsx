import { ContentLink, Button, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/button";
import { quotePreviewText, pollPercent, pollRemaining, cn, stickerUrl, type CustomSticker, splitStickers, stickersAreInline, draftEmojiName } from "@/lib/utils";
import { PostCard } from "@/components/feed/PostCard";
import { type PostWithAuthor } from "@/types/index";
import { RepostedReplyCard } from "@/components/post/CommentList";
import { PostOverlay } from "@/App";
import { PrivateMediaImage } from "@/components/ui/avatar";
import { readSavedPreview, savePreview, savedPreviewImage, fetchLinkPreview, singlePreviewUrl, previewUrlMatches, type LinkPreview, type OfflineSpaceCard } from "@/lib/mediaThumbnail";
import { useContext, useEffect, useState, createContext, useLayoutEffect, useRef, Fragment, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Globe, Sticker, X, Loader2 } from "lucide-react";
import { ComposerIcon } from "@/components/feed/PostPoll";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/hooks/useViewportWidth";
import { supabase } from "@/lib/supabase";

// QuotedPost
function QuotedPost({ post, timelineGlass = false, compact = false }: { post?: PostWithAuthor | null; timelineGlass?: boolean; compact?: boolean }) {
  if (!post) return <div className="mt-3 rounded-2xl border border-border/60 p-4 text-sm text-muted-foreground">引用元の投稿は削除されたか、閲覧できません。</div>;
  // A quote of a quote shows the immediate quote and its source link, not
  // another recursively embedded card (the API intentionally loads one level).
  const replySource = (post as PostWithAuthor & { quoted_reply_id?: string }).quoted_reply_id;
  const sourceId = post.parentId || post.parentPost?.id || (replySource ? `reply:${replySource}` : null);
  const sourceUrl = sourceId ? new URL(`${import.meta.env.BASE_URL}post/${encodeURIComponent(sourceId)}`, window.location.origin).href : null;
  const preview = post.isQuote ? { ...post, isQuote: false, parentPost: null, content: sourceUrl && !post.content.includes(sourceUrl) ? `${post.content} ${sourceUrl}`.trim() : post.content } : post;
  const hasPhoto=(post.imageUrls??[]).some(url=>url!==post.linkPreview?.image)||/https?:\/\/\S+\.(?:png|jpe?g|gif|webp)(?:[?#]\S*)?/i.test(post.content);
  const hasText=!!post.content.replace(/https?:\/\/\S+/g,'').trim();
  const boundedPreview={...preview,content:quotePreviewText(preview.content)};
  return (
    <div data-lime-quoted-post data-lime-quote-image-text={hasPhoto&&hasText||undefined} data-lime-quote-preview={compact || undefined} className="mt-3 overflow-hidden rounded-2xl border border-border/60" onClick={event => event.stopPropagation()}>
      {post.replyId ? <RepostedReplyCard post={boundedPreview} embedded /> : <PostCard post={boundedPreview} timelineGlass={timelineGlass} thread embedded />}
    </div>
  );
}

// QuoteModal
// Reuse the same desktop overlay and mobile full-screen composer as a regular post.
function QuoteModal({ post, onClose }: { post: PostWithAuthor; onClose: () => void }) {
  return <PostOverlay isOpen initialQuotedPost={post} onClose={onClose} />;
}

// ExternalPostDetails
function ExternalPostDetails({post}:{post:PostWithAuthor}){
 const details=post.externalDetails;if(!details||!details.poll&&!details.communityNote)return null;
 const poll=details.poll,total=poll?.options.reduce((sum,option)=>sum+option.votes,0)??0;
 return <div onClick={event=>event.stopPropagation()}>
  {poll&&<section aria-label="twitterの投票" className="my-4">
   <div className="space-y-2">{poll.options.map((option,index)=>{const percent=pollPercent(option.votes,total);return <div key={index} className="relative flex min-h-11 items-center justify-between overflow-hidden rounded-md px-3 py-2"><div aria-hidden="true" className="absolute inset-y-0 left-0 rounded-md bg-foreground/15" style={{width:`${Math.max(1,percent)}%`}}/><span className="relative min-w-0 break-words">{option.label}</span><span className="relative ml-2 shrink-0 tabular-nums">{percent}%</span></div>;})}</div>
   <p className="mt-3 text-xs text-muted-foreground">{total.toLocaleString()}票 · {pollRemaining(poll.endsAt)}</p>
   {Date.parse(poll.endsAt)>Date.now()&&<a className="mt-2 inline-block text-sm text-primary hover:underline" href={post.blueskyUrl} target="_blank" rel="noopener noreferrer">twitterで投票する</a>}
  </section>}
  {details.communityNote&&<section aria-label="コミュニティノート" className="my-3 rounded-xl border border-border p-3 text-sm"><p className="mb-1 font-semibold">コミュニティノート</p><p className="whitespace-pre-wrap break-words">{details.communityNote}</p></section>}

 </div>;
}

// PostImages
function PostImages({
  urls,
  altTexts,
  onImageError,
  embedded = false,
}: {
  urls?: string[],
  altTexts?: string[],
  onImageError?: (url: string) => void
  embedded?: boolean
}) {
  // urlsがnull、undefined、または空配列の場合は何も表示しない
  if (!urls || urls.length === 0) return null;

  const layouts: Record<number, string> = {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
    3: 'grid-cols-2',
    4: 'grid-cols-2',
  };

  return (
    <div data-lime-post-image-grid className={cn('mt-3 grid overflow-hidden', embedded ? 'gap-1' : 'gap-1.5 rounded-2xl border border-border/60', layouts[urls.length] || 'grid-cols-2')}>
      {urls.map((src, i) => (
        <div
          key={i}
          className={cn(
            'relative aspect-square w-full overflow-hidden bg-background',
            urls.length === 3 && i === 0 && 'row-span-2 aspect-auto',
          )}
        >
          <PrivateMediaImage
            data-lime-media-loading-frame
            referrerPolicy={/^https:\/\/pbs[.]twimg[.]com\//.test(src)?'no-referrer':undefined} src={src}
            alt={altTexts?.[i]??''}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
            onError={(e) => {
              // Keep the reserved slot even when an attachment cannot be fetched.
              (e.target as HTMLImageElement).style.opacity = '0';
            }}
          />
        </div>
      ))}
    </div>
  );
}

// LinkPreviewCard
function useLinkPreview(content:string,enabled=true,provided?:LinkPreview,persist=true,request=true) {
  const {user,loading}=useAuth();
  const url=singlePreviewUrl(content);
  const saved=url&&persist?readSavedPreview(url):undefined;
  const providedMatches=previewUrlMatches(url,provided?.url);
  const seed=saved?.preview??(providedMatches?{...provided!,url:url!}:null);
  const offline=useContext(OfflineBookmarkContext);
  const [failed,setFailed]=useState<string|null>(null);
  // The reader requires a session. An anonymous result from the auth-loading
  // frame must not suppress the card after login or an account switch.
  const query=useQuery({queryKey:[persist?'link-preview-saved-v7':'link-preview-live-v7',user?.id??null,url],queryFn:()=>fetchLinkPreview(url!,persist),enabled:enabled&&request&&!loading&&!!user&&!!url&&!offline&&!seed,initialData:saved?.preview,staleTime:persist&&saved?.preview?Infinity:60_000,gcTime:86400000,retry:1});
  useEffect(()=>{if(persist&&enabled&&request&&url&&providedMatches&&!offline&&!saved)savePreview(url,{...provided!,url});},[persist,enabled,request,url,provided,providedMatches,offline,saved]);
  const resolved=enabled&&url?(offline?offline.linkPreviews?.[url]??seed:seed??query.data):null;
  const preview=resolved&&failed===url?{...resolved,image:''}:resolved;
  return {preview:preview??null,cacheImage:persist&&!offline,onImageError:()=>setFailed(url),text:(text:string)=>preview?text.replace(url!, '').replace(content.match(/https?:\/\/[^\s<>"\u3000]+/i)?.[0]??url!, '').trim():text};
}
function LinkPreviewCard({preview,onImageError,cacheImage=true}:{preview:LinkPreview|null;onImageError?:()=>void;cacheImage?:boolean}) {
  if(!preview)return null;
  return <ContentLink href={preview.url} target="_blank" rel="noopener noreferrer" onClick={event=>event.stopPropagation()} className="mt-3 block w-full max-w-[420px] overflow-hidden rounded-2xl border border-border bg-background text-foreground hover:bg-muted/30" aria-label={preview.title} data-link-preview>
    {preview.image&&<SavedImage image={preview.image} cacheImage={cacheImage} alt="" loading="lazy" referrerPolicy="no-referrer" onError={onImageError} className={"block aspect-[2.4/1] max-h-[175px] w-full "+(/(^|\.)amazon\.co\.jp$/.test(preview.domain)?"bg-white object-contain":"object-cover")} />}
    <div className="px-3 py-2"><div className="truncate text-sm text-muted-foreground">{preview.domain}</div><div className="mt-1 line-clamp-2 text-sm leading-snug">{preview.title}</div>{preview.description&&<div className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{preview.description}</div>}</div>
  </ContentLink>;
}

function SavedImage({image,cacheImage,onError,...props}:{image:string;cacheImage:boolean;onError?:()=>void;alt:string;loading:'lazy';referrerPolicy:'no-referrer';className:string}){
 const [loaded,setLoaded]=useState<{image:string;src:string}|null>(null);
 useEffect(()=>{
  if(!cacheImage||!/^https?:\/\//.test(image))return;
  let active=true,objectUrl:string|undefined;
  savedPreviewImage(image).then(blob=>{if(!active)return;objectUrl=blob?URL.createObjectURL(blob):undefined;setLoaded({image,src:objectUrl??image});});
  return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[image,cacheImage]);
 const src=cacheImage&&loaded?.image===image?loaded.src:image;
 return <img {...props} src={src} onError={onError}/>;
}

function PostLinkPreview({content}:{content:string}){const state=useLinkPreview(content);return <LinkPreviewCard {...state}/>;}

// PostSourceLabel
const PostSourceLabelVisibility=createContext(true);
function PostSourceLabel({post,small=false}:{post:{id:string;source?:string};small?:boolean}){
 const visible=useContext(PostSourceLabelVisibility);
 if(!visible)return null;
 const label=post.source==='x'||post.id.startsWith('x:')?'twitter':post.source==='misskey'||post.id.startsWith('misskey:')?'Misskey':post.source==='bluesky'||post.id.startsWith('bsky:')?'Bluesky':null;
 if(!label)return null;
 return <div data-lime-post-provider className="mt-1.5 flex items-center gap-1 text-muted-foreground/70"><Globe className="h-3.5 w-3.5"/><span className={small?'text-[13px] font-medium':'text-[15px] font-medium'}>{label}</span></div>;
}

// AnimatedCount
// Match LikeButton's 300ms vertical count transition in both directions.
function AnimatedCount({count}:{count:number}) {
  const value=Math.max(0,Number(count)||0);
  const previous=useRef(value);
  const [transition,setTransition]=useState<{old:number;value:number;version:number}|null>(null);
  useLayoutEffect(()=>{
    if(previous.current===value) return;
    const old=previous.current;
    previous.current=value;
    setTransition(current=>({old,value,version:(current?.version ?? 0)+1}));
  },[value]);
  useEffect(()=>{
    if(!transition) return;
    const timer=window.setTimeout(()=>setTransition(null),320);
    return ()=>window.clearTimeout(timer);
  },[transition]);
  const format=(n:number)=> n===0 ? '' : n>=10000 ? `${(n/10000).toFixed(1).replace(/\.0$/,'')}万` : n.toLocaleString();
  return <span aria-label={format(value)} className={`repost-count ${transition ? transition.value>transition.old ? 'is-up' : 'is-down' : ''}`}>
    {transition ? <span key={transition.version} className="repost-count-layers" aria-hidden="true"><span className="repost-count-old">{format(transition.old)}</span><span className="repost-count-new">{format(transition.value)}</span></span> : <span>{format(value)}</span>}
  </span>;
}

export { QuotedPost };
export { QuoteModal };
export { ExternalPostDetails };
export { PostImages };
export { useLinkPreview };
export { LinkPreviewCard };
export { PostLinkPreview };
export { PostSourceLabel };
export { PostSourceLabelVisibility };
export { AnimatedCount };


// Stickers
// OfflineBookmarkContext
const OfflineBookmarkContext=createContext<{bookmarkIds:string[];linkPreviews?:Record<string,LinkPreview|null>;emojis:CustomSticker[];spaces:Record<string,OfflineSpaceCard|null>;media:Map<string,string>}|null>(null);

// Stickers
function useStickers(enabled=true) {
  return useQuery({queryKey:['custom-stickers'],enabled,staleTime:60000,queryFn:async()=>{
    const {data,error}=await supabase.from('custom_emojis').select('id,name,public_id,format').order('name');
    if(error)throw error; return (data||[]) as CustomSticker[];
  }});
}
function StickerImage({name,inline=false}:{name:string;inline?:boolean}) {
  const offline=useContext(OfflineBookmarkContext);const {data}=useStickers(!offline);const sticker=(offline?.emojis??data)?.find(s=>s.name===name);const src=sticker&&stickerUrl(sticker);
  return src?<img data-lime-sticker src={offline?.media.get(src)??src} alt={`${name}のスタンプ`} loading="lazy" data-lime-sticker-inline={inline} className={`inline-block max-w-full object-contain align-middle ${inline?'h-6 w-6':'my-1 h-36 w-36'}`}/>:<span className="text-sm text-muted-foreground">{name}のスタンプ</span>;
}
function StickerPicker({onSelect,disabled=false,iconOnly=false,simple=false,className=''}:{onSelect:(name:string)=>void;disabled?:boolean;iconOnly?:boolean;simple?:boolean;className?:string}) {
  const [open,setOpen]=useState(false),[search,setSearch]=useState('');
  const mobile=useIsMobile();
  const {data,isPending,isError,refetch}=useStickers(open);
  const items=(data||[]).filter(s=>s.name.toLowerCase().includes(search.toLowerCase())&&stickerUrl(s));
  useEffect(()=>{
    if(!open||!mobile)return;
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopImmediatePropagation();setOpen(false);}};
    document.addEventListener('keydown',onKey,true);
    return ()=>document.removeEventListener('keydown',onKey,true);
  },[open,mobile]);
  const trigger=<Button type="button" disabled={disabled} variant="ghost" size="sm" data-lime-composer-tool={simple||undefined} data-lime-attachment-tool aria-label="スタンプを選ぶ"
    onPointerDown={event=>event.preventDefault()}
    onClick={mobile?()=>setOpen(true):undefined}
    className={`h-9 [&_svg]:size-5 shrink-0 rounded-full ${simple?'text-muted-foreground hover:bg-transparent hover:text-foreground':'text-primary hover:bg-primary/10 hover:text-primary'} ${iconOnly?'w-9 p-0':''} ${className}`}>
    <>{simple?<ComposerIcon kind="smile"/>:<Sticker className={iconOnly?'h-5 w-5':'h-5 w-5 sm:mr-1.5'}/>}</>{!iconOnly&&<span className="hidden sm:inline">スタンプ</span>}
  </Button>;
  const contents=<>
    <input aria-label="スタンプを検索" placeholder="スタンプを検索" value={search} onChange={e=>setSearch(e.target.value)} className="mb-2 w-full rounded-full border border-border bg-background px-3 py-2 text-sm"/>
    {isPending?<Loader2 className="mx-auto my-6 h-5 w-5 animate-spin"/>:isError?<button type="button" onClick={()=>refetch()} className="text-sm text-primary">読み込みを再試行</button>:items.length?<div className={`grid gap-2 overflow-y-auto ${mobile?'max-h-[45dvh] grid-cols-4':'max-h-72 grid-cols-4'}`}>
      {items.map(s=><button key={s.id} type="button" aria-label={`${s.name}を選ぶ`} onClick={()=>{onSelect(s.name);setOpen(false);}} className="rounded-xl p-2 hover:bg-muted"><img src={stickerUrl(s)!} alt={s.name} loading="lazy" className="h-14 w-full object-contain"/><span className="block truncate text-xs text-muted-foreground">{s.name}</span></button>)}
    </div>:<p className="py-6 text-center text-sm text-muted-foreground">スタンプがありません</p>}
  </>;
  if(mobile)return <>{trigger}{open&&createPortal(<div className="fixed inset-0 z-[2147483100] flex items-end bg-black/40" onClick={event=>event.stopPropagation()} onPointerDown={event=>{if(event.target===event.currentTarget)setOpen(false);}}>
    <section role="dialog" aria-modal="true" aria-label="スタンプを選択" data-lime-sticker-picker="mobile" className="w-full rounded-t-3xl border-t border-border bg-background p-4 pb-[max(16px,env(safe-area-inset-bottom))] shadow-xl" onFocusCapture={event=>event.stopPropagation()}>
      <div className="mb-3 flex items-center justify-between"><span className="font-bold">スタンプ</span><button type="button" aria-label="スタンプ選択を閉じる" className="rounded-full p-2 hover:bg-muted" onClick={()=>setOpen(false)}><X className="h-5 w-5"/></button></div>{contents}
    </section>
  </div>,document.body)}</>;
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild>{trigger}</PopoverTrigger><PopoverContent data-lime-sticker-picker="desktop" side="top" align="end" className="z-[2147483100] w-96 max-w-[calc(100vw-24px)] p-3" onOpenAutoFocus={e=>e.preventDefault()} onEscapeKeyDown={event=>event.stopPropagation()}>{contents}</PopoverContent></Popover>;
}
function StickerDraft({name,onRemove,inline=false}:{name:string|null;onRemove:()=>void;inline?:boolean}) {
  return name?<div data-lime-sticker-draft className={inline?'mt-2 flex w-fit items-center gap-1':'relative mt-2 w-fit'}><StickerImage name={name} inline={inline}/><button type="button" aria-label="スタンプを外す" onClick={onRemove} className={`${inline?'':'absolute right-0 top-0'} rounded-full bg-background p-1 text-muted-foreground shadow`}><X className="h-4 w-4"/></button></div>:null;
}

function renderStickerText(text:string,renderText:(text:string)=>ReactNode):ReactNode {
  const inline=stickersAreInline(text);
  return splitStickers(text).map((part,i)=><Fragment key={i}>{part.name?<StickerImage name={part.name} inline={inline || part.inline}/>:renderText(part.text)}</Fragment>);
}

// Each draft emoji occupies one native text character, so cursor movement,
// selection, deletion and IME composition remain native textarea operations.
function DraftEmojiText({text,renderText=(value)=>value}:{text:string;renderText?:(value:string)=>ReactNode}) {
  return text.split(/([\uE000-\uF8FF])/).map((part,index)=>{
    const name=draftEmojiName(part);
    return <Fragment key={index}>{name?<span data-lime-draft-emoji className="relative inline-block align-baseline"><span className="invisible">{part}</span><span className="pointer-events-none absolute inset-0 flex items-center justify-center [&_img]:!m-0 [&_img]:!h-[1em] [&_img]:!w-full"><StickerImage name={name} inline/></span></span>:renderText(part)}</Fragment>;
  });
}

export { StickerImage };
export { StickerPicker };
export { StickerDraft };
export { renderStickerText };
export { DraftEmojiText };
export { OfflineBookmarkContext };
