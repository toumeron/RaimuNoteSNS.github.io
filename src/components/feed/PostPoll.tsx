import {useEffect,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {CheckCircle2,Loader2} from 'lucide-react';
import {useAuth} from '@/hooks/useAuth';
import {readPoll,votePoll} from '@/api/polls';
import {pollPercent,pollRemaining} from '@/lib/polls';
import type {PostWithAuthor} from '@/types';
import {toast} from 'sonner';
export function PostPoll({post}:{post:PostWithAuthor}) {
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
