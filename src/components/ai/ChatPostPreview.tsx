import type {ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {getPostById} from '@/api/posts';
import {useAuth} from '@/hooks/useAuth';
import {findChatPostLink} from '@/lib/chatPostLink';
import {openMediaViewer} from '@/components/media/openMediaViewer';
import {Avatar,AvatarImage,AvatarFallback} from '@/components/ui/avatar';
import {PrivateAccountBadge} from '@/components/common/PrivateAccountBadge';

export function ChatPostPreview({content,fallback}:{content:string;fallback:ReactNode}){
 const link=findChatPostLink(content);
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
    {post.author.isOfficial&&<img src={`${import.meta.env.BASE_URL}verified.png`} alt="認証済み" className="h-4 w-4 shrink-0"/>}
    <time dateTime={post.createdAt}>· {new Date(post.createdAt).toLocaleDateString('ja-JP',{month:'long',day:'numeric'})}</time>
   </Link>
   <Link to={`/post/${post.id}`} className="dm-post-preview-content">{post.content}</Link>
   {image&&<button type="button" className="dm-media-image" aria-label="投稿画像を拡大" onClick={()=>openMediaViewer({url:image,post})}><img src={image} alt={post.imageAltTexts?.[0]||'投稿画像'} loading="lazy"/></button>}
  </article>
 </>;
}
