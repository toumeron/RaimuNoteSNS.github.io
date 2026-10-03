import { beforeEach, expect, it, vi } from 'vitest';
const db=vi.hoisted(()=>({existing:false,error:false,writes:[] as any[],profile:false}));
vi.mock('@/lib/currentUser',()=>({getCurrentUserId:async()=> 'viewer'}));
const reply={id:'comment',post_id:'root',user_id:'author',content:'Reply body',image_urls:['image.png'],created_at:'2026-10-03T00:00:00Z',profiles:{id:'author',username:'author',display_name:'Author'},post:{profiles:{username:'root-author'}},replying_to:{profiles:{username:'parent-author'}}};
vi.mock('@/lib/supabase',()=>({supabase:{from(table:string){
  let action='select',counting=false,payload:any,selection='';
  const b={select:(s:string,o?:any)=>{selection=s;counting=!!o?.count;return b;},eq:()=>b,maybeSingle:()=>b,single:()=>b,order:()=>b,range:()=>b,
    insert:(p:any)=>{action='insert';payload=p;return b;},delete:()=>{action='delete';return b;},then:(resolve:any)=>{
      if(action!=='select') db.writes.push({table,action,payload});
      const data=selection.includes('comments!inner')?[{created_at:'2026-10-03T01:00:00Z',comments:reply}]:table==='comments'?reply:db.existing?{comment_id:'comment'}:null;
      return Promise.resolve({data:counting?null:data,count:counting?(table==='reply_reposts'?2:1):null,error:db.error?new Error('denied'):null}).then(resolve);
    }};return b;
}}}));
import { replyToPost,getProfileReplyReposts,getReplyPost,toggleReplyRepost } from './reply-reposts';
beforeEach(()=>{db.existing=false;db.error=false;db.writes=[];});
it('maps reply author, actual parent recipient and media without copying the root content',()=>{
  expect(replyToPost(reply)).toMatchObject({id:'reply:comment',replyId:'comment',replyPostId:'root',replyToUsername:'parent-author',content:'Reply body',imageUrls:['image.png'],author:{displayName:'Author'}});
});
it('persists and undoes a reply share without inserting a timeline post or sharing the root',async()=>{
  expect(await toggleReplyRepost('reply:comment')).toEqual({reposted:true,repostsCount:3});
  expect(db.writes).toEqual([{table:'reply_reposts',action:'insert',payload:{comment_id:'comment',user_id:'viewer'}}]);
  db.existing=true;
  expect((await toggleReplyRepost('reply:comment')).reposted).toBe(false);
  expect(db.writes[1]).toMatchObject({table:'reply_reposts',action:'delete'});
});
it('loads a reply profile entry with recipient and original image',async()=>{
  expect((await getProfileReplyReposts('viewer',10))[0]).toMatchObject({id:'reply:comment',profileRepostedBy:'viewer',replyToUsername:'parent-author',imageUrls:['image.png']});
});
it('loads quote sources with direct reply share counts',async()=>{
  expect(await getReplyPost('reply:comment')).toMatchObject({id:'reply:comment',repostsCount:3,replyToUsername:'parent-author'});
});
it('does not write when lookup fails and does not return inaccessible replies',async()=>{
  db.error=true;
  await expect(toggleReplyRepost('reply:comment')).rejects.toThrow('denied');
  expect(db.writes).toEqual([]);
  expect(await getReplyPost('reply:comment')).toBeNull();
});
