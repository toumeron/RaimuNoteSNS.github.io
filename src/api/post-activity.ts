import {fetchBlueskyPostActivity} from '@/lib/bluesky';
import {fetchTwitterPostActivity} from '@/lib/fxTwitter';
import {normalizeTimelineBlueskyPost} from '@/lib/timelinePaging';
import {getPostQuotes,getPostReposters} from './posts';
import type {User,PostWithAuthor} from '@/types';
export type ActivityTab='quotes'|'reposts'|'likes';
export const hasExternalActivity=(id:string)=>id.startsWith('bsky:')||/^x:\d+$/.test(id);
export type ActivityCursor={remote:string|null;remoteDone:boolean;localPage:number;localDone:boolean;remoteSeen?:string[];seen?:string[]};
export async function getExternalPostActivity(id:string,tab:ActivityTab,sort:'top'|'latest',previous?:ActivityCursor,signal?:AbortSignal){
 if(id.startsWith('x:')&&tab==='likes')throw new Error('twitterのいいね一覧には対応していません');
 const cursor={...(previous??{remote:null,remoteDone:false,localPage:0,localDone:tab==='likes'})};
 cursor.remoteSeen=[...(previous?.remoteSeen??[])];cursor.seen=[...(previous?.seen??[])];
 const seen=new Set(cursor.seen);
 const reads:Promise<{users:User[];posts:PostWithAuthor[]}>[]=[];
 if(!cursor.remoteDone)reads.push((async()=>{
  const page=id.startsWith('x:')?await fetchTwitterPostActivity(id,tab as 'quotes'|'reposts',cursor.remote,signal):await fetchBlueskyPostActivity(id,tab,cursor.remote,signal);
  const rows=tab==='quotes'?page.posts:page.users;
  cursor.remoteDone=!rows.some(row=>!seen.has(row.id))||!page.cursor||page.cursor===cursor.remote||cursor.remoteSeen!.includes(page.cursor);
  if(page.cursor)cursor.remoteSeen!.push(page.cursor);cursor.remote=page.cursor;
  return {users:page.users as User[],posts:page.posts.map(normalizeTimelineBlueskyPost)};
 })());
 if(!cursor.localDone)reads.push((async()=>{
  const posts=tab==='quotes'?await getPostQuotes(id,null,sort,cursor.localPage):[];
  const users=tab==='reposts'?await getPostReposters(id,null,cursor.localPage):[];
  cursor.localDone=!(tab==='quotes'?posts:users).some(row=>!seen.has(row.id))||(tab==='quotes'?posts.length<20:users.length<50);cursor.localPage++;
  return {posts,users};
 })());
 const results=await Promise.allSettled(reads);if(signal?.aborted)throw signal.reason;
 const valid=results.flatMap(result=>result.status==='fulfilled'?[result.value]:[]),failure=results.find(result=>result.status==='rejected');
 if(failure&&!valid.some(page=>page.users.length||page.posts.length))throw failure.reason;
 const users=[...new Map(valid.flatMap(page=>page.users).map(user=>[user.id,user])).values()].filter(user=>!seen.has(user.id));
 const posts=[...new Map(valid.flatMap(page=>page.posts).map(post=>[post.id,post])).values()].filter(post=>!seen.has(post.id)).sort((a,b)=>(sort==='top'?b.likesCount-a.likesCount:0)||b.createdAt.localeCompare(a.createdAt));
 cursor.seen.push(...users.map(user=>user.id),...posts.map(post=>post.id));
 return {users,posts,next:cursor.localDone&&cursor.remoteDone?undefined:cursor};
}
