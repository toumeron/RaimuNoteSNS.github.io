import type {PostWithAuthor} from '@/types';
/** Preserve relevance order within each service while keeping twitter visible in all-source search. */
export function searchProviderBatch(candidates:PostWithAuthor[],limit:number,mixed:boolean){
 const rows=[...new Map(candidates.map(post=>[post.id,post])).values()];
 if(!mixed)return {posts:rows.slice(0,limit),remaining:rows.slice(limit)};
 const isTwitter=(post:PostWithAuthor)=>post.source==='x'||post.id.startsWith('x:');
 const twitter=rows.filter(isTwitter),other=rows.filter(post=>!isTwitter(post));
 const count=Math.min(twitter.length,Math.max(Math.ceil(limit/2),limit-other.length));
 const a=twitter.slice(0,count),b=other.slice(0,limit-a.length),posts:PostWithAuthor[]=[];
 for(let i=0;i<Math.max(a.length,b.length);i++){if(a[i])posts.push(a[i]);if(b[i])posts.push(b[i]);}
 const selected=new Set(posts.map(post=>post.id));
 return {posts,remaining:rows.filter(post=>!selected.has(post.id))};
}
