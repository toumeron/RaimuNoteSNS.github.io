import type {PostWithAuthor} from '@/types';
import {pollPercent,pollRemaining} from '@/lib/polls';
export function ExternalPostDetails({post}:{post:PostWithAuthor}){
 const details=post.externalDetails;if(!details||!details.poll&&!details.communityNote)return null;
 const poll=details.poll,total=poll?.options.reduce((sum,option)=>sum+option.votes,0)??0;
 return <div onClick={event=>event.stopPropagation()}>
  {poll&&<section aria-label="twitterの投票" className="my-4">
   <div className="space-y-2">{poll.options.map((option,index)=>{const percent=pollPercent(option.votes,total);return <div key={index} className="relative flex min-h-11 items-center justify-between overflow-hidden rounded-md px-3 py-2"><div aria-hidden="true" className="absolute inset-y-0 left-0 rounded-md bg-foreground/15" style={{width:`${Math.max(1,percent)}%`}}/><span className="relative min-w-0 break-words">{option.label}</span><span className="relative ml-2 shrink-0 tabular-nums">{percent}%</span></div>;})}</div>
   <p className="mt-3 text-xs text-muted-foreground">{total.toLocaleString()}票 · {pollRemaining(poll.endsAt)}</p>
   {Date.parse(poll.endsAt)>Date.now()&&<a className="mt-2 inline-block text-sm text-primary hover:underline" href={post.blueskyUrl} target="_blank" rel="noopener noreferrer">twitterで投票する</a>}
  </section>}
  {details.communityNote&&<section aria-label="コミュニティノート" className="my-3 rounded-xl border border-border p-3 text-sm"><p className="mb-1 font-semibold">コミュニティノート</p><p className="whitespace-pre-wrap break-words">{details.communityNote}</p></section>}

 </div>;
}
