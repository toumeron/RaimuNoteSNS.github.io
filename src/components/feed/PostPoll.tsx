import { useEffect, useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, ImagePlus, Plus, X, CalendarClock, CalendarDays, Clock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { readPoll, votePoll } from "@/api/polls";
import { pollPercent, pollRemaining, type PollDraft } from "@/lib/polls";
import { type PostWithAuthor } from "@/types/index";
import { toast } from "sonner";
import "@/components/post/post-actions.css";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { allowAccountWrite } from "@/lib/accountSuspension";
import { validSchedule, scheduleLabel } from "@/components/feed/ComposerIcon";

// PostPoll
function PostPoll({post}:{post:PostWithAuthor}) {
 const {user}=useAuth(),client=useQueryClient(),[now,setNow]=useState(Date.now());
 const queryKey=['poll',post.id,user?.id??null];
 const query=useQuery({queryKey,queryFn:()=>readPoll(post.id,user?.id??null),staleTime:15000,refetchOnWindowFocus:false});
 useEffect(()=>{if(post.poll)client.setQueryData<Awaited<ReturnType<typeof readPoll>>>(queryKey,current=>current?{...current,poll:post.poll!}:current);},[post.poll,post.id,user?.id]);
 const poll=query.data?.poll??post.poll!,selected=query.data?.selected??null,urls=query.data?.urls??{};
 const closed=Date.parse(poll.endsAt)<=now,total=poll.options.reduce((sum,option)=>sum+option.votes,0);
 const results=closed||selected!==null||user?.id===post.userId;
 useEffect(()=>{let timer:ReturnType<typeof setTimeout>;const tick=()=>{setNow(Date.now());const left=Date.parse(poll.endsAt)-Date.now();if(left<=0)return;timer=setTimeout(()=>{if(Date.now()>=Date.parse(poll.endsAt)){setNow(Date.now());void query.refetch();}else tick();},Math.min(left+100,60000));};tick();return()=>clearTimeout(timer);},[poll.endsAt,post.id]);
 const vote=useMutation({mutationFn:async(index:number)=>{if(!user)throw new Error('ログインして投票してください');if(closed)throw new Error('投票は終了しています');if(!query.data)throw new Error('投票を読み込み中です');const viewer=await votePoll(post.id,index);return readPoll(post.id,viewer);},onSuccess:data=>{client.setQueryData(queryKey,data);void client.invalidateQueries({queryKey:['posts']});},onError:error=>{toast.error(error instanceof Error?error.message:'投票できませんでした');void query.refetch();}});
 const image=(ref?:string)=>ref?urls[ref]:undefined;
 const grid=!results&&poll.options.every(option=>!!option.image);
 return <section aria-label="投票" className="my-4" onClick={event=>event.stopPropagation()}>
  {query.isError&&<button type="button" className="mb-2 text-sm text-primary" onClick={()=>void query.refetch()}>投票を再読み込み</button>}
  <div className={grid?'grid grid-cols-2 gap-3':'space-y-2'}>{poll.options.map((option,index)=>{
   const percent=pollPercent(option.votes,total),src=image(option.image);
   return results?<div key={index} className="flex items-center gap-2">
    {option.image&&<div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted sm:h-16 sm:w-16">{src&&<img src={src} alt={option.label} className="h-full w-full object-cover"/>}</div>}
    <div className="relative flex min-h-11 min-w-0 flex-1 items-center justify-between overflow-hidden rounded-md px-3 py-2"><div aria-hidden="true" className="absolute inset-y-0 left-0 rounded-md bg-foreground/15 transition-[width] duration-300" style={{width:`${Math.max(1,percent)}%`}}/><span className="relative flex min-w-0 items-center gap-1 break-words">{option.label}{selected===index&&<CheckCircle2 className="h-4 w-4 shrink-0" aria-label="投票した回答"/>}</span><span className="relative ml-2 shrink-0 tabular-nums">{percent}%</span></div>
   </div>:<button key={index} type="button" aria-label={`${option.label}に投票`} disabled={vote.isPending||!query.data||query.isError} onClick={()=>vote.mutate(index)} className={grid?'min-w-0 disabled:opacity-50':'flex min-h-11 w-full items-center gap-3 rounded-full border border-primary px-4 py-2 text-primary hover:bg-primary/10 disabled:opacity-50'}>
    {option.image&&<div className={grid?'aspect-square overflow-hidden rounded-xl border border-border bg-muted':'h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted'}>{src&&<img src={src} alt={option.label} className="h-full w-full object-cover"/>}</div>}
    <span className={grid?'mt-2 block rounded-full border border-primary px-3 py-2 font-bold text-primary hover:bg-primary/10':'min-w-0 flex-1 break-words font-semibold'}>{option.label}</span>
   </button>;
  })}</div>
  <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">{vote.isPending&&<Loader2 className="h-3 w-3 animate-spin"/>}{total}票 · {pollRemaining(poll.endsAt,now)}</p>
 </section>;
}

// PollEditor
const newPollDraft=():PollDraft=>({options:[{label:''},{label:''}],durationMinutes:1440});
function PollEditor({value,onChange,onRemove,disabled=false}:{value:PollDraft;onChange:(value:PollDraft)=>void;onRemove:()=>void;disabled?:boolean}) {
 const update=(index:number,patch:Partial<PollDraft['options'][number]>)=>onChange({...value,options:value.options.map((option,i)=>i===index?{...option,...patch}:option)});
 const duration=value.durationMinutes,days=Math.floor(duration/1440),hours=Math.floor(duration%1440/60),minutes=duration%60;
 return <section aria-label="投票を作成" className="mt-4 overflow-hidden rounded-2xl border border-border">
  <div className="space-y-3 p-3 sm:p-4">{value.options.map((option,index)=><div key={index} className="flex items-center gap-2 sm:gap-3">
   <div className="relative h-16 w-16 shrink-0 sm:h-20 sm:w-20">
    <label className={`flex h-full w-full cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-muted ${disabled?'pointer-events-none opacity-50':''}`}>
     {option.image?<img src={option.image} alt={`回答${index+1}の画像`} className="h-full w-full object-cover"/>:<ImagePlus className="h-5 w-5 text-muted-foreground"/>}
     <input aria-label={`回答${index+1}の画像を選択`} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" className="sr-only" disabled={disabled} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;if(!['image/png','image/jpeg','image/webp','image/gif','image/avif'].includes(file.type)){toast.error('対応する画像形式を選択してください');return;}if(file.size>8*1024*1024){toast.error('画像は8MB以内にしてください');return;}if(option.image)URL.revokeObjectURL(option.image);update(index,{image:URL.createObjectURL(file)});}}/>
    </label>
    {option.image&&<button type="button" disabled={disabled} aria-label={`回答${index+1}の画像を削除`} onClick={()=>{URL.revokeObjectURL(option.image!);update(index,{image:undefined});}} className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white"><X className="h-6 w-6"/></button>}
   </div>
   <label className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary"><span className="flex justify-between text-xs text-muted-foreground">回答{index+1}<span>{Array.from(option.label).length} / 25</span></span><input aria-label={`回答${index+1}`} value={option.label} disabled={disabled} className="mt-1 w-full bg-transparent text-base outline-none" onChange={event=>update(index,{label:Array.from(event.target.value).slice(0,25).join('')})}/></label>
   <div className="w-8 shrink-0">{index===value.options.length-1&&value.options.length<4?<button type="button" disabled={disabled} aria-label="回答を追加" onClick={()=>onChange({...value,options:[...value.options,{label:''}]})} className="flex h-8 w-8 items-center justify-center text-primary"><Plus className="h-6 w-6"/></button>:value.options.length>2?<button type="button" disabled={disabled} aria-label={`回答${index+1}を削除`} onClick={()=>{if(option.image)URL.revokeObjectURL(option.image);onChange({...value,options:value.options.filter((_,i)=>i!==index)});}} className="flex h-8 w-8 items-center justify-center text-muted-foreground"><X className="h-6 w-6"/></button>:null}</div>
  </div>)}</div>
  <div className="border-t border-border p-3 sm:p-4"><h3 className="mb-2 font-semibold">投票期間</h3><div className="grid grid-cols-3 gap-3">{([{label:'日',current:days,max:7,multiplier:1440},{label:'時間',current:hours,max:23,multiplier:60},{label:'分',current:minutes,max:59,multiplier:1}]).map(field=><label key={field.label} className="rounded-lg border border-border px-3 py-2"><span className="text-xs text-muted-foreground">{field.label}</span><select aria-label={`投票期間・${field.label}`} value={field.current} disabled={disabled||(days===7&&field.multiplier<1440)} onChange={event=>onChange({...value,durationMinutes:field.multiplier===1440&&Number(event.target.value)===7?10080:duration-field.current*field.multiplier+Number(event.target.value)*field.multiplier})} className="block w-full bg-transparent text-base">{Array.from({length:field.max+1},(_,i)=><option key={i} value={i}>{i}</option>)}</select></label>)}</div></div>
  <button type="button" disabled={disabled} onClick={onRemove} className="w-full border-t border-border py-3 text-sm text-destructive">投票を削除する</button>
 </section>;
}

// ScheduleControl
function parts(value:string) {const date=new Date(Date.parse(value)+9*3600_000);return {year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate(),hour:date.getUTCHours(),minute:date.getUTCMinutes()};}
function ScheduleControl({value,onChange,disabled}:{value:string|null;onChange:(value:string|null)=>void;disabled?:boolean}) {
 const [open,setOpen]=useState(false);
 const [date,setDate]=useState(()=>parts(new Date(Date.now()+3600_000).toISOString()));const picker=useRef<HTMLInputElement>(null);
 const at=new Date(Date.UTC(date.year,date.month-1,date.day,date.hour-9,date.minute)).toISOString();
 const days=new Date(Date.UTC(date.year,date.month,0)).getUTCDate(),firstYear=new Date(Date.now()+9*3600_000).getUTCFullYear();
 const confirm=()=>{if(!allowAccountWrite()||!validSchedule(at))return;onChange(at);setOpen(false);};
 const select=(name:keyof typeof date,label:string,values:number[])=> <label className="min-w-0 rounded-lg bg-foreground/[0.06] dark:bg-foreground/[0.10] px-3 py-2"><span className="block text-xs text-muted-foreground">{label}</span><select aria-label={label} value={date[name]} className="mt-1 w-full bg-transparent text-lg outline-none" onChange={event=>setDate(current=>{const next={...current,[name]:Number(event.target.value)};next.day=Math.min(next.day,new Date(Date.UTC(next.year,next.month,0)).getUTCDate());return next;})}>{values.map(item=><option key={item} value={item}>{item}{name==='month'?'月':''}</option>)}</select></label>;
 return <><button type="button" data-lime-composer-tool aria-label="予約設定" title="予約設定" aria-pressed={!!value} disabled={disabled} className={`flex h-9 w-9 items-center justify-center rounded-full bg-transparent hover:bg-transparent focus:bg-transparent active:bg-transparent disabled:opacity-50 ${value?'text-primary':'text-muted-foreground'}`} onClick={()=>{if(!allowAccountWrite())return;setDate(parts(value??new Date(Date.now()+3600_000).toISOString()));setOpen(true);}}><CalendarClock className="h-5 w-5"/></button>

 <Dialog open={open} onOpenChange={setOpen}><DialogContent className="scheduled-post-dialog flex max-h-[90dvh] max-w-2xl flex-col gap-0 overflow-y-auto rounded-3xl border-0 bg-background p-0 [&>.neutral-dismiss]:hidden max-sm:left-0 max-sm:top-0 max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none" overlayClassName="z-[2147483600]" style={{zIndex:2147483601}}><div className="flex items-center gap-4 px-5 py-4"><button type="button" aria-label="予約設定を閉じる" onClick={()=>setOpen(false)}><X className="h-5 w-5"/></button><DialogTitle className="flex-1 text-xl font-bold">予約設定</DialogTitle>{<button type="button" disabled={!validSchedule(at)} onClick={()=>void confirm()} className="rounded-full bg-primary px-5 py-2 font-bold text-primary-foreground disabled:opacity-50">確認する</button>}</div><DialogDescription className="sr-only">ポストの送信日時を設定</DialogDescription>
 <div className="flex-1 space-y-6 px-5 pb-8"><p className="flex gap-3 text-sm text-muted-foreground"><CalendarClock className="h-5 w-5 shrink-0"/>{scheduleLabel(at)}に送信されます</p><fieldset><legend className="mb-2 text-muted-foreground">日付</legend><div className="grid grid-cols-[1.2fr_1fr_1fr_auto] items-center gap-2">{select('month','月',Array.from({length:12},(_,i)=>i+1))}{select('day','日',Array.from({length:days},(_,i)=>i+1))}{select('year','年',[firstYear,firstYear+1])}<button type="button" aria-label="カレンダーで日付を選択" onClick={()=>{try{picker.current?.showPicker();}catch{picker.current?.focus();}}}><CalendarDays className="h-5 w-5"/></button><input ref={picker} type="date" className="sr-only" tabIndex={-1} value={`${date.year}-${String(date.month).padStart(2,'0')}-${String(date.day).padStart(2,'0')}`} onChange={event=>{const [year,month,day]=event.target.value.split('-').map(Number);if(year&&month&&day)setDate(current=>({...current,year,month,day}));}}/></div></fieldset><fieldset><legend className="mb-2 text-muted-foreground">時刻</legend><div className="grid grid-cols-[1fr_1fr_auto] items-center gap-3">{select('hour','時',Array.from({length:24},(_,i)=>i))}{select('minute','分',Array.from({length:60},(_,i)=>i))}<Clock className="h-5 w-5"/></div></fieldset><p className="text-sm text-muted-foreground">タイムゾーン<span className="mt-1 block text-base text-foreground">日本標準時</span></p>{!validSchedule(at)&&<p role="alert" className="text-sm text-destructive">1分後から1年以内の日時を選択してください。</p>}{value&&<button type="button" className="text-destructive" onClick={()=>{onChange(null);setOpen(false);}}>予約を解除する</button>}</div>
 </DialogContent></Dialog></>;
}

function ScheduledPostNotice({value}:{value:string}) {return <p data-scheduled-post-notice className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarClock className="h-3.5 w-3.5 shrink-0"/>{scheduleLabel(value)}に送信予定</p>;}

export { PostPoll };
export { PollEditor };
export { newPollDraft };
export { ScheduleControl };
export { ScheduledPostNotice };
