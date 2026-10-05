import {OfflineBookmarkContext} from './OfflineBookmarkContext';
import {createPortal} from 'react-dom';
import {useIsMobile} from '@/hooks/use-mobile';
import {Button} from '@/components/ui/button';
import {useContext,useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Sticker,X,Loader2} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover';
import {stickerUrl,type CustomSticker} from '@/lib/stickers';
function useStickers(enabled=true) {
  return useQuery({queryKey:['custom-stickers'],enabled,staleTime:60000,queryFn:async()=>{
    const {data,error}=await supabase.from('custom_emojis').select('id,name,public_id,format').order('name');
    if(error)throw error; return (data||[]) as CustomSticker[];
  }});
}
export function StickerImage({name,inline=false}:{name:string;inline?:boolean}) {
  const offline=useContext(OfflineBookmarkContext);const {data}=useStickers(!offline);const sticker=(offline?.emojis??data)?.find(s=>s.name===name);const src=sticker&&stickerUrl(sticker);
  return src?<img data-lime-sticker src={offline?.media.get(src)??src} alt={`${name}のスタンプ`} loading="lazy" data-lime-sticker-inline={inline} className={`inline-block max-w-full object-contain align-middle ${inline?'h-6 w-6':'my-1 h-36 w-36'}`}/>:<span className="text-sm text-muted-foreground">{name}のスタンプ</span>;
}
export function StickerPicker({onSelect,disabled=false,iconOnly=false,className=''}:{onSelect:(name:string)=>void;disabled?:boolean;iconOnly?:boolean;className?:string}) {
  const [open,setOpen]=useState(false),[search,setSearch]=useState('');
  const mobile=useIsMobile();
  const {data,isPending,isError,refetch}=useStickers(open);
  const items=(data||[]).filter(s=>s.name.toLowerCase().includes(search.toLowerCase())&&stickerUrl(s));
  useEffect(()=>{
    if(!open||!mobile)return;
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopImmediatePropagation();setOpen(false);}};
    document.addEventListener('keydown',onKey,true);
    return ()=>document.removeEventListener('keydown',onKey,true);
  },[open,mobile]);
  const trigger=<Button type="button" disabled={disabled} variant="ghost" size="sm" data-lime-attachment-tool aria-label="スタンプを選ぶ"
    onPointerDown={event=>event.preventDefault()}
    onClick={mobile?()=>setOpen(true):undefined}
    className={`h-9 [&_svg]:size-5 shrink-0 rounded-full text-primary hover:bg-primary/10 hover:text-primary ${iconOnly?'w-9 p-0':''} ${className}`}>
    <Sticker className={iconOnly?'h-5 w-5':'h-5 w-5 sm:mr-1.5'}/>{!iconOnly&&<span className="hidden sm:inline">スタンプ</span>}
  </Button>;
  const contents=<>
    <input aria-label="スタンプを検索" placeholder="スタンプを検索" value={search} onChange={e=>setSearch(e.target.value)} className="mb-2 w-full rounded-full border border-border bg-background px-3 py-2 text-sm"/>
    {isPending?<Loader2 className="mx-auto my-6 h-5 w-5 animate-spin"/>:isError?<button type="button" onClick={()=>refetch()} className="text-sm text-primary">読み込みを再試行</button>:items.length?<div className={`grid gap-2 overflow-y-auto ${mobile?'max-h-[45dvh] grid-cols-4':'max-h-72 grid-cols-4'}`}>
      {items.map(s=><button key={s.id} type="button" aria-label={`${s.name}を選ぶ`} onClick={()=>{onSelect(s.name);setOpen(false);}} className="rounded-xl p-2 hover:bg-muted"><img src={stickerUrl(s)!} alt={s.name} loading="lazy" className="h-14 w-full object-contain"/><span className="block truncate text-xs text-muted-foreground">{s.name}</span></button>)}
    </div>:<p className="py-6 text-center text-sm text-muted-foreground">スタンプがありません</p>}
  </>;
  if(mobile)return <>{trigger}{open&&createPortal(<div className="fixed inset-0 z-[2147483100] flex items-end bg-black/40" onClick={event=>event.stopPropagation()} onPointerDown={event=>{if(event.target===event.currentTarget)setOpen(false);}}>
    <section role="dialog" aria-modal="true" aria-label="スタンプを選択" data-lime-sticker-picker="mobile" className="w-full rounded-t-3xl border-t border-border bg-background p-4 pb-[max(16px,env(safe-area-inset-bottom))] shadow-xl" onFocusCapture={event=>event.stopPropagation()}>
      <div className="mb-3 flex items-center justify-between"><span className="font-bold">スタンプ</span><button type="button" aria-label="スタンプ選択を閉じる" className="rounded-full p-2 hover:bg-muted" onClick={()=>setOpen(false)}><X className="h-5 w-5"/></button></div>{contents}
    </section>
  </div>,document.body)}</>;
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild>{trigger}</PopoverTrigger><PopoverContent data-lime-sticker-picker="desktop" side="top" align="end" className="z-[2147483100] w-96 max-w-[calc(100vw-24px)] p-3" onOpenAutoFocus={e=>e.preventDefault()} onEscapeKeyDown={event=>event.stopPropagation()}>{contents}</PopoverContent></Popover>;
}
export function StickerDraft({name,onRemove,inline=false}:{name:string|null;onRemove:()=>void;inline?:boolean}) {
  return name?<div data-lime-sticker-draft className={inline?'mt-2 flex w-fit items-center gap-1':'relative mt-2 w-fit'}><StickerImage name={name} inline={inline}/><button type="button" aria-label="スタンプを外す" onClick={onRemove} className={`${inline?'':'absolute right-0 top-0'} rounded-full bg-background p-1 text-muted-foreground shadow`}><X className="h-4 w-4"/></button></div>:null;
}
