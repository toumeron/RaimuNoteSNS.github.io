type Reply={id:string;externalReplyToId?:string};
type Page={post?:{id:string}|null;replies:Reply[];cursor?:string|null;totalReplies?:number};
/** A cursor alone does not prove that any unseen replies remain. */
export function nextTwitterReplyCursor(page:Page,pages:Page[],pageParam?:string|null,pageParams:(string|null)[]=[]):string|undefined{
 const cursor=page.cursor;if(!cursor||cursor===pageParam||pageParams.includes(cursor)||!page.replies.length)return;
 const earlier=new Set(pages.slice(0,-1).flatMap(row=>row.replies.map(reply=>reply.id)));
 if(!page.replies.some(reply=>!earlier.has(reply.id)))return;
 const total=pages.find(row=>typeof row.totalReplies==='number')?.totalReplies;
 if(total===0)return;
 const parent=pages.find(row=>row.post)?.post?.id;
 if(total!==undefined&&total>0&&parent){
  const direct=new Set(pages.flatMap(row=>row.replies.filter(reply=>!reply.externalReplyToId||reply.externalReplyToId===parent).map(reply=>reply.id)));
  if(direct.size>=total)return;
 }
 return cursor;
}
