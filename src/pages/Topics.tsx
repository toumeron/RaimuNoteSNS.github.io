import { useState, useMemo, useEffect, useRef } from "react";
import { useSearchParams, Link, Navigate, useLocation } from "react-router-dom";
import { Check, CheckCircle2, Hash, Loader2, Plus, X, AtSign, Bell, Heart, MessageCircle, Repeat2, Smile, UserPlus } from "lucide-react";
import { useTopics, useNewsStory } from "@/hooks/useTopics";
import { TOPICS, EMPTY_TOPIC_PREFERENCES, type TopicId } from "@/lib/topics";
import { Button } from "@/components/ui/button";
import { PrivateAccountBadge, Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAutoPagination } from "@/hooks/useViewportWidth";

import { useInfiniteQuery, useQuery, type InfiniteData, useQueryClient } from "@tanstack/react-query";
import { formatRelative } from "@/lib/utils";
import { getNewsHistory, getNewsRelatedPosts } from "@/api/search-news";
import { useAuth } from "@/hooks/useAuth";
import { PostCard } from "@/components/feed/PostCard";
import { SearchTabIndicator } from "@/components/search/SearchExploreContent";
import { useSharedDisplay } from "@/lib/externalAccounts";
import { useSharedNotifications } from "@/hooks/useSharedAccountLists";
import { supabase } from "@/lib/supabase";
import { getAccountReadClient } from "@/lib/accountReadClient";
import { getNotifications, groupNotifications, markAllNotificationsRead, notificationDescription, notificationLink, type NotificationKind, type NotificationRow } from "@/api/users";

// Topics
function Topics() {
 const query=useTopics(),[params,setParams]=useSearchParams(),[selected,setSelected]=useState<TopicId[]>([]);
 const active=params.get('tab')==='recommended'?'recommended':params.get('tab')==='dismissed'?'dismissed':'followed';
 const preferences=query.data??EMPTY_TOPIC_PREFERENCES;
 const save=(ids:TopicId[],status:'follow'|'dismiss'|'clear')=>query.mutation.mutate({ids,status},{onSuccess:()=>setSelected([])});
 const available=TOPICS.filter(topic=>!preferences.followed.includes(topic.id)&&!preferences.dismissed.includes(topic.id));
 if(query.isPending)return <div role="status" className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin"/><span className="sr-only">トピックを読み込み中</span></div>;
 if(query.isError)return <div className="p-6"><p role="alert">トピックを読み込めませんでした。</p><Button variant="outline" className="mt-3" onClick={()=>query.refetch()}>再試行</Button></div>;
 const selecting=active==='followed'&&preferences.followed.length===0;
 const rows=TOPICS.filter(topic=>active==='dismissed'?preferences.dismissed.includes(topic.id):preferences.followed.includes(topic.id));
 return <div id="topic-content" role="tabpanel" aria-labelledby={selecting?undefined:`topic-tab-${active}`} aria-label={selecting?'トピックの選択':undefined} data-lime-topics>
 {query.mutation.isError&&<p role="alert" className="px-4 py-3 text-sm text-destructive">保存に失敗しました。もう一度お試しください。</p>}
 {selecting?<section className="px-5 pt-8 sm:px-8">
  <h2 className="text-2xl font-extrabold leading-tight sm:text-3xl">興味のあるトピックを選択してください</h2>
  <div className="my-7 grid grid-cols-2 gap-3 min-[390px]:grid-cols-3 sm:gap-4">
   {available.map(topic=><button key={topic.id} type="button" aria-pressed={selected.includes(topic.id)} disabled={query.mutation.isPending} onClick={()=>setSelected(current=>current.includes(topic.id)?current.filter(id=>id!==topic.id):[...current,topic.id])} className={`relative flex min-h-28 items-end rounded-2xl border px-3 py-4 text-left text-sm font-bold transition-colors min-[390px]:text-xs sm:min-h-32 sm:p-4 sm:text-base ${selected.includes(topic.id)?'border-primary bg-primary text-primary-foreground':'border-border hover:bg-muted/30'}`}>
    {selected.includes(topic.id)&&<CheckCircle2 className="absolute right-3 top-3 h-5 w-5"/>}{topic.name}
   </button>)}
  </div>
  {!available.length&&<p className="py-6 text-sm text-muted-foreground">すべてのトピックが「興味なし」に設定されています。下のボタンから管理できます。</p>}
  {!!preferences.dismissed.length&&<Button variant="link" className="mb-4 px-0" onClick={()=>setParams({tab:'dismissed'})}>興味なしのトピックを管理</Button>}
  <div className="sticky bottom-[var(--lime-bottom-nav-height,64px)] -mx-5 flex items-center justify-between gap-3 border-t border-border bg-background px-5 py-4 md:bottom-0 sm:-mx-8 sm:px-8">
   <span className="text-sm text-muted-foreground">{selected.length}件選択済み</span><Button className="rounded-full px-8" disabled={!selected.length||query.mutation.isPending} onClick={()=>save(selected,'follow')}>{query.mutation.isPending?'保存中…':'次へ'}</Button>
  </div>
 </section>:<>
  {active!=='recommended'&&rows.map(topic=><div key={topic.id} data-lime-topic-row className="flex items-center gap-3 px-4 py-4">
   <Hash className="h-7 w-7 shrink-0 rounded-full bg-primary p-1.5 text-primary-foreground"/><div className="min-w-0 flex-1"><h2 className="text-sm font-bold">{topic.name}</h2><p className="mt-0.5 text-xs text-muted-foreground">{topic.description}</p></div>
   <Button variant="outline" disabled={query.mutation.isPending} className="h-8 shrink-0 rounded-full px-4 text-xs" aria-label={active==='followed'?`${topic.name}をフォロー解除`:`${topic.name}の興味なしを解除`} onClick={()=>save([topic.id],'clear')}>{active==='followed'?<><Check className="mr-1 h-3 w-3"/>フォロー中</>:'解除する'}</Button>
  </div>)}
  {active==='dismissed'&&!rows.length&&<p className="p-6 text-sm text-muted-foreground">「興味なし」に設定したトピックはありません。</p>}
  {active!=='dismissed'&&<section className="border-b border-border px-4 py-6">
   <h2 className="text-xl font-bold">おすすめトピック</h2><p className="mt-1 text-sm text-muted-foreground">気になるトピックをフォローしましょう。</p>
   <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 min-[1280px]:grid-cols-3">{available.map(topic=><div key={topic.id} className="flex min-w-0 items-center rounded-full border border-border">
    <span className="min-w-0 flex-1 px-3 text-sm font-semibold">{topic.name}</span><button type="button" aria-label={`${topic.name}をフォローする`} disabled={query.mutation.isPending} onClick={()=>save([topic.id],'follow')} className="flex h-11 w-9 shrink-0 items-center justify-center rounded-full text-primary hover:bg-muted disabled:opacity-50"><Plus className="h-4 w-4"/></button>
    <button type="button" aria-label={`${topic.name}に興味なし`} disabled={query.mutation.isPending} onClick={()=>save([topic.id],'dismiss')} className="flex h-11 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-50"><X className="h-4 w-4"/></button>
   </div>)}</div>
   {!available.length&&<p className="mt-4 text-sm text-muted-foreground">追加できるトピックはありません。</p>}
  </section>}
 </>}
 </div>;
}

// NewsPage
function NewsPage() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const showHistory = useLocation().pathname === '/news/history';
  const storyQuery = useNewsStory(params.get('story'), !showHistory);
  const story = storyQuery.data;
  const tab = params.get('tab') === 'latest' ? 'latest' : 'top';
  const related = useQuery({
    queryKey: ['news-related-posts', story?.id, user?.id],
    queryFn: () => getNewsRelatedPosts(story!),
    enabled: !!story && !showHistory,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
  const history = useInfiniteQuery({
    queryKey: ['news-history'],
    queryFn: ({ pageParam }) => getNewsHistory(pageParam),
    enabled: showHistory,
    initialPageParam: 0,
    getNextPageParam: (last, pages) => last.length === 20 ? pages.length * 20 : undefined,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
 const pageEnd = useAutoPagination(history, showHistory);
  const posts = useMemo(() => [...(related.data ?? [])].sort((a, b) => tab === 'latest'
    ? Date.parse(b.createdAt) - Date.parse(a.createdAt)
    : (b.likesCount + (b.repostsCount ?? 0) + b.commentsCount) - (a.likesCount + (a.repostsCount ?? 0) + a.commentsCount) || Date.parse(b.createdAt) - Date.parse(a.createdAt)), [related.data, tab]);
  const source = story?.source === 'bluesky' ? 'Bluesky' : 'LimeNote';

  if (!showHistory && params.get('history') === '1') {
    const next = new URLSearchParams(params); next.delete('history');
    return <Navigate replace to={`/news/history?${next}`} />;
  }
  if (showHistory) return <div data-lime-news-history className="news-history-enter min-h-screen pb-20">
          {history.isPending ? <div className="flex justify-center p-8" role="status" aria-label="トレンド履歴を読み込み中"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            : history.isError ? <p className="p-8 text-center text-muted-foreground">履歴を読み込めませんでした。</p>
            : history.data?.pages.flat().length ? history.data.pages.flat().map(item => <Link key={item.id} to={`/news?story=${encodeURIComponent(item.id)}`} className="block border-b border-border px-5 py-4 hover:bg-muted/40">
              <time dateTime={item.created_at} className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString('ja-JP')}</time>
              <h2 className="mt-1 font-bold leading-6">{item.title}</h2>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.content}</p>
            </Link>) : <p className="p-8 text-center text-muted-foreground">履歴はありません。</p>}
    <div ref={pageEnd} className="h-px" aria-hidden="true" />

  </div>;

  return <div className="news-detail pb-20" data-lime-news-detail>
    {storyQuery.isPending ? <div className="flex justify-center py-12" role="status" aria-label="ニュースを読み込み中"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      : storyQuery.isError ? <p className="p-8 text-center text-muted-foreground">ニュースを読み込めませんでした。</p>
      : !story ? <p className="p-8 text-center text-muted-foreground">ニュースがありません。</p>
      : <>
        <article className="news-detail-article">
          <h1 className="text-2xl font-bold leading-snug sm:text-3xl">{story.title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">最終更新: <time dateTime={story.updated_at ?? story.created_at}>{formatRelative(story.updated_at ?? story.created_at)}</time></p>
          <p className="mt-4 whitespace-pre-wrap break-words text-base leading-7">{story.content}</p>
          <p className="mt-5 text-sm leading-6 text-muted-foreground">このストーリーは、{source}のポストの要約であり、時間の経過とともに新しくなります。AIは間違えることがあるため、アウトプットが事実かどうかを確認してください</p>
        </article>
        <div className="relative flex border-y border-border" role="tablist" aria-label="ニュースの関連ポスト">
          {(['top', 'latest'] as const).map(value => <button key={value} id={`news-tab-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls="news-posts" className={`flex h-14 flex-1 justify-center text-sm transition-colors hover:bg-muted/40 ${tab === value ? 'font-bold text-foreground' : 'text-muted-foreground'}`} onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.set('tab', value); return next; }, { replace: true })}>
            <span data-lime-tab-label className="flex h-full items-center">{value === 'top' ? 'トップ' : '最新'}</span>
          </button>)}
          <SearchTabIndicator active={tab} />
        </div>
        <div id="news-posts" role="tabpanel" aria-labelledby={`news-tab-${tab}`} className="news-detail-posts">
          {related.isPending ? <div className="flex justify-center py-10" role="status" aria-label="関連ポストを読み込み中"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            : related.isError ? <p className="p-8 text-center text-muted-foreground">関連ポストを読み込めませんでした。</p>
            : posts.length ? posts.map(post => <div className="news-detail-post" key={post.id} data-news-post={post.id}><PostCard post={post} /></div>)
            : <p className="p-8 text-center text-muted-foreground">表示できる関連ポストはありません。</p>}
        </div>
      </>}

  </div>;
}

// Notifications
const icons = {new_post:Bell,mention:AtSign,reply:MessageCircle,like:Heart,repost:Repeat2,reaction:Smile,follow:UserPlus,dm:MessageCircle,dm_request:MessageCircle};
const colors:Record<NotificationKind,string>={new_post:'text-primary',mention:'text-primary',reply:'text-primary',like:'text-pink-500',repost:'text-green-500',reaction:'text-amber-500',follow:'text-primary',dm:'text-muted-foreground',dm_request:'text-muted-foreground'};
function Notifications(){
 const {user,accounts=[]}=useAuth();const queryClient=useQueryClient();const [params]=useSearchParams();const tab=params.get('tab')==='mention'?'mention':'all';
 const sharing=useSharedDisplay();
 const key=['notifications',user?.id];
 const ownQuery=useInfiniteQuery({queryKey:key,enabled:!!user?.id&&!sharing,initialPageParam:0,queryFn:({pageParam})=>getNotifications(user!.id,pageParam),getNextPageParam:(last,_,page)=>last.length===50?page+1:undefined});
 const sharedQuery=useSharedNotifications(sharing);
 const query=sharing?sharedQuery:ownQuery;
 const pageEnd = useAutoPagination(query, true);
 const rows=useMemo(()=>sharing?sharedQuery.data?.pages.flatMap(page=>page.items)??[]:ownQuery.data?.pages.flat()??[],[sharing,sharedQuery.data,ownQuery.data]);
 useEffect(()=>{if(!user?.id||sharing)return;const channel=supabase.channel(`notification-page-${user.id}`).on('postgres_changes',{event:'*',schema:'public',table:'notifications',filter:`user_id=eq.${user.id}`},()=>{void queryClient.invalidateQueries({queryKey:['notifications',user.id]});if(sharing)void queryClient.invalidateQueries({queryKey:['notifications','shared']});}).subscribe();return()=>{void supabase.removeChannel(channel);};},[user?.id,queryClient,sharing]);
 const owners=JSON.stringify(user?[...new Set([user.id,...(sharing?accounts.filter(account=>!account.needsLogin).map(account=>account.id):[])])].sort():[]);
 const unreadVersion=JSON.stringify(rows.filter(row=>!row.is_read).map(row=>`${row.user_id}:${row.id}`));
 const pendingReads=useRef(new Set<string>());
 const attemptedReads=useRef(new Map<string,string>());
 useEffect(()=>{
  if(!user?.id)return;
  for(const owner of JSON.parse(owners)as string[]){
   const version=JSON.stringify(rows.filter(row=>row.user_id===owner&&!row.is_read).map(row=>row.id));
   if(pendingReads.current.has(owner)||attemptedReads.current.get(owner)===version||(attemptedReads.current.has(owner)&&version==='[]'))continue;
   pendingReads.current.add(owner);attemptedReads.current.set(owner,version);
   void (async()=>{
    const context=owner===user.id?undefined:{client:await getAccountReadClient(owner),userId:owner};
    // Read the entire account on entry, including notifications outside the loaded pages or selected tab.
    await markAllNotificationsRead(owner,context);
    const update=(row:NotificationRow)=>row.user_id===owner?{...row,is_read:true}:row;
    queryClient.setQueryData<InfiniteData<NotificationRow[]>>(['notifications',owner],data=>data?{...data,pages:data.pages.map(page=>page.map(update))}:data);
    queryClient.setQueriesData<InfiniteData<{items:NotificationRow[]}>>({queryKey:['notifications','shared']},data=>data?{...data,pages:data.pages.map(page=>({...page,items:page.items.map(update)}))}:data);
    await queryClient.cancelQueries({queryKey:['notification-unread-count',owner],exact:true});
    queryClient.setQueryData(['notification-unread-count',owner],0);
    void queryClient.invalidateQueries({queryKey:['notification-unread-count',owner],exact:true});
   })().catch(error=>{console.error('通知の一括既読に失敗しました',error);}).finally(()=>pendingReads.current.delete(owner));
  }
 },[owners,unreadVersion,user?.id,queryClient]);
 const groups=groupNotifications(rows.filter(n=>tab==='all'||n.type==='mention'));
 return <div className="w-full" data-lime-notifications>
  <div role="tabpanel" id="notification-list" aria-labelledby={`notification-tab-${tab}`}>
   {query.isPending?<p className="p-8 text-center text-muted-foreground">読み込み中...</p>:query.isError?<div className="p-8 text-center"><p>{sharing?'共有するアカウントの通知を読み込めませんでした。ログイン状態を確認してください。':'通知を読み込めませんでした'}</p><Button variant="ghost" onClick={()=>void query.refetch()}>再試行</Button></div>:groups.length===0?<p className="p-10 text-center text-muted-foreground">{tab==='mention'?'メンションはありません':'通知はありません'}</p>:groups.map(group=>{
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
    <div ref={pageEnd} className="h-px" aria-hidden="true" />
  </div>
 </div>;
}

// NotFound
const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Oops! Page not found</p>
        <a href="/" className="text-primary underline hover:text-primary/90">
          Return to Home
        </a>
      </div>
    </div>
  );
};

export { Topics as default };
export { NewsPage };
export { Notifications };
export { NotFound };
