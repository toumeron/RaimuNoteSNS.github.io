import { PrivateAccountBadge } from '@/components/common/PrivateAccountBadge';
import { useEffect, useMemo } from 'react';
import { type InfiniteData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { AtSign, Bell, Heart, MessageCircle, Repeat2, Smile, UserPlus } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { getNotifications, groupNotifications, markNotificationsRead, notificationDescription, notificationLink, type NotificationKind, type NotificationRow } from '@/api/notifications';
import { Button } from '@/components/ui/button';
const icons = {new_post:Bell,mention:AtSign,reply:MessageCircle,like:Heart,repost:Repeat2,reaction:Smile,follow:UserPlus,dm:MessageCircle,dm_request:MessageCircle};
const colors:Record<NotificationKind,string>={new_post:'text-primary',mention:'text-primary',reply:'text-primary',like:'text-pink-500',repost:'text-green-500',reaction:'text-amber-500',follow:'text-primary',dm:'text-muted-foreground',dm_request:'text-muted-foreground'};
export default function Notifications(){
 const {user}=useAuth();const queryClient=useQueryClient();const [params]=useSearchParams();const tab=params.get('tab')==='mention'?'mention':'all';
 const key=['notifications',user?.id];
 const query=useInfiniteQuery({queryKey:key,enabled:!!user?.id,initialPageParam:0,queryFn:({pageParam})=>getNotifications(user!.id,pageParam),getNextPageParam:(last,_,page)=>last.length===50?page+1:undefined});
 const rows=useMemo(()=>query.data?.pages.flat()??[],[query.data]);
 useEffect(()=>{if(!user?.id)return;const channel=supabase.channel(`notification-page-${user.id}`).on('postgres_changes',{event:'*',schema:'public',table:'notifications',filter:`user_id=eq.${user.id}`},()=>void queryClient.invalidateQueries({queryKey:['notifications',user.id]})).subscribe();return()=>{void supabase.removeChannel(channel);};},[user?.id,queryClient]);
 useEffect(()=>{if(!user?.id)return;const ids=rows.filter(n=>!n.is_read&&(tab==='all'||n.type==='mention')).map(n=>n.id);if(ids.length)void markNotificationsRead(user.id,ids).then(()=>{
  const readIds=new Set(ids);
  queryClient.setQueryData<InfiniteData<NotificationRow[]>>(['notifications',user.id],data=>data?{...data,pages:data.pages.map(page=>page.map(row=>readIds.has(row.id)?{...row,is_read:true}:row))}:data);
  void queryClient.invalidateQueries({queryKey:['notification-unread-count',user.id],exact:true});
 }).catch(()=>{});},[rows,user?.id,tab,queryClient]);
 const groups=groupNotifications(rows.filter(n=>tab==='all'||n.type==='mention'));
 return <div className="w-full" data-lime-notifications>
  <div role="tabpanel" id="notification-list" aria-labelledby={`notification-tab-${tab}`}>
   {query.isPending?<p className="p-8 text-center text-muted-foreground">読み込み中...</p>:query.isError?<div className="p-8 text-center"><p>通知を読み込めませんでした</p><Button variant="ghost" onClick={()=>void query.refetch()}>再試行</Button></div>:groups.length===0?<p className="p-10 text-center text-muted-foreground">{tab==='mention'?'メンションはありません':'通知はありません'}</p>:groups.map(group=>{
    const n=group.rows[0];const Icon=icons[n.type]??Bell;const actors=group.rows.filter((item,index,all)=>all.findIndex(a=>(a.actor_id??a.actor_username)===(item.actor_id??item.actor_username))===index);const href=notificationLink(n);
    return <Link to={href} key={group.key} data-notification-type={n.type} className="flex gap-3 border-b border-border px-4 py-4 transition-colors hover:bg-muted/30 sm:gap-4 sm:px-5">
     <Icon aria-hidden="true" className={`mt-1 h-7 w-7 shrink-0 ${colors[n.type]??'text-primary'} ${n.type==='like'?'fill-current':''}`}/>
     <div className="min-w-0 flex-1"><div className="mb-2 flex gap-2">{actors.slice(0,5).map(a=><Avatar key={a.actor_id??a.actor_username??a.id} className="h-9 w-9"><AvatarImage src={a.actor_avatar_url??undefined}/><AvatarFallback>{(a.actor_name??'ユーザー')[0]}</AvatarFallback></Avatar>)}</div>
      <p className="text-sm leading-6 sm:text-[15px]"><span className="font-bold">{n.actor_name??'ユーザー'}</span>{n.actor_is_private&&<PrivateAccountBadge className="mx-1 h-4 w-4 align-text-bottom"/>}{n.actor_is_official&&<img src={`${import.meta.env.BASE_URL}verified.png`} alt="認証済み" className="mx-1 inline h-4 w-4"/>}{actors.length>1?`さんと他${actors.length-1}人が${notificationDescription(n.type,n.emoji).replace(/^さんが/,'')}`:notificationDescription(n.type,n.emoji)}</p>
      {n.content_preview&&<p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">{n.content_preview}</p>}
      <time dateTime={n.created_at} className="mt-1 block text-xs text-muted-foreground">{new Date(n.created_at).toLocaleDateString('ja-JP',{month:'long',day:'numeric'})}</time>
     </div>{n.image_urls?.[0]&&<img src={n.image_urls[0]} alt="通知対象のポストの画像" loading="lazy" className="h-16 w-16 shrink-0 rounded-xl object-cover sm:h-20 sm:w-20"/>}
    </Link>;
   })}
   {query.hasNextPage&&<Button variant="ghost" className="my-4 w-full" disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>さらに読み込む</Button>}
  </div>
 </div>;
}
