import {ImagePlus,Plus,X} from 'lucide-react';
import {type PollDraft} from '@/lib/polls';
import {toast} from 'sonner';
export const newPollDraft=():PollDraft=>({options:[{label:''},{label:''}],durationMinutes:1440});
export function PollEditor({value,onChange,onRemove,disabled=false}:{value:PollDraft;onChange:(value:PollDraft)=>void;onRemove:()=>void;disabled?:boolean}) {
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
