import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Copy,Heart,Plus,Reply,MoreHorizontal,Trash2} from 'lucide-react';
import {deleteDirectMessage,toggleDirectReaction,type DirectMessage,type DirectGroup} from '@/api/directMessages';
import {Avatar,AvatarImage,AvatarFallback} from '@/components/ui/avatar';
import {Popover,PopoverTrigger,PopoverContent} from '@/components/ui/popover';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuItem} from '@/components/ui/dropdown-menu';
import {ChatMenuContent} from '@/components/ai/ChatMenuContent';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {openMediaViewer} from '@/components/media/openMediaViewer';
const emojis=['👍','😢','👩‍💻','🆗','🙏','😮','😋','😭','🎉','👎','❤️','🔥','🤠','😂','🤩','🙃','💯','🧠','⭕'];
export function DirectChatMessage({message:m,userId,group,content,enabled,onChanged,onReply,reply}:{message:DirectMessage;userId:string;group?:DirectGroup;content:ReactNode;enabled:boolean;onChanged:()=>Promise<unknown>;onReply:()=>void;reply?:DirectMessage}){
 const own=m.sender_id===userId&&!m.friend_id;const member=group?.members.find(p=>p.id===m.sender_id);const name=m.friend_name??member?.displayName??'メンバー';const avatar=m.friend_avatar??member?.avatarUrl;
 const row=useRef<HTMLDivElement>(null);const [expanded,setExpanded]=useState(false);const [selected,setSelected]=useState(false);const [picker,setPicker]=useState(false);const [menu,setMenu]=useState(false);const [deleting,setDeleting]=useState<boolean|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const hold=useRef<ReturnType<typeof setTimeout>>();const origin=useRef({x:0,y:0});const held=useRef(false);
 useEffect(()=>()=>clearTimeout(hold.current),[]);
 useEffect(()=>{if(!selected)return;const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!row.current?.contains(event.target))setSelected(false)};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside)},[selected]);
 const action=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();setPicker(false);setDeleting(null);await onChanged();}catch(e){setError(e instanceof Error?e.message:typeof e==='object'&&e&&'message' in e?String(e.message):'処理できませんでした。もう一度お試しください');}finally{setBusy(false)}};
 const reaction=(emoji:string)=>void action(()=>toggleDirectReaction(m.id,emoji));
 return <div ref={row} className={`dm-message dm-action-message ${own?'is-own':''} ${group?'dm-group-message':''}`} data-message-id={m.id} data-tools-active={selected||picker||menu||undefined}>
  <div className="dm-message-body">
   {group&&!own&&<div className="dm-group-sender"><span>{name}</span></div>}
   <div className="dm-message-content" onContextMenu={e=>{e.preventDefault();setMenu(true)}} onPointerDown={e=>{held.current=false;origin.current={x:e.clientX,y:e.clientY};if(e.pointerType!=='mouse')hold.current=setTimeout(()=>{held.current=true;setMenu(true)},500)}} onPointerUp={()=>clearTimeout(hold.current)} onPointerCancel={()=>clearTimeout(hold.current)} onPointerMove={e=>{if(Math.hypot(e.clientX-origin.current.x,e.clientY-origin.current.y)>10)clearTimeout(hold.current)}} onClick={()=>{if(window.matchMedia('(hover: none)').matches)setSelected(true)}} onClickCapture={e=>{if(held.current){e.preventDefault();e.stopPropagation();held.current=false}}}>
  {group&&!own&&<Avatar className="dm-sender-avatar"><AvatarImage src={avatar||undefined}/><AvatarFallback>{name[0]}</AvatarFallback></Avatar>}
    {reply&&<div className="dm-reply-context"><span>{reply.friend_name??group?.members.find(member=>member.id===reply.sender_id)?.displayName??'メッセージ'}</span><p>{reply.content||'画像'}</p></div>}
    {!!m.mediaUrls.length&&<div className={`dm-message-media ${group&&m.mediaUrls.length>1?'dm-media-grid':''}`}>{m.mediaUrls.map((url,j)=><button type="button" className="dm-media-image" key={url} aria-label={`添付画像${j+1}を拡大`} onClick={()=>openMediaViewer({url,media:m.mediaUrls.map(src=>({src,type:'image'}))})}><img src={url} alt={`添付画像${j+1}`} loading="lazy"/></button>)}</div>}
    {content&&<div className="dm-bubble">{content}<time dateTime={m.created_at}>{new Date(m.created_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</time></div>}
    {!content&&<time className="dm-media-time" dateTime={m.created_at}>{new Date(m.created_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</time>}
   </div>
   <div className="dm-reactions">{Object.entries(m.reactions??{}).filter(([,users])=>Object.keys(users).length).map(([emoji,users])=><button key={emoji} type="button" className={users[userId]?'is-reacted':''} aria-label={`${emoji} ${Object.keys(users).length}件のリアクション`} aria-pressed={!!users[userId]} disabled={busy||!enabled} onClick={()=>reaction(emoji)}>{emoji}<strong>{Object.keys(users).length}</strong></button>)}</div>
   <div className="dm-message-actions">
    {enabled&&<Popover open={picker} onOpenChange={setPicker}><PopoverTrigger asChild><button type="button" className="dm-icon-button" aria-label="リアクションを追加"><span className="dm-reaction-add-icon"><Heart size={20}/><Plus size={10}/></span></button></PopoverTrigger><PopoverContent className="dm-reaction-picker" side="top" align={own?'end':'start'} aria-label="絵文字を選択">{(expanded?emojis:emojis.slice(0,13)).map(emoji=><button type="button" key={emoji} aria-label={emoji} disabled={busy} onClick={()=>reaction(emoji)}>{emoji}</button>)}{!expanded&&<button type="button" aria-label="すべての絵文字" onClick={()=>setExpanded(true)}><MoreHorizontal size={22}/></button>}</PopoverContent></Popover>}
    {enabled&&<button type="button" className="dm-icon-button" aria-label="返信" onClick={onReply}><Reply size={20}/></button>}
    <DropdownMenu modal={false} open={menu} onOpenChange={setMenu}><DropdownMenuTrigger asChild><button type="button" className="dm-icon-button" aria-label="メッセージの操作"><MoreHorizontal size={19}/></button></DropdownMenuTrigger><ChatMenuContent className="dm-message-menu" align={own?'end':'start'}>{enabled&&<DropdownMenuItem onSelect={onReply}><Reply size={20}/>返信</DropdownMenuItem>}{enabled&&<DropdownMenuItem onSelect={()=>setPicker(true)}><Heart size={20}/>リアクションを追加</DropdownMenuItem>}<DropdownMenuItem onSelect={()=>void action(()=>navigator.clipboard.writeText(m.content))}><Copy size={20}/>メッセージをコピー</DropdownMenuItem><DropdownMenuItem className="dm-delete-item" onSelect={()=>setDeleting(false)}><Trash2 size={20}/>自分から削除</DropdownMenuItem>{m.sender_id===userId&&<DropdownMenuItem className="dm-delete-item" onSelect={()=>setDeleting(true)}><Trash2 size={20}/>全員から削除</DropdownMenuItem>}</ChatMenuContent></DropdownMenu>
   </div>
   {error&&<p role="alert" className="dm-error">{error}</p>}
  </div>
  <Dialog open={deleting!==null} onOpenChange={open=>{if(!open&&!busy)setDeleting(null)}}><DialogContent className="dm-dialog"><DialogTitle>{deleting?'全員から削除':'自分から削除'}</DialogTitle><DialogDescription>{deleting?'このメッセージを全員の画面から削除します。':'このメッセージを自分の画面から削除します。他のメンバーの画面には残ります。'}</DialogDescription>{error&&<p role="alert" className="dm-error">{error}</p>}<div className="dm-delete-controls"><button type="button" className="dm-secondary" disabled={busy} onClick={()=>setDeleting(null)}>キャンセル</button><button type="button" className="dm-primary" disabled={busy} onClick={()=>void action(()=>deleteDirectMessage(m.id,deleting===true))}>削除する</button></div></DialogContent></Dialog>
 </div>;
}
