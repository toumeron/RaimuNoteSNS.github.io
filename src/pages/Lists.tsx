import {Avatar,AvatarImage,AvatarFallback} from '@/components/ui/avatar';
import {PrivateAccountBadge} from "@/components/common/OfficialBadge";
import {useAutoPagination} from '@/hooks/use-mobile';
import {PostCardSkeleton} from '@/components/feed/PostCardSkeleton';
import {useEffect,useState} from 'react';
import {Link,useNavigate,useParams,useSearchParams} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {Lock,Pin,Plus,Loader2} from 'lucide-react';
import {useAuth} from '@/hooks/useAuth';
import {useLists,useList,useListFeed,useInvalidateLists} from '@/hooks/useLists';
import {deleteList,setSavedList,searchLists,type UserList} from '@/api/lists';
import {saveTimelineTabs,useTimelineTabs,type FeedTabValue} from '@/lib/timelineTabs';
import {ListArt,ListEditor,ListMembers,ListDialog} from '@/components/lists/ListDialogs';
import {Button} from '@/components/ui/button';
import {PostCard} from '@/components/feed/PostCard';
import {toast} from 'sonner';
export default function Lists(){
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
     <span className="truncate font-bold">{row.owner.display_name}</span>{row.owner.is_private&&<PrivateAccountBadge/>}{row.owner.is_official&&<img src={`${import.meta.env.BASE_URL}verified.png`} alt="認証済み" className="h-[18px] w-[18px] shrink-0 object-contain"/>}<span className="truncate text-muted-foreground">@{row.owner.username}</span>
    </Link>
   </div>
   {own||row.saved?<button type="button" aria-label={`${row.name}を${pinned?'TLから外す':'TLに追加'}`} aria-pressed={pinned} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-muted ${pinned?'text-primary':'text-muted-foreground'}`} onClick={()=>void pin(row)}><Pin className="h-5 w-5" fill={pinned?'currentColor':'none'}/></button>:<button type="button" aria-label={`${row.name}をフォロー`} disabled={busy} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground" onClick={()=>void follow(row)}><Plus className="h-5 w-5"/></button>}
  </div>;
 };

 const row=list.data;const saved=lists.data?.find(item=>item.id===id)?.saved??false;
 return <div className="lists-page w-full min-w-0 overflow-x-hidden pb-[calc(var(--lime-bottom-nav-height,64px)+env(safe-area-inset-bottom)+24px)] md:pb-6">
 {!id?<>{lists.isLoading&&<div role="status" className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin"/></div>}{lists.isError&&<button type="button" className="p-6 text-primary" onClick={()=>void lists.refetch()}>リストを再読み込み</button>}{debounced.trim()?<><h2 className="p-4 text-xl font-bold">検索結果</h2>{search.isLoading&&<div role="status" className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin"/></div>}{search.isError&&<button className="p-4 text-primary" onClick={()=>void search.refetch()}>再読み込み</button>}{(search.data??[]).map(item=>renderRow(item,item.owner_id===user?.id))}{search.data?.length===0&&<p className="p-4 text-muted-foreground">リストが見つかりませんでした。</p>}</>:<><section className="border-b border-border py-2"><h2 className="px-4 py-4 text-2xl font-bold">新しいリストを見つける</h2>{(lists.data??[]).filter(item=>!item.is_private).map(item=>renderRow(item,item.owner_id===user?.id))}{lists.data&&!lists.data.some(item=>!item.is_private)&&<p className="p-4 text-muted-foreground">公開リストはまだありません。</p>}</section><section className="py-2"><h2 className="px-4 py-4 text-2xl font-bold">自分のリスト</h2>{(lists.data??[]).filter(item=>item.owner_id===user?.id||item.saved).map(item=>renderRow(item,item.owner_id===user?.id))}{lists.data&&!lists.data.some(item=>item.owner_id===user?.id||item.saved)&&<p className="p-4 text-muted-foreground">まだリストがないようです（ ;  ; ）</p>}</section></>}</>:<>
 {list.isLoading&&<div role="status" className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin"/></div>}{list.isError&&<p className="p-6 text-muted-foreground">リストを表示できません。非公開、削除済み、または通信エラーの可能性があります。<button type="button" className="ml-2 text-primary" onClick={()=>void list.refetch()}>再読み込み</button></p>}
 {row&&<><ListArt src={row.coverUrl}/><section className="space-y-4 border-b border-border px-4 py-6 text-center"><h2 className="break-words text-2xl font-bold">{row.name}{row.is_private&&<Lock className="ml-2 inline h-5 w-5"/>}</h2>{row.description&&<p className="whitespace-pre-wrap break-words">{row.description}</p>}<Link to={`/u/${encodeURIComponent(row.owner.username)}`} className="inline-flex max-w-full flex-wrap items-center justify-center gap-1.5 break-words text-base"><Avatar className="h-7 w-7 shrink-0"><AvatarImage src={row.owner.avatar_url}/><AvatarFallback>{row.owner.display_name.slice(0,1)}</AvatarFallback></Avatar><span className="font-bold">{row.owner.display_name}</span>{row.owner.is_private&&<PrivateAccountBadge/>}{row.owner.is_official&&<img src={`${import.meta.env.BASE_URL}verified.png`} alt="認証済み" className="h-[18px] w-[18px] shrink-0 object-contain"/>}<span className="text-muted-foreground">@{row.owner.username}</span></Link><div className="flex justify-center gap-5"><button type="button" onClick={()=>open('members')}><strong>{row.members.length}</strong><span className="ml-1 text-muted-foreground">人のメンバー</span></button><span><strong>{row.followers??0}</strong><span className="ml-1 text-muted-foreground">フォロワー</span></span></div><div className="flex flex-wrap justify-center gap-3">{row.owner_id===user?.id?<Button variant="outline" className="rounded-full" onClick={()=>open('edit')}>リストを編集</Button>:user&&<Button variant="outline" className="h-10 rounded-full px-6 font-bold" disabled={busy} onClick={()=>void follow({...row,saved})}>{saved?'フォロー中':'フォローする'}</Button>}</div></section>
 {feed.isLoading&&<><PostCardSkeleton/><PostCardSkeleton/></>}{feed.isError&&<button type="button" className="p-6 text-primary" onClick={()=>void feed.refetch()}>投稿を再読み込み</button>}{[...new Map((feed.data?.pages.flatMap(page=>page.posts)??[]).map(post=>[post.id,post])).values()].map(post=><PostCard key={post.id} post={post}/>)}<div ref={pageEnd}>{feed.isFetchingNextPage&&<PostCardSkeleton/>}</div>{!feed.isLoading&&!feed.isError&&!feed.data?.pages.some(page=>page.posts.length)&&<p className="p-6 text-muted-foreground">メンバーの表示できる投稿はまだありません。</p>}</>}
 </>}
 {params.has('create')&&<ListEditor onClose={close} onSaved={result=>navigate(`/lists/${result.id}?members=1`)}/>}{row&&params.has('edit')&&row.owner_id===user?.id&&<ListEditor list={row} onClose={close} onSaved={close}/>}{row&&params.has('members')&&<ListMembers list={row} editable={row.owner_id===user?.id} onClose={close}/>}{row&&params.has('delete')&&row.owner_id===user?.id&&<ListDialog open title="リストを削除" onClose={close}><div className="space-y-4 p-6"><p>「{row.name}」を削除します。リスト内のユーザーや投稿自体は削除されません。</p><Button variant="destructive" disabled={busy} onClick={async()=>{setBusy(true);try{await deleteList(row.id);if(row.cover_ref)void discardListCoverAfterDelete(row.cover_ref);saveTimelineTabs(user?.id,tabs.filter(tab=>tab.value!==`list:${row.id}`).map(tab=>tab.value));await invalidate();navigate('/lists');}catch{toast.error('削除できませんでした');}finally{setBusy(false);}}}>削除する</Button></div></ListDialog>}
 </div>;
}
import {discardListCover} from '@/api/lists';
const discardListCoverAfterDelete=(ref:string)=>discardListCover(ref).catch(()=>{});
