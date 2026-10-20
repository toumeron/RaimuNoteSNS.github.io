import { useAutoPagination } from "@/hooks/useViewportWidth";
import { useSharedOfflineBookmarks, useSharedBookmarks } from "@/hooks/useSharedAccountLists";
import { useSharedDisplay, externalProfileMetadata } from "@/lib/externalAccounts";
import { useOfflineBookmarks } from "@/hooks/useSharedAccountLists";
import { OfflineBookmarkContext } from "@/components/stickers/Stickers";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Search, Download, Trash2, Loader2, Lock, Pin, Plus, AlertTriangle } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { useNavigate, Link, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { getBookmarkPage } from "@/api/users";
import { PostCardSkeleton } from "@/components/feed/PostPoll";
import { PostCard } from "@/components/feed/PostCard";
import { RepostedReplyCard } from "@/components/post/CommentList";
import { displayUsername } from "@/lib/utils";
import { Avatar, AvatarImage, AvatarFallback, PrivateAccountBadge, ProviderVerificationBadge } from "@/components/ui/avatar";
import { useLists, useList, useListFeed, useInvalidateLists } from "@/hooks/useTopics";
import { deleteList, setSavedList, searchLists, type UserList, discardListCover } from "@/api/users";
import { saveTimelineTabs, useTimelineTabs, type FeedTabValue } from "@/components/feed/TimelineTabBar";
import { ListArt, ListEditor, ListMembers, ListDialog } from "@/components/lists/ListDialogs";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { fetchBlueskyProfile, isBlueskyProfileId } from "@/lib/bluesky";
import { fetchFollowListPage, type FollowListTab } from "@/api/users";
import { FollowButton } from "@/components/profile/ProfileHeader";
import { ProfileListHeader } from "@/components/layout/Header";
import { type User } from "@/types/index";

// Bookmarks
function Bookmarks() {
  const { user } = useAuth();
  const sharing = useSharedDisplay();
  const navigate = useNavigate();
  const offline=useOfflineBookmarks(user?.id);
  const local=!offline.online;
  const sharedOffline=useSharedOfflineBookmarks(sharing && local);
  const localChecking=sharing?sharedOffline.checking:offline.checking;
  const localPosts=sharing?sharedOffline.posts:offline.saved?.posts??[];
  const localContext=sharing?sharedOffline.context:offline.saved;
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  useEffect(() => { const timer = window.setTimeout(() => setSearchTerm(search.trim().toLocaleLowerCase()), 200); return () => window.clearTimeout(timer); }, [search]);
  const ownQuery = useInfiniteQuery({ queryKey: ['bookmarks', 'pages', user?.id], queryFn: ({ pageParam }) => getBookmarkPage(user!.id, pageParam), initialPageParam: 0, getNextPageParam: page => page.next, enabled: !!user && !local && !sharing });
  const sharedQuery = useSharedBookmarks(sharing && !local);
  const query = sharing ? sharedQuery : ownQuery;
 const pageEnd = useAutoPagination(query, !local);
  const onlinePosts = sharing ? sharedQuery.data?.pages.flatMap(page => page.items.map(entry => entry.post)) ?? [] : ownQuery.data?.pages.flatMap(page => page.posts) ?? [];
  // Search every saved page, including bookmarks beyond the initially loaded page.
  useEffect(() => { if (!local && searchTerm && query.hasNextPage && !query.isFetching && !query.isFetchNextPageError) void query.fetchNextPage(); }, [local, searchTerm, query.hasNextPage, query.isFetching, query.isFetchNextPageError, query.fetchNextPage]);
  const posts = [...new Map((local ? localPosts : onlinePosts).map(post => [post.id, post])).values()].filter(post => !searchTerm || [post.content, post.author.displayName, post.author.username].some(text => text?.toLocaleLowerCase().includes(searchTerm)));
  const unavailable = !local && !sharing && ownQuery.data?.pages.some(page => page.unavailable > 0);
  const searching = !local && !!searchTerm && (query.isFetching || query.hasNextPage);
  return <section data-lime-bookmarks-page className="w-full">
    <header data-lime-bookmarks-header className="sticky top-0 z-[60] border-b border-border bg-background/95 backdrop-blur-md">
      <div className="flex h-14 items-center gap-4 px-3">
        <button type="button" aria-label={searchOpen ? 'ブックマークの検索を閉じる' : '戻る'} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-muted" onClick={() => { if (searchOpen) { setSearchOpen(false); setSearch(''); } else if (window.history.state?.idx > 0) navigate(-1); else navigate('/'); }}><ArrowLeft className="h-5 w-5" /></button>
        {searchOpen ? <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border border-border px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary"><Search className="h-4 w-4 shrink-0 text-muted-foreground" /><input autoFocus aria-label="ブックマークを検索" placeholder="ブックマークを検索" value={search} onChange={event => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label> : <><div className="flex min-w-0 flex-1 items-center gap-1"><h1 className="truncate text-xl font-bold">ブックマーク</h1>{offline.pwa&&<button type="button" aria-label={offline.saved?"オフライン保存データを削除":"ブックマークをすべてオフラインに保存"} title={offline.saved?"オフライン保存データを削除":"すべてオフラインに保存"} disabled={offline.busy||offline.checking||(!offline.saved&&!offline.online)} onClick={()=>void offline.toggle()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-primary hover:bg-primary/10 disabled:opacity-40">{offline.busy?<Loader2 className="h-5 w-5 animate-spin"/>:offline.saved?<Trash2 className="h-5 w-5"/>:<Download className="h-5 w-5"/>}</button>}</div><button type="button" aria-label="ブックマークを検索" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted" onClick={() => setSearchOpen(true)}><Search className="h-5 w-5" /></button></>}
      </div>
    </header>
    {((local && localChecking) || (!local && query.isPending)) && <div className="px-4 sm:px-0"><PostCardSkeleton /><PostCardSkeleton /></div>}
    {!local && query.isError && <div className="px-4 py-10 text-center"><p className="text-sm text-muted-foreground">{sharing?'共有するアカウントのブックマークを読み込めませんでした。ログイン状態を確認してください。':'ブックマークの取得に失敗しました。'}</p><button type="button" className="mt-3 text-sm font-bold text-primary" onClick={() => query.refetch()}>再試行</button></div>}
    {local && sharing && sharedOffline.error && <p role="alert" className="px-4 py-5 text-center text-sm text-muted-foreground">オフライン保存したブックマークを読み込めませんでした。</p>}
    {(local ? !localChecking : !query.isPending && !query.isError) && posts.length === 0 && !searching && <p className="px-4 py-10 text-center text-sm text-muted-foreground">{searchTerm ? '一致するブックマークがありません。' : local ? 'オフライン保存したポストがありません。' : 'ブックマークしたポストがありません。'}</p>}
    {searching && <p role="status" className="px-4 py-3 text-center text-sm text-muted-foreground">ブックマークを検索中...</p>}
    {offline.busy&&<p role="status" className="px-4 py-2 text-center text-xs text-muted-foreground">{offline.progress||"オフライン保存を処理中..."}</p>}
    <OfflineBookmarkContext.Provider value={local?localContext:null}>{posts.map(post => post.replyId ? <RepostedReplyCard key={post.id} post={post} /> : <PostCard key={post.id} post={post} />)}</OfflineBookmarkContext.Provider>
    {unavailable && <p className="px-4 py-4 text-center text-xs text-muted-foreground">削除済み、または現在閲覧できない投稿は表示されません。</p>}
    {!local && query.isFetchingNextPage && <PostCardSkeleton />}
    <div ref={pageEnd} className="h-px" aria-hidden="true" />
  </section>;
}

// Lists
function Lists(){
 const {id}=useParams(),{user}=useAuth(),navigate=useNavigate();const [params,setParams]=useSearchParams();const lists=useLists(user?.id),list=useList(id),feed=useListFeed(id),tabs=useTimelineTabs(user?.id),invalidate=useInvalidateLists();const [busy,setBusy]=useState(false),[debounced,setDebounced]=useState('');const q=params.get('q')??'';
 useEffect(()=>{const timer=setTimeout(()=>setDebounced(q),300);return()=>clearTimeout(timer);},[q]);
 const pageEnd=useAutoPagination(feed,!!id);
 const search=useQuery({queryKey:['list-search',user?.id,debounced],enabled:!!debounced.trim()&&!id,queryFn:()=>searchLists(debounced),staleTime:60000});
 const close=()=>{const next=new URLSearchParams(params);['create','edit','members','delete'].forEach(key=>next.delete(key));setParams(next,{replace:true});};
 const open=(key:string)=>{const next=new URLSearchParams(params);next.set(key,'1');setParams(next);};
 const pin=async(row:UserList)=>{const value=`list:${row.id}` as FeedTabValue;const values=tabs.map(tab=>tab.value);if(!values.includes(value)&&row.owner_id!==user?.id){try{await setSavedList(row.id,true);await invalidate();}catch{toast.error('リストを追加できませんでした');return;}}saveTimelineTabs(user?.id,values.includes(value)?values.filter(tab=>tab!==value):[...values,value]);};
 const follow=async(row:UserList)=>{setBusy(true);try{await setSavedList(row.id,!row.saved);await invalidate();}catch(error){toast.error(error instanceof Error?error.message:'変更できませんでした');}finally{setBusy(false);}};
 const renderRow=(row:UserList,own:boolean)=>{
  const pinned=tabs.some(tab=>tab.value===`list:${row.id}`);
  return <div key={row.id} className="flex min-w-0 items-center gap-3 px-4 py-3" data-list-row>
   <Link to={`/lists/${row.id}`} className="shrink-0"><ListArt src={row.coverUrl} small/></Link>
   <div className="min-w-0 flex-1">
    <Link to={`/lists/${row.id}`} className="block leading-snug"><span className="break-words font-bold">{row.name}{row.is_private&&<Lock className="ml-1 inline h-4 w-4"/>}</span><span className="ml-1 text-sm text-muted-foreground">· {row.members.length}人のメンバー</span></Link>
    <Link to={`/u/${encodeURIComponent(row.owner.username)}`} className="mt-1 inline-flex w-fit max-w-full min-w-0 items-center gap-1 text-sm">
     <Avatar className="h-5 w-5 shrink-0"><AvatarImage src={row.owner.avatar_url}/><AvatarFallback>{row.owner.display_name.slice(0,1)}</AvatarFallback></Avatar>
     <span className="truncate font-bold">{row.owner.display_name}</span>{row.owner.is_private&&<PrivateAccountBadge/>}{row.owner.is_official&&<img src={`${import.meta.env.BASE_URL}verified.png`} alt="認証済み" className="h-[18px] w-[18px] shrink-0 object-contain"/>}<span className="truncate text-muted-foreground">@{displayUsername(row.owner.username)}</span>
    </Link>
   </div>
   {own||row.saved?<button type="button" aria-label={`${row.name}を${pinned?'TLから外す':'TLに追加'}`} aria-pressed={pinned} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-muted ${pinned?'text-primary':'text-muted-foreground'}`} onClick={()=>void pin(row)}><Pin className="h-5 w-5" fill={pinned?'currentColor':'none'}/></button>:<button type="button" aria-label={`${row.name}をフォロー`} disabled={busy} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground" onClick={()=>void follow(row)}><Plus className="h-5 w-5"/></button>}
  </div>;
 };

 const row=list.data;const saved=lists.data?.find(item=>item.id===id)?.saved??false;
 return <div className="lists-page w-full min-w-0 overflow-x-hidden pb-[calc(var(--lime-bottom-nav-height,64px)+env(safe-area-inset-bottom)+24px)] md:pb-6">
 {!id?<>{lists.isLoading&&<div role="status" className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin"/></div>}{lists.isError&&<button type="button" className="p-6 text-primary" onClick={()=>void lists.refetch()}>リストを再読み込み</button>}{debounced.trim()?<><h2 className="p-4 text-xl font-bold">検索結果</h2>{search.isLoading&&<div role="status" className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin"/></div>}{search.isError&&<button className="p-4 text-primary" onClick={()=>void search.refetch()}>再読み込み</button>}{(search.data??[]).map(item=>renderRow(item,item.owner_id===user?.id))}{search.data?.length===0&&<p className="p-4 text-muted-foreground">リストが見つかりませんでした。</p>}</>:<><section className="border-b border-border py-2"><h2 className="px-4 py-4 text-2xl font-bold">新しいリストを見つける</h2>{(lists.data??[]).filter(item=>!item.is_private).map(item=>renderRow(item,item.owner_id===user?.id))}{lists.data&&!lists.data.some(item=>!item.is_private)&&<p className="p-4 text-muted-foreground">公開リストはまだありません。</p>}</section><section className="py-2"><h2 className="px-4 py-4 text-2xl font-bold">自分のリスト</h2>{(lists.data??[]).filter(item=>item.owner_id===user?.id||item.saved).map(item=>renderRow(item,item.owner_id===user?.id))}{lists.data&&!lists.data.some(item=>item.owner_id===user?.id||item.saved)&&<p className="p-4 text-muted-foreground">まだリストがないようです（ ;  ; ）</p>}</section></>}</>:<>
 {list.isLoading&&<div role="status" className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin"/></div>}{list.isError&&<p className="p-6 text-muted-foreground">リストを表示できません。非公開、削除済み、または通信エラーの可能性があります。<button type="button" className="ml-2 text-primary" onClick={()=>void list.refetch()}>再読み込み</button></p>}
 {row&&<><ListArt src={row.coverUrl}/><section className="space-y-4 border-b border-border px-4 py-6 text-center"><h2 className="break-words text-2xl font-bold">{row.name}{row.is_private&&<Lock className="ml-2 inline h-5 w-5"/>}</h2>{row.description&&<p className="whitespace-pre-wrap break-words">{row.description}</p>}<Link to={`/u/${encodeURIComponent(row.owner.username)}`} className="inline-flex max-w-full flex-wrap items-center justify-center gap-1.5 break-words text-base"><Avatar className="h-7 w-7 shrink-0"><AvatarImage src={row.owner.avatar_url}/><AvatarFallback>{row.owner.display_name.slice(0,1)}</AvatarFallback></Avatar><span className="font-bold">{row.owner.display_name}</span>{row.owner.is_private&&<PrivateAccountBadge/>}{row.owner.is_official&&<img src={`${import.meta.env.BASE_URL}verified.png`} alt="認証済み" className="h-[18px] w-[18px] shrink-0 object-contain"/>}<span className="text-muted-foreground">@{displayUsername(row.owner.username)}</span></Link><div className="flex justify-center gap-5"><button type="button" onClick={()=>open('members')}><strong>{row.members.length}</strong><span className="ml-1 text-muted-foreground">人のメンバー</span></button><span><strong>{row.followers??0}</strong><span className="ml-1 text-muted-foreground">フォロワー</span></span></div><div className="flex flex-wrap justify-center gap-3">{row.owner_id===user?.id?<Button variant="outline" className="rounded-full" onClick={()=>open('edit')}>リストを編集</Button>:user&&<Button variant="outline" className="h-10 rounded-full px-6 font-bold" disabled={busy} onClick={()=>void follow({...row,saved})}>{saved?'フォロー中':'フォローする'}</Button>}</div></section>
 {feed.isLoading&&<><PostCardSkeleton/><PostCardSkeleton/></>}{feed.isError&&<button type="button" className="p-6 text-primary" onClick={()=>void feed.refetch()}>投稿を再読み込み</button>}{[...new Map((feed.data?.pages.flatMap(page=>page.posts)??[]).map(post=>[post.id,post])).values()].map(post=><PostCard key={post.id} post={post}/>)}<div ref={pageEnd}>{feed.isFetchingNextPage&&<PostCardSkeleton/>}</div>{!feed.isLoading&&!feed.isError&&!feed.data?.pages.some(page=>page.posts.length)&&<p className="p-6 text-muted-foreground">メンバーの表示できる投稿はまだありません。</p>}</>}
 </>}
 {params.has('create')&&<ListEditor onClose={close} onSaved={result=>navigate(`/lists/${result.id}?members=1`)}/>}{row&&params.has('edit')&&row.owner_id===user?.id&&<ListEditor list={row} onClose={close} onSaved={close}/>}{row&&params.has('members')&&<ListMembers list={row} editable={row.owner_id===user?.id} onClose={close}/>}{row&&params.has('delete')&&row.owner_id===user?.id&&<ListDialog open title="リストを削除" onClose={close}><div className="space-y-4 p-6"><p>「{row.name}」を削除します。リスト内のユーザーや投稿自体は削除されません。</p><Button variant="destructive" disabled={busy} onClick={async()=>{setBusy(true);try{await deleteList(row.id);if(row.cover_ref)void discardListCoverAfterDelete(row.cover_ref);saveTimelineTabs(user?.id,tabs.filter(tab=>tab.value!==`list:${row.id}`).map(tab=>tab.value));await invalidate();navigate('/lists');}catch{toast.error('削除できませんでした');}finally{setBusy(false);}}}>削除する</Button></div></ListDialog>}
 </div>;
}
const discardListCoverAfterDelete=(ref:string)=>discardListCover(ref).catch(()=>{});

// FollowersFollowingPage
function Bio({text}:{text:string}){
 return <p className="follow-list-bio">{text.split(/(https?:\/\/[^\s]+)/g).map((part,i)=>/^https?:\/\//.test(part)?<a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a>:part)}</p>;
}
function FollowersFollowingPage(){
 const client=useQueryClient();const {username}=useParams();const {user:viewer}=useAuth();const navigate=useNavigate();const [params,setParams]=useSearchParams();
 const tab:FollowListTab=params.get('tab')==='known'?'known':params.get('tab')==='followers'?'followers':'following';
 const hydrated=useRef(new Set<string>());
 useEffect(()=>{hydrated.current.clear();},[username,tab,viewer?.id]);
 const target=useQuery({queryKey:['follow-list-profile',username],queryFn:async({signal})=>{
  const {data,error}=await supabase.from('profiles').select('*').eq('username',username!).abortSignal(signal).maybeSingle();
  if(error)throw error;
  if(data)return {id:data.id,username:data.username,displayName:data.display_name||data.username,avatarUrl:data.avatar_url||'',coverUrl:data.cover_url||'',bio:data.bio||'',createdAt:data.created_at||'',isOfficial:data.is_official,isPrivate:data.is_private} as User;
  return await fetchBlueskyProfile(username!,signal) as User|null;
 },enabled:!!username});
 const list=useInfiniteQuery({queryKey:['follow-list',target.data?.id,tab,viewer?.id],enabled:!!target.data&&!!viewer,initialPageParam:null as string|null,queryFn:({pageParam,signal})=>fetchFollowListPage(target.data!,tab,viewer!.id,pageParam,signal),getNextPageParam:page=>page.cursor??undefined});
 const pageEnd = useAutoPagination(list, true);
 const users=[...new Map((list.data?.pages.flatMap(page=>page.users)??[]).map(user=>[user.id,user])).values()];
 useEffect(()=>{
  const missing=users.filter(user=>isBlueskyProfileId(user.id)&&!hydrated.current.has(user.username)&&(!user.avatarUrl||user.displayName===user.username||user.id.startsWith('x-user:')&&!user.providerVerification));if(!missing.length)return;
  let cancelled=false,finished=false,index=0;const started=new Set<string>();const resolved=new Map<string,User>();
  void Promise.all(Array.from({length:Math.min(3,missing.length)},async()=>{while(index<missing.length&&!cancelled){const row=missing[index++];hydrated.current.add(row.username);started.add(row.username);const profile=await externalProfileMetadata(row.username);if(profile)resolved.set(row.id,profile);}})).then(()=>{finished=true;if(cancelled||!resolved.size)return;client.setQueryData(['follow-list',target.data?.id,tab,viewer?.id],(data:typeof list.data)=>data?{...data,pages:data.pages.map(page=>({...page,users:page.users.map(row=>resolved.get(row.id)??row)}))}:data);});
  return()=>{cancelled=true;if(!finished)for(const actor of started)hydrated.current.delete(actor);};
 },[list.data,target.data?.id,tab,viewer?.id,client]);
 const changeTab=(tab:FollowListTab)=>{setParams(previous=>{const next=new URLSearchParams(previous);next.set('tab',tab);return next});};
 return <section className="follow-list-page" aria-label="フォロー一覧">
  <div className="follow-list-sticky">
  <ProfileListHeader verification={target.data?.providerVerification} name={target.data?.displayName??username??''} username={target.data?.username??username??''} back={()=>window.history.state?.idx>0?navigate(-1):navigate(`/u/${encodeURIComponent(username??'')}`)}/>
  <div className="follow-list-tabs" role="tablist" aria-label="フォロー一覧の種類">{([{id:'known',label:'知り合いのフォロワー'},{id:'followers',label:'フォロワー'},{id:'following',label:'フォロー中'}] as const).map(item=><button key={item.id} id={`follow-tab-${item.id}`} type="button" role="tab" aria-selected={tab===item.id} aria-controls="follow-list-panel" onClick={()=>changeTab(item.id)}><span>{item.label}</span></button>)}</div>
  </div>
  <div id="follow-list-panel" role="tabpanel" aria-labelledby={`follow-tab-${tab}`} aria-busy={target.isPending||list.isFetching}>
   {target.isPending||target.data&&list.isPending?<div className="follow-list-status" role="status"><Loader2 className="animate-spin" size={24}/><p>読み込み中…</p></div>:target.isError||list.isError?<div className="follow-list-status" role="alert"><AlertTriangle size={24}/><p>一覧を読み込めませんでした。</p><button onClick={()=>void (target.isError?target.refetch():list.refetch())}>再試行</button></div>:!target.data?<div className="follow-list-status"><p>ユーザーが見つかりませんでした。</p></div>:<>
    {users.map(user=><article key={user.id} className="follow-list-row" aria-label={user.displayName}>
     <Link className="follow-list-avatar" to={`/u/${encodeURIComponent(user.username)}`} aria-label={`${user.displayName}のプロフィール`}><Avatar><AvatarImage src={user.avatarUrl} alt=""/><AvatarFallback>{user.displayName.slice(0,1)}</AvatarFallback></Avatar></Link>
     <div className="follow-list-user"><div className="follow-list-identity"><Link to={`/u/${encodeURIComponent(user.username)}`}><span className="follow-list-name"><span className="follow-list-display">{user.displayName}</span>{user.isPrivate&&<PrivateAccountBadge/>}<ProviderVerificationBadge verification={user.providerVerification} className="h-[18px] w-[18px] shrink-0"/>{user.isOfficial&&<img src={`${import.meta.env.BASE_URL}verified.png`} alt="認証済み"/>}</span><span className="follow-list-handle">@{displayUsername(user.username)}</span></Link>{user.id!==viewer?.id&&<div className="follow-list-action"><FollowButton userId={user.id} externalProfile={isBlueskyProfileId(user.id)?user:undefined}/></div>}</div>{user.bio&&<Bio text={user.bio}/>}</div>
    </article>)}
    {!users.length&&!list.hasNextPage&&<div className="follow-list-status"><p>{tab==='known'?'知り合いのフォロワーはいません':tab==='following'?'まだ誰もフォローしていません':'まだフォロワーはいません'}</p></div>}
    <div ref={pageEnd} className="h-px" aria-hidden="true" />
   </>}
  </div>
 </section>;
}

export { Bookmarks as default };
export { Lists };
export { FollowersFollowingPage };
