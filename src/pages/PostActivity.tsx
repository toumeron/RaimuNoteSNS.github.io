import {Loader2} from 'lucide-react';
import {PostCardSkeleton} from '@/components/feed/PostCardSkeleton';
import {Skeleton} from '@/components/ui/skeleton';
import {PrivateAccountBadge} from '@/components/common/PrivateAccountBadge';
import {supabase} from '@/lib/supabase';
import {useEffect,useState,useRef} from 'react';
import {useParams,useSearchParams,Link} from 'react-router-dom';
import {getPostLikers,getPostQuotes,getPostReposters} from '@/api/posts';
import {getCommentLikers} from '@/api/comments';
import type {User,PostWithAuthor} from '@/types';
import {Avatar,AvatarFallback,AvatarImage} from '@/components/ui/avatar';
import {FollowButton} from '@/components/profile/FollowButton';
import {PostCard} from '@/components/feed/PostCard';
import {useAuth} from '@/hooks/useAuth';
import {splitMentionText,mentionProfileHandle} from '@/lib/utils';
import './post-activity.css';

const tabs=[{id:'quotes',label:'引用'},{id:'reposts',label:'リポスト'},{id:'likes',label:'いいね'}] as const;
export default function PostActivity(){
 const {postId=''}=useParams<{postId:string}>();const [params,setParams]=useSearchParams();const replyId=params.get('reply');
 const tab=params.get('tab')==='reposts'?'reposts':params.get('tab')==='likes'||(!params.get('tab')&&replyId)?'likes':'quotes';
 const sort=params.get('sort')==='latest'?'latest':'top';const {user:me}=useAuth();
 const [users,setUsers]=useState<User[]>([]);const [quotes,setQuotes]=useState<PostWithAuthor[]>([]);
 const [loading,setLoading]=useState(true);const [failed,setFailed]=useState(false);const [pages,setPages]=useState(1);const [hasMore,setHasMore]=useState(false);
 const nextPage=useRef<HTMLDivElement>(null);
 useEffect(()=>{setPages(1);setLoading(true);setUsers([]);setQuotes([]);},[postId,replyId,tab,sort]);
 useEffect(()=>{
  let cancelled=false;let revision=0;setLoading(true);setFailed(false);if(pages===1){setUsers([]);setQuotes([]);}
  const refresh=async()=>{
   const request=++revision;
   try{
    if(tab==='quotes'){
     const result=await getPostQuotes(postId,replyId,sort,pages-1);
     if(!cancelled&&request===revision){setQuotes(previous=>pages===1?result:[...previous,...result]);setHasMore(result.length===20);}
    }else if(tab==='reposts'){
     const result=await getPostReposters(postId,replyId,pages-1);
     if(!cancelled&&request===revision){setUsers(previous=>pages===1?result:[...previous,...result]);setHasMore(result.length===50);}
    }else{
     const result=await(replyId?getCommentLikers(replyId):getPostLikers(postId));
     if(!cancelled&&request===revision){setUsers(result);setHasMore(false);}
    }
    if(!cancelled&&request===revision)setFailed(false);
   }catch{if(!cancelled&&request===revision)setFailed(true);}
   finally{if(!cancelled&&request===revision)setLoading(false);}
  };
  void refresh();
  const channel=replyId&&tab==='likes'?supabase.channel(`reply-activity-${replyId}-${crypto.randomUUID()}`)
   .on('postgres_changes',{event:'INSERT',schema:'public',table:'comment_likes',filter:`comment_id=eq.${replyId}`},refresh)
   .on('postgres_changes',{event:'DELETE',schema:'public',table:'comment_likes'},refresh).subscribe(status=>{if(status==='SUBSCRIBED')void refresh();}):null;
  return()=>{cancelled=true;if(channel)void supabase.removeChannel(channel);};
 },[postId,replyId,tab,sort,pages]);
 useEffect(()=>{
  const sentinel=nextPage.current;if(!sentinel||!hasMore||loading||failed)return;
  const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();setPages(value=>value+1);}},{rootMargin:'240px'});
  observer.observe(sentinel);return()=>observer.disconnect();
 },[hasMore,loading,failed]);
 const empty=tab==='quotes'?'まだ引用はありません':tab==='reposts'?'まだリポストはありません':'まだいいねはありません';
 return <div className="post-activity-page" data-lime-post-activity>
  <div role="tablist" aria-label="ポストアクティビティ" className="post-activity-tabs">
   {tabs.map(({id,label})=><button key={id} type="button" role="tab" id={`activity-tab-${id}`} aria-selected={tab===id} aria-controls="activity-list" onClick={()=>{setPages(1);setParams(previous=>{const next=new URLSearchParams(previous);next.set('tab',id);return next;});}}><span>{label}</span></button>)}
   <span aria-hidden="true" className="post-activity-tab-indicator" style={{transform:`translateX(${tabs.findIndex(item=>item.id===tab)*100}%)`}}/>
  </div>
  <div key={`${postId}:${replyId}:${tab}:${sort}:${loading&&!quotes.length&&!users.length?'pending':'ready'}`} className="post-activity-panel" id="activity-list" role="tabpanel" aria-labelledby={`activity-tab-${tab}`} aria-busy={loading}>
   {failed?<p role="alert" className="px-4 py-12 text-center text-sm text-muted-foreground">アクティビティの読み込みに失敗しました。</p>:loading&&!quotes.length&&!users.length?<div role="status" aria-label="読み込み中">
    {tab==='quotes'?Array.from({length:3},(_,index)=><PostCardSkeleton key={index}/>):Array.from({length:3},(_,index)=><div key={index} className="post-activity-user" aria-hidden="true"><Skeleton className="h-11 w-11 shrink-0 rounded-full"/><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><div className="space-y-2"><Skeleton className="h-4 w-28 rounded-full"/><Skeleton className="h-3 w-20 rounded-full"/></div><Skeleton className="h-10 w-24 shrink-0 rounded-full"/></div><Skeleton className="mt-3 h-3 w-4/5 rounded-full"/></div></div>)}
   </div>:tab==='quotes'&&quotes.length?quotes.map(post=><PostCard key={post.id} post={post}/>):users.length?users.map(user=><div key={user.id} className="post-activity-user">
    <Link to={`/u/${encodeURIComponent(user.username)}`} className="shrink-0"><Avatar className="h-11 w-11 border-0"><AvatarImage src={user.avatarUrl} alt={user.displayName}/><AvatarFallback>{user.displayName.slice(0,1)}</AvatarFallback></Avatar></Link>
    <div className="min-w-0 flex-1">
     <div className="flex items-start justify-between gap-3">
      <Link to={`/u/${encodeURIComponent(user.username)}`} className="min-w-0"><div className="flex min-w-0 items-center gap-1 font-bold"><span className="truncate">{user.displayName}</span>{user.isPrivate&&<PrivateAccountBadge/>}{user.isOfficial&&<img src={`${import.meta.env.BASE_URL}verified.png`} alt="Official" className="h-4 w-4 shrink-0"/>}</div><div className="truncate text-sm text-muted-foreground">@{user.username}</div></Link>
      {me?.id!==user.id&&<div className="shrink-0"><FollowButton userId={user.id}/></div>}
     </div>
     {user.bio&&<p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{user.bio.split(/(https?:\/\/[^\s]+)/g).flatMap(part=>part.startsWith('http')?[part]:splitMentionText(part)).map((part,index)=>part.startsWith('@')?<Link key={index} className="text-primary" to={`/u/${encodeURIComponent(mentionProfileHandle(part,user))}`}>{part}</Link>:/^https?:\/\//.test(part)?<a key={index} href={part} target="_blank" rel="noopener noreferrer" className="text-primary">{part}</a>:<span key={index}>{part}</span>)}</p>}
    </div>
   </div>):<p className="px-4 py-12 text-center text-sm text-muted-foreground">{empty}</p>}
   {loading&&(quotes.length>0||users.length>0)&&<div role="status" className="flex justify-center py-10"><div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin"/><span className="text-sm font-medium">読み込み中...</span></div></div>}
   <div ref={nextPage} aria-hidden="true" className="h-px"/>
  </div>
 </div>;
}
