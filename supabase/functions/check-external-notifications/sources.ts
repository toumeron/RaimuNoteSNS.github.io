export type ExternalTarget={id:string;provider:'bluesky'|'misskey';external_actor:string;created_at:string;external_cursor?:{seen?:string[]}|null};
export type ExternalEvent={id:string;created_at:string;name:string;avatar:string;content:string;images:string[]};
async function json(url:string,body?:unknown){
 const response=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error(`Provider HTTP ${response.status}`);return response.json();
}
// Only fixed public APIs; no host supplied by a user is fetched.
export async function fetchExternalEvents(target:ExternalTarget):Promise<ExternalEvent[]>{
 const events:ExternalEvent[]=[];const seen=new Set(target.external_cursor?.seen??[]);const since=Date.parse(target.created_at);
 if(target.provider==='bluesky'){
  let cursor:string|undefined;
  for(let page=0;page<10;page++){
   const params=new URLSearchParams({actor:target.external_actor,limit:'100',filter:'posts_no_replies',...(cursor?{cursor}:{})});
   const result=await json(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?${params}`);
   let hasUnseenRecent=false;
   for(const item of result.feed??[]){
    if(item.reason?.$type==='app.bsky.feed.defs#reasonRepost')continue; // Reposts are not the author's new posts.
    const post=item.post;if(!post?.uri||!post.record||post.record.reply)continue;
    const id=`bsky:${post.uri}`;const date=post.indexedAt??post.record.createdAt;
    if(!Number.isFinite(Date.parse(date)))continue;
    if(Date.parse(date)<since)continue;
    if(seen.has(id))continue;
    hasUnseenRecent=true;
    const embed=post.embed?.media??post.embed;
    events.push({id,created_at:date,name:post.author?.displayName||post.author?.handle||target.external_actor,avatar:post.author?.avatar??'',content:post.record.text??'',images:(embed?.images??[]).map((image:{thumb?:string;fullsize?:string})=>image.thumb??image.fullsize).filter(Boolean)});
   }
   cursor=result.cursor;if(!cursor||((result.feed??[]).length>0&&!hasUnseenRecent))break;
  }
 }else{
  const [username,...domain]=target.external_actor.replace(/^@/,'').split('@');const host=domain.join('@');
  const user=await json('https://misskey.io/api/users/show',{username,host:!host||host==='misskey.io'?null:host});
  let untilId:string|undefined;
  for(let page=0;page<10;page++){
   const notes=await json('https://misskey.io/api/users/notes',{userId:user.id,limit:100,withReplies:false,withRenotes:false,...(untilId?{untilId}:{})});
   let hasUnseenRecent=false;
   for(const note of notes){
    if(!note.id||note.visibility!=='public'||note.replyId||note.renoteId&&!note.text&&!note.files?.length)continue;
    const date=note.createdAt;if(!Number.isFinite(Date.parse(date)))continue;
    // App post IDs use misskey.io's federated note ID, including remote actors.
    const id=`misskey:https://misskey.io/notes/${note.id}`;
    if(Date.parse(date)<since||seen.has(id))continue;
    hasUnseenRecent=true;
    events.push({id,created_at:date,name:note.user?.name||user.name||username,avatar:note.user?.avatarUrl||user.avatarUrl||'',content:[note.cw,note.text].filter(Boolean).join('\n\n'),images:(note.files??[]).filter((file:{type:string})=>file.type?.startsWith('image/')).map((file:{thumbnailUrl?:string;url:string})=>file.thumbnailUrl||file.url)});
   }
   untilId=notes.at(-1)?.id;if(notes.length<100||!untilId||!hasUnseenRecent)break;
  }
 }
 return events.sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));
}
