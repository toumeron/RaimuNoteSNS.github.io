import { LIST_MEMBER_LIMIT } from "@/lib/accountSuspension";
import { displayUsername } from "@/lib/utils";
import { ProviderVerificationBadge, Avatar, AvatarImage, AvatarFallback, PrivateAccountBadge } from "@/components/ui/avatar";
import { Link } from "react-router-dom";
import { searchProfileUser, accountReviewsKey, getAccountReviews, setAccountReviewLike, submitAccountReview } from "@/api/users";
import { useEffect, useRef, useState } from "react";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, ImagePlus, Lock, Plus, X, Star } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader } from "@/components/ui/button";
import { Button, Input, Textarea } from "@/components/ui/button";
import { saveList, setListMember, searchListUsers, discardListCover, type UserList, type ListMember } from "@/api/users";
import { useInvalidateLists, useLists } from "@/hooks/useTopics";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAutoPagination } from "@/hooks/useViewportWidth";
import { LikeButton } from "@/components/post/LikeButton";

// ListDialogs
function ListDialog({open,onClose,title,children}:{open:boolean;onClose:()=>void;title:string;children:React.ReactNode}){
 const content=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!open)return;
  const viewport=window.visualViewport;
  const measure=()=>{content.current?.style.setProperty('--list-dialog-height',`${viewport?.height??window.innerHeight}px`);content.current?.style.setProperty('--list-dialog-top',`${viewport?.offsetTop??0}px`);};
  measure();viewport?.addEventListener('resize',measure);viewport?.addEventListener('scroll',measure);window.addEventListener('resize',measure);
  return()=>{viewport?.removeEventListener('resize',measure);viewport?.removeEventListener('scroll',measure);window.removeEventListener('resize',measure);};
 },[open]);
 return <Dialog open={open} onOpenChange={value=>{if(!value)onClose();}}><DialogContent ref={element=>{content.current=element;if(element){element.style.setProperty('--list-dialog-height',`${window.visualViewport?.height??window.innerHeight}px`);element.style.setProperty('--list-dialog-top',`${window.visualViewport?.offsetTop??0}px`);}}} overlayClassName="z-[2147483100] bg-black/20" className="list-dialog z-[2147483200] flex h-[min(90dvh,900px)] max-w-2xl flex-col gap-0 overflow-hidden rounded-3xl border-0 bg-background p-0 outline-none [&>button]:hidden"><div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3"><button type="button" aria-label="閉じる" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" onClick={onClose}><X className="h-5 w-5"/></button><DialogTitle className="min-w-0 text-lg font-bold leading-snug sm:text-xl">{title}</DialogTitle></div><DialogDescription className="sr-only">{title}の設定と操作</DialogDescription><div data-list-dialog-scroll className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pb-6">{children}</div></DialogContent></Dialog>;
}
function ListArt({src,small=false}:{src?:string;small?:boolean}){
 if(src)return <img src={src} alt="リストの画像" className={small?'h-14 w-14 shrink-0 rounded-xl object-cover':'aspect-[3/1] w-full object-cover'}/>;
 if(small)return <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground/50"><svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8 7h8M8 11h8M8 15h5"/></svg></div>;
 return <div className="aspect-[3/1] w-full overflow-hidden bg-primary/20 text-primary/50" aria-hidden="true" data-list-default-cover>
  <svg viewBox="0 0 900 300" className="h-full w-full" preserveAspectRatio="xMidYMid slice" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
   <path className="text-primary/20" stroke="currentColor" d="M294 0v300M606 0v300M0 125h294M606 175h294"/>
   <g transform="translate(395 86)"><rect width="110" height="128" rx="14"/><path d="M24 35h62M24 64h62M24 93h36"/></g>
   <g transform="translate(80 -22)"><rect width="132" height="125" rx="13"/><path d="M28 35h75M28 64h75M28 93h40"/></g>
   <g transform="translate(688 210)"><rect width="132" height="125" rx="13"/><path d="M28 35h75M28 64h75M28 93h40"/></g>
   <path fill="currentColor" stroke="none" d="m147 150 17 40 43 4-33 28 10 42-37-22-37 22 10-42-33-28 43-4Zm605-145 17 40 43 4-33 28 10 42-37-22-37 22 10-42-33-28 43-4Z"/>
  </svg>
 </div>;
}
function ListEditor({list,onClose,onSaved}:{list?:UserList;onClose:()=>void;onSaved:(list:UserList)=>void}){
 const invalidate=useInvalidateLists();const [name,setName]=useState(list?.name??''),[description,setDescription]=useState(list?.description??''),[privateList,setPrivate]=useState(list?.is_private??false),[file,setFile]=useState<File>(),[removeCover,setRemoveCover]=useState(false),[preview,setPreview]=useState<string>(),[busy,setBusy]=useState(false);const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(!file){setPreview(undefined);return;}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);},[file]);
 const save=async()=>{setBusy(true);try{const result=await saveList({id:list?.id,name,description,is_private:privateList,cover_ref:removeCover?null:undefined,file});await invalidate();if(list?.cover_ref&&(file||removeCover))void discardListCover(list.cover_ref).catch(()=>{});onSaved(result);}catch(error){toast.error(error instanceof Error?error.message:'リストを保存できませんでした');}finally{setBusy(false);}};
 return <ListDialog open onClose={()=>{if(!busy)onClose();}} title={list?'リストを編集':'新しいリストを作成'}><div className="relative"><ListArt src={preview??(!removeCover?list?.coverUrl:undefined)}/><div className="absolute inset-0 flex items-center justify-center gap-4"><button type="button" aria-label="リスト画像を選択" disabled={busy} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white" onClick={()=>input.current?.click()}><ImagePlus className="h-5 w-5"/></button>{(preview||(!removeCover&&list?.cover_ref))&&<button type="button" aria-label="リスト画像を削除" disabled={busy} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white" onClick={()=>{setFile(undefined);setRemoveCover(true);}}><X className="h-5 w-5"/></button>}</div><input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={event=>{const next=event.target.files?.[0];event.target.value='';if(next){setFile(next);setRemoveCover(false);}}}/></div>
 <form className="space-y-6 p-4 sm:p-6" onSubmit={event=>{event.preventDefault();void save();}}><label className="block rounded-lg border border-border px-3 py-2"><span className="text-sm text-muted-foreground">名前</span><input aria-label="リストの名前" className="mt-1 block w-full bg-transparent text-lg outline-none" value={name} maxLength={50} disabled={busy} onChange={event=>setName(event.target.value)}/></label><label className="block rounded-lg border border-border px-3 py-2"><span className="text-sm text-muted-foreground">詳細</span><textarea aria-label="リストの詳細" rows={3} className="mt-1 block w-full resize-none bg-transparent outline-none" value={description} maxLength={500} disabled={busy} onChange={event=>setDescription(event.target.value)}/></label><label className="flex items-start justify-between gap-4"><span><span className="block font-bold">非公開にする</span><span className="mt-1 block text-sm text-muted-foreground"></span></span><input type="checkbox" aria-label="非公開にする" checked={privateList} disabled={busy} onChange={event=>setPrivate(event.target.checked)} className="mt-1 h-5 w-5 accent-foreground"/></label><Button type="submit" disabled={busy||!name.trim()} className="w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90">{busy?'保存中…':list?'完了':'作成する'}</Button></form></ListDialog>;
}
function ListMemberRow({member,children}:{member:ListMember;children?:React.ReactNode}) {return <div className="flex items-start gap-3 border-b border-border px-4 py-4"><Link to={`/u/${encodeURIComponent(member.username)}`} className="flex min-w-0 flex-1 items-start gap-3"><Avatar userId={member.id} className="h-10 w-10 shrink-0"><AvatarImage src={member.avatarUrl} alt=""/><AvatarFallback className="bg-muted text-sm font-bold">{member.displayName?.slice(0,1)||'U'}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-1"><span className="break-words font-bold leading-snug">{member.displayName}</span>{member.isPrivate&&<PrivateAccountBadge/>}<ProviderVerificationBadge verification={member.providerVerification} className="h-[18px] w-[18px] shrink-0 object-contain"/>{member.isOfficial&&<img src={`${import.meta.env.BASE_URL}verified.png`} alt="認証済み" className="h-[18px] w-[18px] shrink-0 object-contain"/>}</div><p className="break-all text-sm text-muted-foreground">@{displayUsername(member.username)}</p>{member.bio&&<p className="mt-1 line-clamp-3 break-words text-sm">{member.bio}</p>}</div></Link>{children}</div>;}

function ListMembers({list,editable,onClose}:{list:UserList;editable:boolean;onClose:()=>void}){
 const {user}=useAuth();const invalidate=useInvalidateLists();const [tab,setTab]=useState<'members'|'add'>('members'),[search,setSearch]=useState(''),[debounced,setDebounced]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{const timer=setTimeout(()=>setDebounced(search),300);return()=>clearTimeout(timer);},[search]);
 const candidates=useQuery({queryKey:['list-member-search',user?.id,debounced],enabled:editable&&tab==='add',queryFn:async({signal})=>{
  if(debounced.trim())return searchListUsers(debounced,signal);
  const {data:following,error:followError}=await supabase.from('follows').select('followee_id').eq('follower_id',user!.id).limit(15).abortSignal(signal);if(followError)throw followError;
  const ids=following?.map(row=>row.followee_id)??[];if(!ids.length)return [];
  const {data,error}=await supabase.from('profiles').select('id,username,display_name,avatar_url,bio,is_official,is_private').in('id',ids).abortSignal(signal);if(error)throw error;return (data??[]).map(searchProfileUser);
 },staleTime:60000,retry:false});
 const change=async(member:ListMember,included:boolean)=>{setBusy(true);try{await setListMember(list.id,member,included);await invalidate();}catch(error){toast.error(error instanceof Error?error.message:'メンバーを変更できませんでした');}finally{setBusy(false);}};
 const rows=tab==='members'?list.members:candidates.data??[];
 return <ListDialog open onClose={onClose} title={editable?'メンバーを管理':'リストに追加されているユーザー'}>{editable&&<><div className="flex border-b border-border">{(['members','add'] as const).map(value=><button key={value} type="button" className={`flex-1 border-b-2 py-4 font-bold ${tab===value?'border-foreground':'border-transparent text-muted-foreground'}`} onClick={()=>setTab(value)}>{value==='members'?`メンバー (${list.members.length})`:'ユーザーを追加'}</button>)}</div>{tab==='add'&&<input aria-label="追加するユーザーを検索" placeholder="ユーザーを検索" value={search} onChange={event=>setSearch(event.target.value)} className="mx-4 my-4 w-[calc(100%-32px)] rounded-full border border-border bg-transparent px-4 py-3 text-base"/>}</>}
 {tab==='add'&&candidates.isLoading&&<div role="status" className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin"/></div>}{tab==='add'&&candidates.isError&&<button type="button" className="p-4 text-foreground" onClick={()=>void candidates.refetch()}>再読み込み</button>}
 {rows.map(member=>{const included=list.members.some(row=>row.id===member.id);return <ListMemberRow key={member.id} member={member}>{editable&&<Button variant={included?'destructive':'outline'} className="h-9 shrink-0 rounded-full px-3 text-sm" disabled={busy||(!included&&list.members.length>=LIST_MEMBER_LIMIT)} onClick={()=>void change(member,!included)}>{included?'削除':'追加'}</Button>}</ListMemberRow>;})}
 {!rows.length&&!(tab==='add'&&candidates.isLoading)&&<p className="p-6 text-muted-foreground">{tab==='members'?'メンバーはいません。':'ユーザー名で検索してください。'}</p>}</ListDialog>;
}
function ProfileListPicker({member,onClose}:{member:ListMember;onClose:()=>void}){
 const {user}=useAuth();const lists=useLists(user?.id);const invalidate=useInvalidateLists();const mine=(lists.data??[]).filter(list=>list.owner_id===user?.id);const [changes,setChanges]=useState<Record<string,boolean>>({}),[creating,setCreating]=useState(false),[busy,setBusy]=useState(false);
 const save=async()=>{setBusy(true);try{for(const [id,included]of Object.entries(changes))await setListMember(id,member,included);await invalidate();onClose();}catch(error){toast.error(error instanceof Error?error.message:'保存できませんでした');}finally{setBusy(false);}};
 if(creating)return <ListEditor onClose={()=>setCreating(false)} onSaved={()=>setCreating(false)}/>;
 return <ListDialog open onClose={()=>{if(!busy)onClose();}} title="リストを選択"><button type="button" className="w-full border-b border-border p-4 text-left text-foreground" onClick={()=>setCreating(true)}><Plus className="mr-2 inline h-5 w-5"/>新しいリストを作成</button>{lists.isLoading&&<div role="status" className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin"/></div>}{lists.isError&&<button type="button" className="p-4 text-foreground" onClick={()=>void lists.refetch()}>再読み込み</button>}{mine.map(list=>{const checked=changes[list.id]??list.members.some(row=>row.id===member.id);return <button key={list.id} type="button" role="checkbox" aria-checked={checked} disabled={busy||(!checked&&list.members.length>=LIST_MEMBER_LIMIT)} className="flex w-full items-center gap-3 border-b border-border p-4 text-left" onClick={()=>setChanges(value=>({...value,[list.id]:!checked}))}><ListArt src={list.coverUrl} small/><span className="min-w-0 flex-1"><span className="block font-bold">{list.name}{list.is_private&&<Lock className="ml-1 inline h-4 w-4"/>}</span><span className="text-sm text-muted-foreground">{list.members.length}人のメンバー</span></span>{checked&&<Check className="h-5 w-5 text-foreground"/>}</button>;})}<div className="p-4"><Button disabled={busy||!Object.keys(changes).length} className="w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90" onClick={()=>void save()}>{busy?'保存中…':'保存'}</Button></div></ListDialog>;
}

// AccountReviewsTab
// ReviewStars
function ReviewStars({ value }: { value: number }) {
  return <span className="inline-flex shrink-0 text-orange-500" role="img" aria-label={`5つ星のうち${value}`}>
    {[1,2,3,4,5].map(star => <span key={star} className="relative h-5 w-5">
      <Star className="absolute inset-0 h-5 w-5" />
      <span className="absolute inset-y-0 left-0 overflow-hidden" style={{width:`${Math.max(0, Math.min(1, value-star+1))*100}%`}}>
        <Star className="h-5 w-5 fill-current" />
      </span>
    </span>)}
  </span>;
}

// AccountReviewsTab
function AccountReviewsTab({ profileId }: { profileId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const key = accountReviewsKey(profileId);
  const query = useInfiniteQuery({ queryKey: [...key, user?.id], initialPageParam: 0,
    queryFn: ({ pageParam }) => getAccountReviews(profileId, pageParam),
    getNextPageParam: (last, pages) => pages.reduce((n,p)=>n+p.reviews.length,0)<last.total
      && last.reviews.length ? pages.reduce((n,p)=>n+p.reviews.length,0) : undefined,
  });
  const summary = query.data?.pages[0];
 const pageEnd = useAutoPagination(query, true);
  const reviews = query.data?.pages.flatMap(page => page.reviews) ?? [];
  const ownReview = reviews.find(review => review.author_id === user?.id);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const mutation = useMutation({ mutationFn: () => submitAccountReview(profileId, rating, title, content),
    onSuccess: async () => { await queryClient.invalidateQueries({queryKey:key}); setOpen(false); toast.success('レビューを保存しました'); },
    onError: () => toast.error('レビューを保存できませんでした。もう一度お試しください。'),
  });
  const startReview = () => {
    if (!user) { toast.error('レビューの投稿にはログインが必要です'); return; }
    setRating(ownReview?.rating ?? 0); setTitle(ownReview?.title ?? ''); setContent(ownReview?.content ?? ''); setOpen(true);
  };
  if (query.isPending) return <p className="p-6 text-muted-foreground" role="status">レビューを読み込み中...</p>;
  if (query.isError) return <div className="p-6"><p role="alert">レビューの取得に失敗しました。</p><Button variant="outline" onClick={()=>query.refetch()}>再試行</Button></div>;
  if (!summary?.enabled) return <p className="p-6 text-muted-foreground">このアカウントのレビューは現在利用できません。</p>;
  return <section data-lime-account-reviews className="relative left-1/2 w-screen min-w-0 -translate-x-1/2 px-4 py-6 sm:left-auto sm:w-auto sm:translate-x-0 sm:px-6">
    <div className="flex flex-wrap items-center gap-3"><ReviewStars value={summary.average}/><span className="text-lg">5つのうち{summary.average.toFixed(1)}つ</span></div>
    <p className="mt-2 text-sm text-muted-foreground">{summary.total.toLocaleString()}件の評価</p>
    <div className="my-6 space-y-3" aria-label="星ごとの評価の割合">
      {[5,4,3,2,1].map(star=>{
        const percentage = summary.total ? Math.round((summary.distribution[String(star)]??0)/summary.total*100) : 0;
        return <div key={star} className="flex items-center gap-4 text-sm">
          <span className="w-10 shrink-0">星{star}つ</span>
          <div role="meter" aria-label={`星${star}つの割合`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} className="h-6 flex-1 overflow-hidden rounded-md border border-border bg-muted/30"><div className="h-full bg-orange-500" style={{width:`${percentage}%`}} /></div>
          <span className="w-10 shrink-0 text-right">{percentage}%</span>
        </div>;
      })}
    </div>
    <div data-lime-review-compose className="-mx-4 border-b border-border px-4 py-6 sm:-mx-6 sm:px-6">
      <Button variant="outline" className="w-full rounded-full hover:bg-background hover:text-foreground active:bg-background focus:bg-background focus-visible:ring-border" onClick={startReview}>{ownReview ? 'レビューを編集' : 'レビューを書く'}</Button>
    </div>
    {reviews.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">まだレビューがありません。</p>}
    <div>{reviews.map(review=><article key={review.id} data-lime-account-review className="-mx-4 border-b border-border px-4 py-6 sm:-mx-6 sm:px-6">
      <Link to={`/u/${review.author.username}`} className="inline-flex max-w-full items-center gap-3">
        <Avatar className="h-9 w-9 shrink-0"><AvatarImage src={review.author.avatar_url || undefined}/><AvatarFallback>{(review.author.display_name||review.author.username).slice(0,1)}</AvatarFallback></Avatar>
        <span className="flex min-w-0 items-center gap-1">
          <span data-lime-review-author-name className="min-w-0 truncate font-semibold leading-tight">{review.author.display_name || review.author.username}</span>
          {review.author.is_private && <PrivateAccountBadge/>}{review.author.is_official && <img src={`${import.meta.env.BASE_URL}verified.png`} alt="認証済み" className="h-[1.1em] w-[1.1em] shrink-0 translate-y-[1px]"/>}
        </span>
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-2"><ReviewStars value={review.rating}/>{review.title && <h3 className="min-w-0 break-words font-bold">{review.title}</h3>}</div>
      <p className="mt-1 text-sm text-muted-foreground">{new Date(review.created_at).toLocaleDateString('ja-JP',{year:'numeric',month:'long',day:'numeric'})}にレビュー</p>
      <p className="mt-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{review.content}</p>
      <div className="mt-3"><LikeButton postId={review.id} liked={review.liked_by_me} count={review.likes_count} syncState
        persistLike={async liked=>{
          try { return await setAccountReviewLike(review.id,liked); }
          catch(error) { toast.error(user ? 'いいねを保存できませんでした' : 'いいねにはログインが必要です'); throw error; }
        }} onChange={()=>{void queryClient.invalidateQueries({queryKey:key});}}/></div>
    </article>)}</div>
    <div ref={pageEnd} className="h-px" aria-hidden="true" />
    {query.isFetchNextPageError && <p role="alert" className="mt-2 text-sm text-destructive">追加のレビューを取得できませんでした。再度読み込んでください。</p>}
    <Dialog open={open} onOpenChange={value=>{if(!mutation.isPending)setOpen(value);}}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto max-sm:inset-0 max-sm:z-[2147483200] max-sm:flex max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:flex-col max-sm:rounded-none max-sm:border-0 max-sm:pt-[calc(1.5rem+env(safe-area-inset-top))] max-sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))] max-sm:shadow-none max-sm:data-[state=open]:animate-none max-sm:data-[state=closed]:animate-none max-sm:[&>button]:top-[calc(1rem+env(safe-area-inset-top))]"><DialogHeader><DialogTitle>{ownReview ? 'レビューを編集' : 'レビューを書く'}</DialogTitle><DialogDescription>星評価と感想を入力してください。</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={event=>{event.preventDefault(); if(rating && content.trim())mutation.mutate();}}>
          <fieldset><legend className="mb-2 text-sm font-medium">星評価（必須）</legend><div className="flex gap-2">
            {[1,2,3,4,5].map(star=><label key={star} className="relative cursor-pointer rounded-md p-1 focus-within:ring-2 focus-within:ring-ring">
              <input type="radio" name="rating" value={star} checked={rating===star} onChange={()=>setRating(star)} aria-label={`星${star}つ`} required className="sr-only"/>
              <Star className={`h-8 w-8 ${star<=rating?'fill-orange-500 text-orange-500':'text-muted-foreground'}`}/>
            </label>)}
          </div></fieldset>
          <label className="block text-sm font-medium" htmlFor="review-title">タイトル（任意）</label><Input id="review-title" maxLength={100} value={title} onChange={e=>setTitle(e.target.value)}/>
          <label className="block text-sm font-medium" htmlFor="review-content">レビュー（必須）</label><Textarea id="review-content" required maxLength={2000} rows={5} value={content} onChange={e=>setContent(e.target.value)}/>
          <p className="text-right text-xs text-muted-foreground">{content.length}/2000</p>
          <Button type="submit" className="w-full" disabled={mutation.isPending||!rating||!content.trim()}>{mutation.isPending?'保存中...':'レビューを保存'}</Button>
        </form>
      </DialogContent>
    </Dialog>
  </section>;
}

export { ListDialog };
export { ListArt };
export { ListEditor };
export { ListMemberRow };
export { ListMembers };
export { ProfileListPicker };
export { AccountReviewsTab };
export { ReviewStars };
