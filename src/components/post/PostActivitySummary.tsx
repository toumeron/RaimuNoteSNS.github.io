import {useQuery} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import {getPostQuoteCount} from '@/api/posts';
import {useAuth} from '@/hooks/useAuth';
import type {PostWithAuthor} from '@/types';

export function PostActivitySummary({post,mobile}:{post:PostWithAuthor;mobile:boolean}){
 const {user}=useAuth();
 const enabled=mobile&&(!post.source||post.source==='lime')&&!/^(bsky:|misskey:|x:|reply:)/.test(post.id);
 const quotes=useQuery({queryKey:['post',post.id,'quote-count',user?.id??null],queryFn:({signal})=>getPostQuoteCount(post.id,signal),enabled,staleTime:15_000,retry:false,throwOnError:false});
 if(!enabled)return null;
 const entries=[{tab:'reposts',label:'件のリポスト',count:post.repostsCount},{tab:'quotes',label:'件の引用リポスト',count:quotes.data},{tab:'likes',label:'件のいいね',count:post.likesCount}].filter(entry=>Number.isFinite(entry.count)&&(entry.count??0)>0);
 if(!entries.length)return null;
 return <nav aria-label="ポストアクティビティ" className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-y border-border/60 py-3 text-sm">
  {entries.map(entry=><Link key={entry.tab} to={`/post/${encodeURIComponent(post.id)}/activity?tab=${entry.tab}`} className="inline-flex items-baseline gap-1 hover:underline"><strong className="font-bold tabular-nums text-foreground">{entry.count!.toLocaleString('ja-JP')}</strong><span className="text-muted-foreground">{entry.label}</span></Link>)}
 </nav>;
}
