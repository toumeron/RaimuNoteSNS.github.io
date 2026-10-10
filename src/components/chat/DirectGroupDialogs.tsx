import {listAssistants,loadAvatars,avatarOf} from '@/lib/aiFriends';
import {createGroupWithFriends,addGroupFriends,removeGroupFriend} from '@/api/directMessages';
import {uploadProfileMedia} from '@/lib/uploadProfileMedia';
import {useEffect,useRef,useState} from 'react';
import {Link,useNavigate} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {ArrowLeft,Bell,BellOff,Check,Copy,Link2,LogOut,MoreHorizontal,Pencil,Shield,UserPlus,Users,X} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {DropdownMenu,DropdownMenuItem,DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {ChatMenuContent} from '@/components/ai/ChatMenuContent';
import {Avatar,AvatarFallback,AvatarImage} from '@/components/ui/avatar';
import {PrivateAccountBadge} from '@/components/common/PrivateAccountBadge';
import {ProfileImageCropper} from '@/components/profile/ProfileImageCropper';
import {useAuth} from '@/hooks/useAuth';
import {addDirectGroupMembers,createDirectGroup,getDirectInbox,manageDirectGroupMember,muteDirectGroup,searchDirectPeers,setDirectGroupInvite,updateDirectGroup,type DirectGroup,type DirectPeer} from '@/api/directMessages';

export type GroupDialogView='create'|'add'|'edit'|'details'|'invite'|'access'|null;
export function GroupAvatar({peer,large=false}:{peer:DirectPeer;large?:boolean}){
 return <span className={`dm-group-avatar ${large?'is-large':''}`}>
  {peer.avatarUrl?<Avatar><AvatarImage src={peer.avatarUrl}/><AvatarFallback><Users/></AvatarFallback></Avatar>:(peer.groupAvatars?.length?peer.groupAvatars.slice(0,2).map((src,i)=><Avatar key={i}><AvatarImage src={src||undefined}/><AvatarFallback><Users size={large?36:18}/></AvatarFallback></Avatar>):<Avatar><AvatarFallback><Users/></AvatarFallback></Avatar>)}
 </span>;
}
function Person({peer}:{peer:DirectPeer}){return <><Avatar className="dm-avatar"><AvatarImage src={peer.avatarUrl}/><AvatarFallback>{peer.displayName[0]}</AvatarFallback></Avatar><span className="dm-conversation-text"><span className="dm-peer-name">{peer.displayName}{peer.isPrivate&&<PrivateAccountBadge className="h-4 w-4"/>}{peer.isOfficial&&<img className="h-4 w-4" src={`${import.meta.env.BASE_URL}verified.png`} alt="認証済み"/>}</span><span className="dm-preview">@{peer.username}</span></span></>;}
export function DirectGroupDialogs({view,onView,group,onChanged,onCreated,onBackgroundChange}:{view:GroupDialogView;onView:(view:GroupDialogView)=>void;group?:DirectGroup;onChanged:()=>Promise<unknown>;onCreated:(id:string)=>void;onBackgroundChange?:()=>void}){
 const {user}=useAuth();const navigate=useNavigate();const [query,setQuery]=useState('');const [debounced,setDebounced]=useState('');const [selected,setSelected]=useState<DirectPeer[]>([]);
 const [name,setName]=useState('');const [description,setDescription]=useState('');const [avatar,setAvatar]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [crop,setCrop]=useState('');const container=useRef<HTMLDivElement>(null);const file=useRef<HTMLInputElement>(null);const [confirmLeave,setConfirmLeave]=useState(false);const [menuMember,setMenuMember]=useState<string|null>(null);const [copied,setCopied]=useState(false);const [inviteEnabled,setInviteEnabled]=useState(false);
 useEffect(()=>setInviteEnabled(!!group?.inviteToken),[group?.inviteToken,view]);
 const choosing=view==='create'||view==='add';const isAdmin=group?.members.some(m=>m.id===user?.id&&m.admin&&m.status==='accepted')??false;
 const canEdit=!!group&&group.status==='accepted'&&(isAdmin||!group.adminOnly);
 useEffect(()=>{setError('');setQuery('');setSelected([]);setConfirmLeave(false);setCopied(false);if(view==='edit'){setName(group?.peer.displayName??'');setDescription(group?.description??'');setAvatar(group?.peer.avatarUrl??'');}},[view,group?.id]);
 useEffect(()=>{const timer=setTimeout(()=>setDebounced(query),250);return()=>clearTimeout(timer)},[query]);
 useEffect(()=>()=>{if(crop)URL.revokeObjectURL(crop)},[crop]);
 const inbox=useQuery({queryKey:['direct-group-candidates',user?.id],queryFn:getDirectInbox,enabled:choosing});
 const search=useQuery({queryKey:['direct-group-search',debounced],queryFn:()=>searchDirectPeers(debounced),enabled:choosing&&!!debounced.trim()});
 const candidates=(debounced.trim()?search.data:inbox.data?.filter(c=>!c.isGroup).map(c=>c.peer))??[];
 const ownFriends=listAssistants(user?.id).map(f=>({id:`ai:${f.id}`,username:'フレンド',displayName:f.name,avatarUrl:avatarOf(f,loadAvatars(user?.id)),createdAt:'',friend:f}));
 const friendDrafts=(selectedPeople:DirectPeer[])=>selectedPeople.filter(p=>p.id.startsWith('ai:')).map(p=>{const f=ownFriends.find(f=>f.id===p.id)!;return {id:f.friend.id,name:f.displayName,avatar:f.avatarUrl,prompt:f.friend.systemPrompt.slice(0,2000)}});
 const people=[...new Map([...candidates,...ownFriends.filter(f=>!query||f.displayName.toLowerCase().includes(query.toLowerCase()))].filter(p=>p.id!==user?.id&&!group?.members.some(m=>m.id===p.id)&&!group?.friends?.some(f=>f.id===`${user?.id}:${p.id.slice(3)}`)).map(p=>[p.id,p])).values()];
 const run=async(action:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:typeof e==='object'&&e&&'message'in e?String(e.message):'処理に失敗しました');}finally{setBusy(false)}};
 const choose=(p:DirectPeer)=>setSelected(list=>list.some(s=>s.id===p.id)?list.filter(s=>s.id!==p.id):[...list,p]);
 const title=choosing?(view==='create'?'グループを作成':'メンバーを追加'):view==='edit'?'グループを編集':view==='invite'?'グループ招待リンク':view==='access'?'アクセス権':'グループの詳細';
 const inviteUrl=group?.inviteToken?`${location.origin}${import.meta.env.BASE_URL}messages?invite=${group.inviteToken}`:'';
 const act=(person:string,action:'admin'|'remove'|'approve'|'reject')=>void run(async()=>{await manageDirectGroupMember(group!.id,person,action);await onChanged()});
 return <Dialog open={!!view} onOpenChange={open=>{if(!open&&!busy)onView(null)}}><DialogContent ref={container} onEscapeKeyDown={event=>{if(menuMember!==null)event.preventDefault()}} className={`dm-dialog dm-group-dialog ${view==='details'?'dm-group-details':''}`}>
  <div className="dm-group-dialog-header">{view&&['edit','invite','access'].includes(view)&&<button type="button" className="dm-icon-button" aria-label="グループの詳細に戻る" onClick={()=>onView('details')}><ArrowLeft size={22}/></button>}<DialogTitle>{title}</DialogTitle>{view==='edit'&&<button type="button" className="dm-primary" disabled={busy||!name.trim()} onClick={()=>void run(async()=>{await updateDirectGroup(group!.id,{name,description,avatar,onlyAdmin:group!.adminOnly});await onChanged();onView('details')})}>保存</button>}</div>
  <DialogDescription className="sr-only">参加者の選択とグループの設定</DialogDescription>
  {choosing?<>
   <p className="dm-muted">参加者を追加</p><button type="button" className="dm-primary dm-group-next" disabled={busy||selected.length<(view==='create'?2:1)} onClick={()=>void run(async()=>{if(view==='create'){const people=selected.filter(p=>!p.id.startsWith('ai:')).map(p=>p.id);const friends=friendDrafts(selected);const id=friends.length?await createGroupWithFriends(people,friends):await createDirectGroup(people);await onChanged();onView(null);onCreated(id)}else{const people=selected.filter(p=>!p.id.startsWith('ai:')).map(p=>p.id);if(people.length)await addDirectGroupMembers(group!.id,people);const friends=friendDrafts(selected);if(friends.length)await addGroupFriends(group!.id,friends);await onChanged();onView('details')}})}>{view==='create'?'次へ':'追加'}</button>
   <label className="dm-search"><Users size={20}/><input autoFocus aria-label="グループの参加者を検索" placeholder="名前またはユーザー名を検索" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <div className="dm-group-chips">{selected.map(p=><button type="button" key={p.id} onClick={()=>choose(p)}><Avatar><AvatarImage src={p.avatarUrl}/><AvatarFallback>{p.displayName[0]}</AvatarFallback></Avatar>{p.displayName}<X size={17}/></button>)}</div>
   <div className="dm-peer-results">{people.map(p=><button type="button" key={p.id} className="dm-conversation" aria-pressed={selected.some(s=>s.id===p.id)} onClick={()=>choose(p)}><Person peer={p}/>{selected.some(s=>s.id===p.id)&&<Check size={22}/>}</button>)}{!people.length&&!search.isFetching&&<p className="dm-muted">名前またはユーザー名で参加者を検索してください。</p>}</div>
  </>:view==='edit'&&group?<>
   <button type="button" className="dm-group-image-edit" aria-label="グループ画像を変更" onClick={()=>file.current?.click()}><GroupAvatar peer={{...group.peer,avatarUrl:avatar}} large/><span><Pencil size={20}/></span></button>
   <input ref={file} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const f=e.target.files?.[0];if(f){if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>10485760)setError('画像はJPEG・PNG・WebP形式で10MB以下にしてください');else setCrop(URL.createObjectURL(f))}e.target.value=''}}/>
   <label className="dm-group-field">グループ名<input aria-label="グループ名" value={name} maxLength={100} onChange={e=>setName(e.target.value)}/></label><label className="dm-group-field">グループの説明<textarea aria-label="グループの説明" value={description} maxLength={1000} onChange={e=>setDescription(e.target.value)}/></label>
   {avatar&&<button type="button" className="dm-secondary" onClick={()=>setAvatar('')}>グループ画像を削除</button>}
  </>:view==='invite'&&group?<>
   <label className="dm-group-setting"><span><strong>グループリンク</strong><small>外部ユーザーにグループへの参加リクエストを許可する</small></span><input type="checkbox" role="switch" aria-label="グループリンク" checked={inviteEnabled} disabled={busy||!isAdmin} onChange={e=>{const enabled=e.target.checked;setInviteEnabled(enabled);void run(async()=>{try{await setDirectGroupInvite(group.id,enabled);await onChanged()}catch(error){setInviteEnabled(!!group.inviteToken);throw error}})}}/></label>
   <p className="dm-group-note">このリンクを知っている人は、グループ名、プロフィール画像、メンバー数を見ることができます。会話は参加が承認されるまで表示されません。</p>
   {inviteUrl&&<><input className="dm-group-link" aria-label="招待リンク" value={inviteUrl} readOnly/><button type="button" className="dm-secondary" onClick={()=>void run(async()=>{await navigator.clipboard.writeText(inviteUrl);setCopied(true)})}><Copy size={18}/>{copied?'コピーしました':'リンクをコピー'}</button></>}
  </>:view==='access'&&group?<>
   <label className="dm-group-setting"><span><strong>編集とメンバー追加は管理者のみ</strong><small>オフにすると参加中のメンバーも変更できます。</small></span><input type="checkbox" role="switch" aria-label="管理者のみ" checked={group.adminOnly} disabled={busy||!isAdmin} onChange={e=>void run(async()=>{await updateDirectGroup(group.id,{name:group.peer.displayName,description:group.description,avatar:group.peer.avatarUrl,onlyAdmin:e.target.checked});await onChanged()})}/></label>
   <p className="dm-muted">参加リクエストの承認・メンバーの削除・管理者の追加・招待リンクの変更は管理者のみ行えます。</p>
  </>:group?<>
   <div className="dm-group-identity"><GroupAvatar peer={group.peer} large/><h2>{group.peer.displayName}</h2><p className="dm-muted">{group.members.length+(group.friends?.length??0)}人のメンバー</p>{group.description&&<p>{group.description}</p>}</div>
   {group.status==='accepted'&&<div className="dm-group-actions">{canEdit&&<><button type="button" onClick={()=>onView('add')}><span><UserPlus/></span>追加</button><button type="button" onClick={()=>onView('edit')}><span><Pencil/></span>編集</button></>}<button type="button" disabled={busy} onClick={()=>void run(async()=>{await muteDirectGroup(group.id,!group.muted);await onChanged()})}><span>{group.muted?<BellOff/>:<Bell/>}</span>{group.muted?'ミュート解除':'ミュート'}</button></div>}
   {onBackgroundChange&&<button type="button" className="dm-secondary" onClick={onBackgroundChange}>チャットの背景</button>}
   {isAdmin&&<div className="dm-group-settings"><button type="button" onClick={()=>onView('invite')}><Link2/><span>グループ招待リンク</span><small>{group.inviteToken?'オン':'オフ'}</small></button><button type="button" onClick={()=>onView('access')}><Shield/><span>アクセス権</span></button></div>}
   {isAdmin&&group.requests.length>0&&<section><h3>参加リクエスト</h3>{group.requests.map(p=><div className="dm-group-member" key={p.id}><Person peer={p}/><button className="dm-secondary" disabled={busy} onClick={()=>act(p.id,'reject')}>拒否</button><button className="dm-primary" disabled={busy} onClick={()=>act(p.id,'approve')}>承認</button></div>)}</section>}
   <section><h3>{group.members.length+(group.friends?.length??0)}人のメンバー</h3><div className="dm-group-members">{canEdit&&<button type="button" className="dm-group-member" onClick={()=>onView('add')}><UserPlus size={25}/>メンバーを追加</button>}{group.members.map(p=><div key={p.id} className="dm-group-member"><Link to={`/u/${p.username}`} onClick={()=>onView(null)} className="dm-group-person"><Person peer={p}/></Link>{p.admin&&<small className="dm-group-admin">管理者</small>}{p.status==='pending'&&<small className="dm-muted">招待中</small>}{isAdmin&&p.id!==user?.id&&<DropdownMenu open={menuMember===p.id} onOpenChange={open=>setMenuMember(open?p.id:null)}><DropdownMenuTrigger asChild><button type="button" className="dm-icon-button" aria-label={`${p.displayName}のメニュー`}><MoreHorizontal size={21}/></button></DropdownMenuTrigger><ChatMenuContent className="dm-menu" align="end" onEscapeKeyDown={event=>{event.preventDefault();setMenuMember(null)}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setMenuMember(null)}}}>{!p.admin&&p.status==='accepted'&&<DropdownMenuItem onSelect={()=>act(p.id,'admin')}>管理者にする</DropdownMenuItem>}<DropdownMenuItem className="dm-delete-item" onSelect={()=>act(p.id,'remove')}>メンバーを削除</DropdownMenuItem></ChatMenuContent></DropdownMenu>}</div>)}{group.friends?.map(f=><div className="dm-group-member" key={f.id}><Person peer={f}/><small className="dm-muted">フレンド</small>{isAdmin&&<button type="button" className="dm-icon-button" aria-label={`${f.displayName}をグループから削除`} disabled={busy} onClick={()=>void run(async()=>{await removeGroupFriend(group.id,f.id);await onChanged()})}><X size={20}/></button>}</div>)}</div></section>
   {group.status==='accepted'&&(confirmLeave?<div className="dm-group-leave"><p>グループから退出しますか？</p><button className="dm-secondary" disabled={busy} onClick={()=>setConfirmLeave(false)}>キャンセル</button><button className="dm-secondary dm-delete-item" disabled={busy} onClick={()=>void run(async()=>{await manageDirectGroupMember(group.id,user!.id,'remove');await onChanged();onView(null);navigate('/messages')})}>退出する</button></div>:<button type="button" className="dm-secondary dm-delete-item" onClick={()=>setConfirmLeave(true)}><LogOut size={18}/>グループから退出</button>)}
  </>:null}
  {error&&<p className="dm-error" role="alert">{error}</p>}
  {crop&&<ProfileImageCropper src={crop} target="avatar" portalContainer={container.current??undefined} onApply={url=>void run(async()=>{try{const blob=await (await fetch(url)).blob();const uploaded=await uploadProfileMedia(new File([blob],'group-avatar.jpg',{type:'image/jpeg'}),'emoji');setAvatar(uploaded.secure_url);setCrop('')}finally{URL.revokeObjectURL(url)}})} onClose={()=>setCrop('')}/>}
 </DialogContent></Dialog>;
}
