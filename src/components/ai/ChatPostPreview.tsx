import { PrivateMediaImage } from "@/components/profile/ProfileMediaPreview";
import { ProviderVerificationBadge, PrivateAccountBadge } from "@/components/common/OfficialBadge";
import { PostPoll } from "@/components/feed/PostPoll";
import { type ReactNode, type ComponentProps } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getPostById } from "@/api/posts";
import { useAuth } from "@/hooks/useAuth";
import { findChatPostLink } from "@/lib/chatImageCache";
import { openMediaViewer } from "@/components/media/openMediaViewer";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { Check, Download, Trash2, Loader2 } from "lucide-react";
import { type GemmaState } from "@/lib/localGemma";

// ChatPostPreview
function ChatPostPreview({content,fallback,disabled=false}:{content:string;fallback:ReactNode;disabled?:boolean}){
 const link=disabled?null:findChatPostLink(content);
 const {user}=useAuth();
 // Fetch as the viewer, rather than trusting a sender's copy of a private post.
 const {data:post}=useQuery({queryKey:['chat-post-preview',link?.id,user?.id],queryFn:()=>getPostById(link!.id),enabled:!!link,staleTime:60_000,retry:false});
 if(!post||!link)return <>{fallback}</>;
 const image=post.imageUrls[0];
 const remaining=content.replace(/https?:\/\/[^\s]+/gi,raw=>findChatPostLink(raw)?.id===link.id?'':raw).trim();
 return <>
  {remaining&&remaining!==content&&<div className="dm-bubble"><p>{remaining}</p></div>}
  <article className="dm-post-preview" aria-label="投稿のプレビュー">
   <Link to={`/post/${post.id}`} className="dm-post-preview-header">
    <Avatar className="dm-avatar"><AvatarImage src={post.author.avatarUrl}/><AvatarFallback>{post.author.displayName[0]}</AvatarFallback></Avatar>
    <strong>{post.author.displayName}</strong>
    {post.author.isPrivate&&<PrivateAccountBadge className="h-4 w-4 shrink-0"/>}
    <ProviderVerificationBadge verification={post.author.providerVerification} className="h-4 w-4 shrink-0"/>{post.author.isOfficial&&<PrivateMediaImage src={`${import.meta.env.BASE_URL}verified.png`} alt="認証済み" className="h-4 w-4 shrink-0"/>}
    <time dateTime={post.createdAt}>· {new Date(post.createdAt).toLocaleDateString('ja-JP',{month:'long',day:'numeric'})}</time>
   </Link>
   <Link to={`/post/${post.id}`} className="dm-post-preview-content">{post.content}</Link>
   {image&&<button type="button" className="dm-media-image" aria-label="投稿画像を拡大" onClick={()=>openMediaViewer({url:image,post})}><PrivateMediaImage src={image} alt={post.imageAltTexts?.[0]||'投稿画像'} loading="lazy"/></button>}
   {post.poll && <div className="px-3"><PostPoll post={post}/></div>}
  </article>
 </>;
}

// ChatMenuContent
function ChatMenuContent({children,className='',...props}:ComponentProps<typeof DropdownMenuContent>){
 return <DropdownMenuContent {...props} className={`dm-chat-menu ${className}`}>{children}</DropdownMenuContent>;
}

// LocalGemmaModelRow
function LocalGemmaModelRow({state,selected,disabled,onSelect,onDownload,onDelete}:{state:GemmaState;selected:boolean;disabled:boolean;onSelect:()=>void;onDownload:()=>void;onDelete:()=>void}){
 const busy=state.status==='downloading'||state.status==='loading';
 return <div className="flex items-center gap-2 rounded-xl px-2 py-1">
  <button type="button" disabled={disabled} onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left disabled:opacity-50"><span className="flex min-w-0 flex-col"><span className="text-sm font-medium">Gemma 3 270M</span><span className="text-xs text-muted-foreground">{state.status==='downloading'?`ダウンロード中 ${Math.floor(state.progress)}%`:state.status==='loading'?'モデルを読み込み中':''}</span></span>{selected&&<Check size={16} className="shrink-0"/>}</button>
  <button type="button" disabled={busy||disabled} onClick={state.downloaded?onDelete:onDownload} className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-muted disabled:opacity-40" aria-label={state.downloaded?'Gemma 3 270Mを端末から削除':'Gemma 3 270Mをダウンロード'}>{busy?<Loader2 size={18} className="animate-spin"/>:state.downloaded?<Trash2 size={18}/>:<Download size={18}/>}</button>
 </div>;
}

export { ChatPostPreview };
export { ChatMenuContent };
export { LocalGemmaModelRow };
