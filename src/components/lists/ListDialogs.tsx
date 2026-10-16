import {displayUsername} from '@/lib/displayUsername';
import {ProviderVerificationBadge} from '@/components/common/ProviderVerificationBadge';
import {Avatar,AvatarImage,AvatarFallback} from '@/components/ui/avatar';
import {Link} from 'react-router-dom';
import {PrivateAccountBadge} from "@/components/common/OfficialBadge";
import {searchProfileUser} from '@/lib/accountSearch';
import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Check,Loader2,ImagePlus,Lock,Plus,X} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {saveList,setListMember,searchListUsers,discardListCover,type UserList,type ListMember} from '@/api/lists';
import {useInvalidateLists,useLists} from '@/hooks/useLists';
import {useAuth} from '@/hooks/useAuth';
import {toast} from 'sonner';
import {supabase} from '@/lib/supabase';

export function ListDialog({open,onClose,title,children}:{open:boolean;onClose:()=>void;title:string;children:React.ReactNode}){
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
export function ListArt({src,small=false}:{src?:string;small?:boolean}){
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
export function ListEditor({list,onClose,onSaved}:{list?:UserList;onClose:()=>void;onSaved:(list:UserList)=>void}){
 const invalidate=useInvalidateLists();const [name,setName]=useState(list?.name??''),[description,setDescription]=useState(list?.description??''),[privateList,setPrivate]=useState(list?.is_private??false),[file,setFile]=useState<File>(),[removeCover,setRemoveCover]=useState(false),[preview,setPreview]=useState<string>(),[busy,setBusy]=useState(false);const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(!file){setPreview(undefined);return;}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);},[file]);
 const save=async()=>{setBusy(true);try{const result=await saveList({id:list?.id,name,description,is_private:privateList,cover_ref:removeCover?null:undefined,file});await invalidate();if(list?.cover_ref&&(file||removeCover))void discardListCover(list.cover_ref).catch(()=>{});onSaved(result);}catch(error){toast.error(error instanceof Error?error.message:'リストを保存できませんでした');}finally{setBusy(false);}};
 return <ListDialog open onClose={()=>{if(!busy)onClose();}} title={list?'リストを編集':'新しいリストを作成'}><div className="relative"><ListArt src={preview??(!removeCover?list?.coverUrl:undefined)}/><div className="absolute inset-0 flex items-center justify-center gap-4"><button type="button" aria-label="リスト画像を選択" disabled={busy} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white" onClick={()=>input.current?.click()}><ImagePlus className="h-5 w-5"/></button>{(preview||(!removeCover&&list?.cover_ref))&&<button type="button" aria-label="リスト画像を削除" disabled={busy} className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white" onClick={()=>{setFile(undefined);setRemoveCover(true);}}><X className="h-5 w-5"/></button>}</div><input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={event=>{const next=event.target.files?.[0];event.target.value='';if(next){setFile(next);setRemoveCover(false);}}}/></div>
 <form className="space-y-6 p-4 sm:p-6" onSubmit={event=>{event.preventDefault();void save();}}><label className="block rounded-lg border border-border px-3 py-2"><span className="text-sm text-muted-foreground">名前</span><input aria-label="リストの名前" className="mt-1 block w-full bg-transparent text-lg outline-none" value={name} maxLength={50} disabled={busy} onChange={event=>setName(event.target.value)}/></label><label className="block rounded-lg border border-border px-3 py-2"><span className="text-sm text-muted-foreground">詳細</span><textarea aria-label="リストの詳細" rows={3} className="mt-1 block w-full resize-none bg-transparent outline-none" value={description} maxLength={500} disabled={busy} onChange={event=>setDescription(event.target.value)}/></label><label className="flex items-start justify-between gap-4"><span><span className="block font-bold">非公開にする</span><span className="mt-1 block text-sm text-muted-foreground"></span></span><input type="checkbox" aria-label="非公開にする" checked={privateList} disabled={busy} onChange={event=>setPrivate(event.target.checked)} className="mt-1 h-5 w-5 accent-foreground"/></label><Button type="submit" disabled={busy||!name.trim()} className="w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90">{busy?'保存中…':list?'完了':'作成する'}</Button></form></ListDialog>;
}
export function ListMemberRow({member,children}:{member:ListMember;children?:React.ReactNode}) {return <div className="flex items-start gap-3 border-b border-border px-4 py-4"><Link to={`/u/${encodeURIComponent(member.username)}`} className="flex min-w-0 flex-1 items-start gap-3"><Avatar userId={member.id} className="h-10 w-10 shrink-0"><AvatarImage src={member.avatarUrl} alt=""/><AvatarFallback className="bg-muted text-sm font-bold">{member.displayName?.slice(0,1)||'U'}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-1"><span className="break-words font-bold leading-snug">{member.displayName}</span>{member.isPrivate&&<PrivateAccountBadge/>}<ProviderVerificationBadge verification={member.providerVerification} className="h-[18px] w-[18px] shrink-0 object-contain"/>{member.isOfficial&&<img src={`${import.meta.env.BASE_URL}verified.png`} alt="認証済み" className="h-[18px] w-[18px] shrink-0 object-contain"/>}</div><p className="break-all text-sm text-muted-foreground">@{displayUsername(member.username)}</p>{member.bio&&<p className="mt-1 line-clamp-3 break-words text-sm">{member.bio}</p>}</div></Link>{children}</div>;}

export function ListMembers({list,editable,onClose}:{list:UserList;editable:boolean;onClose:()=>void}){
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
 {rows.map(member=>{const included=list.members.some(row=>row.id===member.id);return <ListMemberRow key={member.id} member={member}>{editable&&<Button variant={included?'destructive':'outline'} className="h-9 shrink-0 rounded-full px-3 text-sm" disabled={busy||(!included&&list.members.length>=100)} onClick={()=>void change(member,!included)}>{included?'削除':'追加'}</Button>}</ListMemberRow>;})}
 {!rows.length&&!(tab==='add'&&candidates.isLoading)&&<p className="p-6 text-muted-foreground">{tab==='members'?'メンバーはいません。':'ユーザー名で検索してください。'}</p>}</ListDialog>;
}
export function ProfileListPicker({member,onClose}:{member:ListMember;onClose:()=>void}){
 const {user}=useAuth();const lists=useLists(user?.id);const invalidate=useInvalidateLists();const mine=(lists.data??[]).filter(list=>list.owner_id===user?.id);const [changes,setChanges]=useState<Record<string,boolean>>({}),[creating,setCreating]=useState(false),[busy,setBusy]=useState(false);
 const save=async()=>{setBusy(true);try{for(const [id,included]of Object.entries(changes))await setListMember(id,member,included);await invalidate();onClose();}catch(error){toast.error(error instanceof Error?error.message:'保存できませんでした');}finally{setBusy(false);}};
 if(creating)return <ListEditor onClose={()=>setCreating(false)} onSaved={()=>setCreating(false)}/>;
 return <ListDialog open onClose={()=>{if(!busy)onClose();}} title="リストを選択"><button type="button" className="w-full border-b border-border p-4 text-left text-foreground" onClick={()=>setCreating(true)}><Plus className="mr-2 inline h-5 w-5"/>新しいリストを作成</button>{lists.isLoading&&<div role="status" className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin"/></div>}{lists.isError&&<button type="button" className="p-4 text-foreground" onClick={()=>void lists.refetch()}>再読み込み</button>}{mine.map(list=>{const checked=changes[list.id]??list.members.some(row=>row.id===member.id);return <button key={list.id} type="button" role="checkbox" aria-checked={checked} disabled={busy} className="flex w-full items-center gap-3 border-b border-border p-4 text-left" onClick={()=>setChanges(value=>({...value,[list.id]:!checked}))}><ListArt src={list.coverUrl} small/><span className="min-w-0 flex-1"><span className="block font-bold">{list.name}{list.is_private&&<Lock className="ml-1 inline h-4 w-4"/>}</span><span className="text-sm text-muted-foreground">{list.members.length}人のメンバー</span></span>{checked&&<Check className="h-5 w-5 text-foreground"/>}</button>;})}<div className="p-4"><Button disabled={busy||!Object.keys(changes).length} className="w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90" onClick={()=>void save()}>{busy?'保存中…':'保存'}</Button></div></ListDialog>;
}
