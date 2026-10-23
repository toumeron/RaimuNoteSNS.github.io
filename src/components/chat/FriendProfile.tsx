import { ContentLink } from "@/components/ui/button";
import { useEffect, useRef, useState, type RefObject, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Cake, ImagePlus, MessageCircle, MoreVertical, Phone, Star, X, Copy, Heart, Reply, MoreHorizontal, Trash2, Link2, ArrowLeft, Bell, BellOff, Check, LogOut, Pencil, Shield, UserPlus, Users } from "lucide-react";
import { syncFriends, avatarOf, saveCustomAssistant, type AssistantItem, type AvatarMap, prepareChatBackground, useCachedChatImage, listAssistants, loadAvatars } from "@/lib/aiFriends";

import { Dialog, DialogContent, DialogTitle, DialogDescription, Popover, PopoverTrigger, PopoverContent, DropdownMenu, DropdownMenuTrigger, DropdownMenuItem } from "@/components/ui/button";

import { readFriendPhoto, type FriendPhoto as Photo, validFriendPhoto } from "./../../../supabase/functions/_shared/chatContext.ts";
import { deleteDirectMessage, toggleDirectReaction, type DirectMessage, type DirectGroup, createGroupWithFriends, addGroupFriends, removeGroupFriend, addDirectGroupMembers, createDirectGroup, getDirectInbox, manageDirectGroupMember, muteDirectGroup, searchDirectPeers, setDirectGroupInvite, updateDirectGroup, type DirectPeer } from "@/api/users";
import { Avatar, AvatarImage, AvatarFallback, PrivateAccountBadge } from "@/components/ui/avatar";
import { ChatMenuContent } from "@/components/ai/PageCompanion";
import { YouTubeEmbed } from "@/components/feed/PostCard";
import { openMediaViewer } from "@/lib/mediaThumbnail";
import { uploadProfileMedia } from "@/lib/mediaThumbnail";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ProfileImageCropper } from "@/components/profile/ProfileEditor";
import { useAuth } from "@/hooks/useAuth";

// FriendProfile
function FriendProfile({ friend, uid, avatars, onClose, onTalk, onCall, onChanged }: {
  friend: AssistantItem; uid: string | null; avatars: AvatarMap; onClose: () => void;
  onTalk: (friend: AssistantItem) => void; onCall: (friend: AssistantItem) => void; onChanged?: () => void;
}) {
  const [item, setItem] = useState(friend);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const section = useRef<HTMLElement>(null);
  const dismiss = useRef(onClose);
  dismiss.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; close.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss.current();
      if (event.key === 'Tab') {
        const buttons = Array.from(section.current?.querySelectorAll<HTMLElement>('button, input:not([hidden])') ?? []).filter(element => !element.hasAttribute('disabled'));
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', escape);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', escape); previous?.focus(); };
  }, []);
  const save = async (patch: Partial<AssistantItem>) => {
    try {
      const updated = { ...item, ...patch };
      saveCustomAssistant(uid, { ...updated, gender: updated.gender ?? 'female' });
      setItem(updated);
      if(uid)await syncFriends(uid);
      setError(''); onChanged?.();
    } catch { setError('プロフィールを同期できませんでした。接続を確認してお試しください。'); }
  };
  const upload = async (image?: File) => {
    if (!image) return;
    if (!image.type.startsWith('image/')) { setError('画像を選択してください'); return; }
    try {
      const bitmap = await createImageBitmap(image);
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext('2d'); if (!ctx) throw Error('Canvas unavailable');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      await save({ coverUrl: canvas.toDataURL('image/jpeg', .8) });
    } catch { setError('画像を読み込めませんでした'); }
  };
  return createPortal(<div className="lime-friend-profile-overlay">
    <section ref={section} role="dialog" aria-modal="true" aria-label={`${item.name}のプロフィール`} className="lime-friend-profile">
      {item.coverUrl && <img className="friend-profile-cover" src={item.coverUrl} alt="" />}
      <div className="friend-profile-shade" />
      <div className="friend-profile-top">
        <button aria-label="お気に入り" aria-pressed={!!item.favorite} onClick={() => save({ favorite: !item.favorite })}><Star fill={item.favorite ? 'currentColor' : 'none'} /></button>
        <button aria-label="プロフィールを編集" aria-expanded={editing} onClick={() => setEditing(!editing)}><MoreVertical /></button>
        <button ref={close} aria-label="プロフィールを閉じる" onClick={onClose}><X /></button>
      </div>
      <div className="friend-profile-person">
        <img className="friend-profile-avatar" src={avatarOf(item, avatars)} alt="" />
        <h2>{item.name}</h2>
        {item.birthday && <p className="friend-profile-birthday"><Cake size={20} />{Number(item.birthday.slice(0, 2))}/{Number(item.birthday.slice(3))}</p>}
        {item.description && <p className="friend-profile-description">{item.description}</p>}
      </div>
      {editing && <div className="friend-profile-editor">
        <button onClick={() => file.current?.click()}><ImagePlus size={20} />背景画像を変更</button>
        {item.coverUrl && <button onClick={() => save({ coverUrl: '' })}>背景画像を解除</button>}
        <label>誕生日<input type="date" value={item.birthday ? `2000-${item.birthday}` : ''} onChange={e => save({ birthday: e.target.value.slice(5) })} /></label>
      </div>}
      <input ref={file} type="file" accept="image/*" hidden onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
      {error && <p role="alert" className="friend-profile-error">{error}</p>}
      <div className="friend-profile-actions">
        <button onClick={() => { onClose(); onTalk(item); }}><MessageCircle fill="currentColor" /><span>トーク</span></button>
        <button onClick={() => { onClose(); onCall(item); }}><Phone fill="currentColor" /><span>音声通話</span></button>
      </div>
    </section>
  </div>, document.body);
}

// ChatBackgroundDialog
function ChatBackgroundDialog({open,onOpenChange,url,onSave,loadError}:{open:boolean;onOpenChange:(open:boolean)=>void;url:string;onSave:(blob:Blob|null)=>Promise<void>;loadError?:string}){
 const [draft,setDraft]=useState<Blob|null|undefined>();const [preview,setPreview]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const file=useRef<HTMLInputElement>(null);const mounted=useRef(true);const selection=useRef(0);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;selection.current++}},[]);
 useEffect(()=>{selection.current++;setDraft(undefined);setError('');},[open]);
 useEffect(()=>{const next=draft?URL.createObjectURL(draft):'';setPreview(next);return()=>{if(next)URL.revokeObjectURL(next)}},[draft]);
 const choose=async(chosen:File)=>{const token=++selection.current;setBusy(true);setError('');try{const blob=await prepareChatBackground(chosen);if(mounted.current&&token===selection.current)setDraft(blob);}catch(e){if(mounted.current&&token===selection.current)setError(e instanceof Error?e.message:'画像を読み込めませんでした');}finally{if(mounted.current)setBusy(false)}};
 const save=async()=>{if(draft===undefined)return;setBusy(true);setError('');try{await onSave(draft);if(mounted.current)onOpenChange(false);}catch{if(mounted.current)setError('背景を保存できませんでした。接続を確認してお試しください。');}finally{if(mounted.current)setBusy(false)}};
 const shown=draft===undefined?url:preview;
 return <Dialog open={open} onOpenChange={next=>{if(!busy)onOpenChange(next)}}><DialogContent className="dm-dialog dm-background-dialog"><DialogTitle>チャットの背景</DialogTitle><DialogDescription>この会話の背景を設定します。自分のアカウントで同期され、相手には表示されません。</DialogDescription><div className="dm-background-preview" style={shown?{backgroundImage:`url(${JSON.stringify(shown)})`}:undefined}>{!shown&&<span>背景なし</span>}</div><input ref={file} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={e=>{const selected=e.target.files?.[0];e.target.value='';if(selected)void choose(selected)}}/><button className="dm-secondary" type="button" disabled={busy} onClick={()=>file.current?.click()}>画像を選択</button><button className="dm-secondary" type="button" disabled={busy||(!url&&!draft)} onClick={()=>setDraft(null)}>背景を解除</button>{(error||loadError)&&<p className="dm-error" role="alert">{error||loadError}</p>}<div className="dm-delete-controls"><button className="dm-secondary" type="button" disabled={busy} onClick={()=>onOpenChange(false)}>キャンセル</button><button className="dm-primary" type="button" disabled={busy||draft===undefined} onClick={()=>void save()}>{busy?'処理中…':'保存'}</button></div></DialogContent></Dialog>;
}

// PixelCat
const LIME_AI_CAT_ICON=`${import.meta.env.BASE_URL}limeai-cat.png`;
type CatMotion='sit'|'walk'|'pounce';
const head=['...#.....#...','...##...##...','...#######...','..#########..','..##.###.##..','..####.####..','..#########..','...#######...','.....#####...'];
function pixels(rows:string[]){return rows.flatMap((row,y)=>[...row].flatMap((cell,x)=>cell==='#'?[<rect key={`${x}:${y}`} x={x} y={y} width="1" height="1"/>]:[]));}
function useSpriteClock(once:boolean){
 const [frame,setFrame]=useState(0);
 useEffect(()=>{
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');let animation=0,start=performance.now(),last=-1;
  const tick=(now:number)=>{if(reduced.matches||document.hidden)return;const next=once?Math.min(119,Math.floor((now-start)/100)):Math.floor((now-start)/100)%120;if(next!==last){last=next;setFrame(next);}if(!once||next<119)animation=requestAnimationFrame(tick);};
  const restart=()=>{cancelAnimationFrame(animation);if(reduced.matches){setFrame(0);return;}if(!document.hidden){start=performance.now();last=-1;animation=requestAnimationFrame(tick);}};
  restart();reduced.addEventListener('change',restart);document.addEventListener('visibilitychange',restart);
  return()=>{cancelAnimationFrame(animation);reduced.removeEventListener('change',restart);document.removeEventListener('visibilitychange',restart);};
 },[once]);return frame;
}
/** Twelve-second choreography with articulated pixel poses, rather than a bobbing image. */
function PixelCat({motion='walk',perched=false}:{motion?:CatMotion;perched?:boolean}){
 const frame=useSpriteClock(perched),time=frame/10;
 const action=time<2.4?'walk':time<3?'settle':time<5.8?'groom':time<6.6?'look':time<8.2?'stretch':time<9.6?(motion==='sit'?'groom':'jump'):'walk';
 const returnTrip=time>=9.6,direction=returnTrip?-1:1;
 const stride=frame%6,leg=[0,1,1,0,-1,-1][stride];
 let x=time<2.4?2+Math.floor(time*5):time>=9.6?14-Math.floor((time-9.6)*5):14;
 if(perched&&time>11.2)x=14+Math.floor((time-11.2)*22);
 const jump=action==='jump'?-Math.round(Math.sin((time-8.2)/1.4*Math.PI)*4):0;
 const lowered=action==='settle'||action==='groom'?1:0,stretch=action==='stretch';
 const blink=frame%43>=40,tail=[0,1,2,1,0,-1][Math.floor(frame/3)%6];
 const faceShift=action==='look'?1:0;
 return <span className="pixel-cat" aria-hidden="true" data-pixel-cat={motion} data-cat-action={action} data-cat-frame={frame}><svg viewBox="0 0 40 20" shapeRendering="crispEdges" focusable="false"><g transform={`translate(${x+(direction<0?22:0)} ${3+jump}) scale(${direction} 1)`}>
  <g transform={`translate(0 ${action==='walk'&&stride%3===1?-1:0})`}>
   <path d={stretch?'M7 8h9v4H5v-1H3V9h4Z':'M9 8h3V6h3v1h1v5H5v-2H4V9h5Z'}/>
   <g transform={`translate(${faceShift+(stretch?-1:0)} ${lowered+(stretch?2:0)})`}>{pixels(head)}{blink&&<><rect x="4" y="4" width="1" height="1"/><rect x="8" y="4" width="1" height="1"/></>}</g>
   <g transform={`translate(${Math.round(tail/2)} ${stretch?2:0})`}><path d="M16 9h1V4h-1V2h1V1h2v1h1v2h-1V3h-1v7h-2Z"/></g>
  </g>
  {action==='groom'?<><rect x="5" y="11" width="2" height="2"/><rect x="8" y={7+Math.floor(frame/3)%3} width="2" height="2"/><rect x="12" y="12" width="3" height="1"/></>:<>{[4,7,11,14].map((foot,i)=><rect key={foot} x={foot+(action==='walk'?(i%2?leg:-leg):stretch&&i<2?-2:0)} y={action==='jump'?11:12+(action==='walk'&&i%2===stride%2?-1:0)} width="2" height={action==='jump'?1:2}/>)}</>}
 </g></svg></span>;
}
function TypingPixelCat(){return <span className="pixel-cat-typing"><PixelCat/></span>;}
function MessagePixelCat({motion,offset}:{motion:CatMotion;offset?:{left:number;top:number}}){return <span className="pixel-cat-perch" style={offset as CSSProperties}><PixelCat motion={motion} perched/></span>;}
type CatVisit={id:string;motion:CatMotion;offset:{left:number;top:number}};
/** One timer per conversation; choose only visible bubbles with clear space. */
function useMessagePixelCat(root:RefObject<HTMLElement>,scope:string,enabled:boolean){
 const [visit,setVisit]=useState<CatVisit|null>(null);
 useEffect(()=>{
  setVisit(null);if(!enabled)return;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  let timer:ReturnType<typeof setTimeout>|undefined,departure:ReturnType<typeof setTimeout>|undefined;
  const schedule=(first=false)=>{timer=setTimeout(appear,first?20000+Math.random()*40000:80000+Math.random()*100000);};
  const appear=()=>{
   if(document.hidden||reduced.matches||!root.current){schedule();return;}
   const viewport=root.current.getBoundingClientRect();
   const rows=Array.from(root.current.querySelectorAll<HTMLElement>('[data-pixel-cat-message]'));
   const contentBoxes=Array.from(root.current.querySelectorAll('.dm-bubble,.dm-message-media,.dm-group-sender,.dm-sender-avatar')).map(element=>({element,box:element.getBoundingClientRect()}));
   const choices=rows.flatMap(row=>{
    const anchor=row.querySelector('.dm-bubble,.dm-message-media');if(!anchor)return [];
    const box=anchor.getBoundingClientRect(),rowBox=row.getBoundingClientRect();
    const left=row.classList.contains('is-own')?box.right-72:box.left+8;
    const cat={left,right:left+64,top:box.top-34,bottom:box.top+1};
    if(box.width<80||cat.top<viewport.top+2||box.top>=viewport.bottom-24||cat.left<viewport.left||cat.right>viewport.right
     ||contentBoxes.some(other=>other.element!==anchor&&cat.left<other.box.right&&cat.right>other.box.left&&cat.top<other.box.bottom&&cat.bottom>other.box.top))return [];
    return [{row,offset:{left:left-rowBox.left,top:box.top-rowBox.top-27}}];
   });
   if(choices.length){const choice=choices[Math.floor(Math.random()*choices.length)];setVisit({id:choice.row.dataset.pixelCatMessage!,motion:(['sit','walk','pounce'] as const)[Math.floor(Math.random()*3)],offset:choice.offset});departure=setTimeout(()=>setVisit(null),12500);}
   schedule();
  };
  const clear=()=>{setVisit(null);};
  const hide=()=>{if(document.hidden)clear();};
  window.addEventListener('resize',clear);window.visualViewport?.addEventListener('resize',clear);reduced.addEventListener('change',clear);document.addEventListener('visibilitychange',hide);root.current?.addEventListener('scroll',clear,{passive:true});const element=root.current;
  schedule(true);
  return()=>{clearTimeout(timer);clearTimeout(departure);window.removeEventListener('resize',clear);window.visualViewport?.removeEventListener('resize',clear);reduced.removeEventListener('change',clear);document.removeEventListener('visibilitychange',hide);element?.removeEventListener('scroll',clear);};
 },[root,scope,enabled]);
 return visit;
}

// DirectChatMessage
// CachedChatImage
function CachedChatImage({url,account,alt,label,media}:{url:string;account?:string;alt:string;label:string;media?:string[]}){
 const src=useCachedChatImage(url,account);
 return <button type="button" className="dm-media-image" aria-label={label} onClick={()=>openMediaViewer({url:src||url,media:(media??[url]).map(item=>({src:item===url?src||url:item,type:'image'}))})}><img src={src||undefined} alt={alt} loading="lazy" referrerPolicy="no-referrer"/></button>;
}

// FriendPhoto
function FriendPhoto({photo,account}:{photo:Photo|null;account?:string}){
 const src=useCachedChatImage(photo?.url??'',account);const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[photo?.url]);if(!photo||!validFriendPhoto(photo)||failed)return null;
 return <figure className="dm-friend-photo"><div className="dm-message-media"><button type="button" className="dm-media-image" aria-label="フレンドの画像を拡大" onClick={()=>openMediaViewer({url:src||photo.url,media:[{src:src||photo.url,type:'image'}]})}><img src={src||undefined} alt={photo.title} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/></button></div><figcaption><a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer">Wikimedia Commons</a>{photo.artist&&` · ${photo.artist}`} · {photo.license}</figcaption></figure>;
}

// DirectChatMessage
const emojis=['👍','😢','👩‍💻','🆗','🙏','😮','😋','😭','🎉','👎','❤️','🔥','🤠','😂','🤩','🙃','💯','🧠','⭕'];
function DirectChatMessage({message:m,userId,group,content,media,enabled,onChanged,onReply,reply,cat}:{message:DirectMessage;userId:string;group?:DirectGroup;content:ReactNode;media?:ReactNode;enabled:boolean;onChanged:()=>Promise<unknown>;onReply:()=>void;reply?:DirectMessage;cat?:ReactNode}){
 const own=m.sender_id===userId&&!m.friend_id;const member=group?.members.find(p=>p.id===m.sender_id);const name=m.friend_name??member?.displayName??'メンバー';const avatar=m.friend_avatar??member?.avatarUrl;
 const row=useRef<HTMLDivElement>(null);const [expanded,setExpanded]=useState(false);const [selected,setSelected]=useState(false);const [picker,setPicker]=useState(false);const [menu,setMenu]=useState(false);const [deleting,setDeleting]=useState<boolean|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const hold=useRef<ReturnType<typeof setTimeout>>();const origin=useRef({x:0,y:0});const held=useRef(false);
 useEffect(()=>()=>clearTimeout(hold.current),[]);
 useEffect(()=>{if(!selected)return;const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!row.current?.contains(event.target))setSelected(false)};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside)},[selected]);
 const action=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();setPicker(false);setDeleting(null);await onChanged();}catch(e){setError(e instanceof Error?e.message:typeof e==='object'&&e&&'message' in e?String(e.message):'処理できませんでした。もう一度お試しください');}finally{setBusy(false)}};
 const reaction=(emoji:string)=>void action(()=>toggleDirectReaction(m.id,emoji));
 return <div ref={row} className={`dm-message dm-action-message ${own?'is-own':''} ${group?'dm-group-message':''}`} data-pixel-cat-message={m.id} data-message-id={m.id} data-tools-active={selected||picker||menu||undefined}>
  {cat}
  <div className="dm-message-body">
   {group&&!own&&<div className="dm-group-sender"><span>{name}</span></div>}
   <div className="dm-message-content" onContextMenu={e=>{e.preventDefault();setMenu(true)}} onPointerDown={e=>{held.current=false;origin.current={x:e.clientX,y:e.clientY};if(e.pointerType!=='mouse')hold.current=setTimeout(()=>{held.current=true;setMenu(true)},500)}} onPointerUp={()=>clearTimeout(hold.current)} onPointerCancel={()=>clearTimeout(hold.current)} onPointerMove={e=>{if(Math.hypot(e.clientX-origin.current.x,e.clientY-origin.current.y)>10)clearTimeout(hold.current)}} onClick={()=>{if(window.matchMedia('(hover: none)').matches)setSelected(true)}} onClickCapture={e=>{if(held.current){e.preventDefault();e.stopPropagation();held.current=false}}}>
  {group&&!own&&<Avatar className="dm-sender-avatar"><AvatarImage src={avatar||undefined}/><AvatarFallback>{name[0]}</AvatarFallback></Avatar>}
    {reply&&<div className="dm-reply-context"><span>{reply.friend_name??group?.members.find(member=>member.id===reply.sender_id)?.displayName??'メッセージ'}</span><p>{(reply.friend_id?readFriendPhoto(reply.content).text:reply.content)||'画像'}</p></div>}
    {m.friend_id&&<FriendPhoto photo={readFriendPhoto(m.content).photo} account={userId}/>}
    {!!m.mediaUrls.length&&<div className={`dm-message-media ${group&&m.mediaUrls.length>1?'dm-media-grid':''}`}>{m.mediaUrls.map((url,j)=><CachedChatImage key={url} url={url} account={userId} alt={`添付画像${j+1}`} label={`添付画像${j+1}を拡大`} media={m.mediaUrls}/>)}</div>}
    {media}
    {content&&<div className="dm-bubble">{content}<time dateTime={m.created_at}>{new Date(m.created_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</time></div>}
    {!content&&<time className="dm-media-time" dateTime={m.created_at}>{new Date(m.created_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</time>}
   </div>
   <div className="dm-reactions">{Object.entries(m.reactions??{}).filter(([,users])=>Object.keys(users).length).map(([emoji,users])=><button key={emoji} type="button" className={users[userId]?'is-reacted':''} aria-label={`${emoji} ${Object.keys(users).length}件のリアクション`} aria-pressed={!!users[userId]} disabled={busy||!enabled} onClick={()=>reaction(emoji)}>{emoji}<strong>{Object.keys(users).length}</strong></button>)}</div>
   <div className="dm-message-actions">
    {enabled&&<Popover open={picker} onOpenChange={setPicker}><PopoverTrigger asChild><button type="button" className="dm-icon-button" aria-label="リアクションを追加"><span className="dm-reaction-add-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13.5 19.5 12 21l-8.5-8.5a5.5 5.5 0 0 1 7.8-7.8L12 5.4l.7-.7a5.5 5.5 0 0 1 7.8 7.8L19 14"/><path d="M19 16v6m-3-3h6"/></svg></span></button></PopoverTrigger><PopoverContent className="dm-reaction-picker" side="top" align={own?'end':'start'} aria-label="絵文字を選択">{(expanded?emojis:emojis.slice(0,13)).map(emoji=><button type="button" key={emoji} aria-label={emoji} disabled={busy} onClick={()=>reaction(emoji)}>{emoji}</button>)}{!expanded&&<button type="button" aria-label="すべての絵文字" onClick={()=>setExpanded(true)}><MoreHorizontal size={22}/></button>}</PopoverContent></Popover>}
    {enabled&&<button type="button" className="dm-icon-button" aria-label="返信" onClick={onReply}><Reply size={20}/></button>}
    <DropdownMenu modal={false} open={menu} onOpenChange={setMenu}><DropdownMenuTrigger asChild><button type="button" className="dm-icon-button" aria-label="メッセージの操作"><MoreHorizontal size={19}/></button></DropdownMenuTrigger><ChatMenuContent className="dm-message-menu" align={own?'end':'start'}>{enabled&&<DropdownMenuItem onSelect={onReply}><Reply size={20}/>返信</DropdownMenuItem>}{enabled&&<DropdownMenuItem onSelect={()=>setPicker(true)}><Heart size={20}/>リアクションを追加</DropdownMenuItem>}<DropdownMenuItem onSelect={()=>void action(()=>navigator.clipboard.writeText(m.friend_id?readFriendPhoto(m.content).text:m.content))}><Copy size={20}/>メッセージをコピー</DropdownMenuItem><DropdownMenuItem className="dm-delete-item" onSelect={()=>setDeleting(false)}><Trash2 size={20}/>自分から削除</DropdownMenuItem>{m.sender_id===userId&&<DropdownMenuItem className="dm-delete-item" onSelect={()=>setDeleting(true)}><Trash2 size={20}/>全員から削除</DropdownMenuItem>}</ChatMenuContent></DropdownMenu>
   </div>
   {error&&<p role="alert" className="dm-error">{error}</p>}
  </div>
  <Dialog open={deleting!==null} onOpenChange={open=>{if(!open&&!busy)setDeleting(null)}}><DialogContent className="dm-dialog"><DialogTitle>{deleting?'全員から削除':'自分から削除'}</DialogTitle><DialogDescription>{deleting?'このメッセージを全員の画面から削除します。':'このメッセージを自分の画面から削除します。他のメンバーの画面には残ります。'}</DialogDescription>{error&&<p role="alert" className="dm-error">{error}</p>}<div className="dm-delete-controls"><button type="button" className="dm-secondary" disabled={busy} onClick={()=>setDeleting(null)}>キャンセル</button><button type="button" className="dm-primary" disabled={busy} onClick={()=>void action(()=>deleteDirectMessage(m.id,deleting===true))}>削除する</button></div></DialogContent></Dialog>
 </div>;
}

// DirectMessageContent
const linkPattern=/https?:\/\/[^\s<>"']+/g;
function youtubeMessageId(value:string):string|null {
 try{
  const url=new URL(value);
  let id:string|null=null;
  if(url.hostname==='youtu.be')id=url.pathname.split('/')[1];
  else if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com'].includes(url.hostname)){
   if(url.pathname==='/watch')id=url.searchParams.get('v');
   else if(/^\/(shorts|live|embed)\//.test(url.pathname))id=url.pathname.split('/')[2];
  }
  return id&&/^[\w-]{11}$/.test(id)?id:null;
 }catch{return null;}
}
function directMessageVideoIds(content:string):string[] {
 return [...new Set([...content.matchAll(linkPattern)].map(match=>youtubeMessageId(match[0].replace(/[。、,!?）)\]}]+$/g,''))).filter((id):id is string=>!!id))].slice(0,3);
}
function directMessageText(content:string):string {
 return content.replace(linkPattern,link=>youtubeMessageId(link.replace(/[。、,!?）)\]}]+$/g,''))?'':link).trim();
}
function DirectMessageMedia({content}:{content:string}) {
 const videos=directMessageVideoIds(content);
 return videos.length?<div className="dm-message-media dm-youtube-media">{videos.map(id=><div key={id} className="dm-video-embed" onClick={event=>event.stopPropagation()}><YouTubeEmbed videoId={id}/></div>)}</div>:null;
}
function DirectMessageContent({content}:{content:string}) {
 const text=directMessageText(content);
 if(!text)return null;
 let solo:URL|null=null;
 if(/^https?:\/\/[^\s]+$/.test(text)){try{solo=new URL(text);}catch{/* Render an incomplete URL as ordinary message text. */}}
 return <div className="dm-message-text">
  {solo?<ContentLink className="dm-link-card" href={solo.href} target="_blank" rel="noopener noreferrer" title={solo.href} onClick={event=>event.stopPropagation()}><span className="dm-link-icon" aria-hidden="true"><Link2 size={22}/></span><span className="dm-link-copy"><strong>{solo.href.replace(/^https?:\/\//,'')}</strong><span className="dm-link-domain">{solo.hostname}</span></span></ContentLink>:<p>{text.split(/(https?:\/\/[^\s]+)/g).map((part,i)=>/^https?:\/\//.test(part)?<ContentLink key={i} href={part} target="_blank" rel="noopener noreferrer" onClick={event=>event.stopPropagation()}>{part}</ContentLink>:part)}</p>}
 </div>;
}

// DirectGroupDialogs
type GroupDialogView='create'|'add'|'edit'|'details'|'invite'|'access'|null;
function GroupAvatar({peer,large=false}:{peer:DirectPeer;large?:boolean}){
 return <span className={`dm-group-avatar ${large?'is-large':''}`}>
  {peer.avatarUrl?<Avatar><AvatarImage src={peer.avatarUrl}/><AvatarFallback><Users/></AvatarFallback></Avatar>:(peer.groupAvatars?.length?peer.groupAvatars.slice(0,2).map((src,i)=><Avatar key={i}><AvatarImage src={src||undefined}/><AvatarFallback><Users size={large?36:18}/></AvatarFallback></Avatar>):<Avatar><AvatarFallback><Users/></AvatarFallback></Avatar>)}
 </span>;
}
function Person({peer}:{peer:DirectPeer}){return <><Avatar className="dm-avatar"><AvatarImage src={peer.avatarUrl}/><AvatarFallback>{peer.displayName[0]}</AvatarFallback></Avatar><span className="dm-conversation-text"><span className="dm-peer-name">{peer.displayName}{peer.isPrivate&&<PrivateAccountBadge className="h-4 w-4"/>}{peer.isOfficial&&<img className="h-4 w-4" src={`${import.meta.env.BASE_URL}verified.png`} alt="認証済み"/>}</span><span className="dm-preview">@{peer.username}</span></span></>;}
function DirectGroupDialogs({view,onView,group,onChanged,onCreated,onBackgroundChange}:{view:GroupDialogView;onView:(view:GroupDialogView)=>void;group?:DirectGroup;onChanged:()=>Promise<unknown>;onCreated:(id:string)=>void;onBackgroundChange?:()=>void}){
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
   {inviteUrl&&<><input className="dm-group-link" aria-label="招待リンク" value={inviteUrl} readOnly/><button type="button" className="dm-secondary" onClick={()=>void run(async()=>{await navigator.clipboard.writeText(inviteUrl);setCopied(true)})}><Copy size={18}/>{copied?'コピーしました':'リンクをコピー'}</button></>}
  </>:view==='access'&&group?<>
   <label className="dm-group-setting"><span><strong>編集とメンバー追加は管理者のみ</strong><small>オフにすると参加中のメンバーも変更できます。</small></span><input type="checkbox" role="switch" aria-label="管理者のみ" checked={group.adminOnly} disabled={busy||!isAdmin} onChange={e=>void run(async()=>{await updateDirectGroup(group.id,{name:group.peer.displayName,description:group.description,avatar:group.peer.avatarUrl,onlyAdmin:e.target.checked});await onChanged()})}/></label>
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

export { FriendProfile };
export { ChatBackgroundDialog };
export { PixelCat };
export { TypingPixelCat };
export { MessagePixelCat };
export { useMessagePixelCat };
export { LIME_AI_CAT_ICON };
export type { CatMotion };
export type { CatVisit };
export { DirectChatMessage };
export { youtubeMessageId };
export { directMessageVideoIds };
export { directMessageText };
export { DirectMessageMedia };
export { DirectMessageContent };
export { CachedChatImage };
export { FriendPhoto };
export { GroupAvatar };
export { DirectGroupDialogs };
export type { GroupDialogView };
