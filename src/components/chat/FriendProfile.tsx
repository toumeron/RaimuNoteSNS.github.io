import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Cake, ImagePlus, MessageCircle, MoreVertical, Phone, Star, X } from "lucide-react";
import { avatarOf, saveCustomAssistant, type AssistantItem, type AvatarMap } from "@/lib/aiFriends";
import "@/components/chat/friend-profile.css";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { prepareChatBackground } from "@/lib/companionPreferences";

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
  const save = (patch: Partial<AssistantItem>) => {
    try {
      const updated = { ...item, ...patch };
      saveCustomAssistant(uid, { ...updated, gender: updated.gender ?? 'female' });
      setItem(updated); setError(''); onChanged?.();
    } catch { setError('プロフィールを保存できませんでした。画像のサイズを小さくしてお試しください。'); }
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
      save({ coverUrl: canvas.toDataURL('image/jpeg', .8) });
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
 const save=async()=>{if(draft===undefined)return;setBusy(true);setError('');try{await onSave(draft);if(mounted.current)onOpenChange(false);}catch{if(mounted.current)setError('背景を保存できませんでした。端末の空き容量などを確認してください。');}finally{if(mounted.current)setBusy(false)}};
 const shown=draft===undefined?url:preview;
 return <Dialog open={open} onOpenChange={next=>{if(!busy)onOpenChange(next)}}><DialogContent className="dm-dialog dm-background-dialog"><DialogTitle>チャットの背景</DialogTitle><DialogDescription>この会話の背景を設定します。自分のこの端末にだけ保存され、相手には表示されません。</DialogDescription><div className="dm-background-preview" style={shown?{backgroundImage:`url(${JSON.stringify(shown)})`}:undefined}>{!shown&&<span>背景なし</span>}</div><input ref={file} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={e=>{const selected=e.target.files?.[0];e.target.value='';if(selected)void choose(selected)}}/><button className="dm-secondary" type="button" disabled={busy} onClick={()=>file.current?.click()}>画像を選択</button><button className="dm-secondary" type="button" disabled={busy||(!url&&!draft)} onClick={()=>setDraft(null)}>背景を解除</button>{(error||loadError)&&<p className="dm-error" role="alert">{error||loadError}</p>}<div className="dm-delete-controls"><button className="dm-secondary" type="button" disabled={busy} onClick={()=>onOpenChange(false)}>キャンセル</button><button className="dm-primary" type="button" disabled={busy||draft===undefined} onClick={()=>void save()}>{busy?'処理中…':'保存'}</button></div></DialogContent></Dialog>;
}

export { FriendProfile };
export { ChatBackgroundDialog };
