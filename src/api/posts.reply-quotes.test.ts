import { beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({visible:true,writes:[] as any[]}));
vi.mock('@/lib/currentUser',()=>({getCurrentUserId:async()=> 'viewer'}));
vi.mock('./reply-reposts',()=>({isReplyPostId:(id:string)=>id.startsWith('reply:'),REPLY_REPOST_SELECT:'*',replyToPost:(row:any)=>row,
  getReplyPost:async()=>fixture.visible?{replyId:'comment-id',id:'reply:comment-id'}:null,
  getProfileReplyReposts:async()=>[],toggleReplyRepost:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabase:{from(table:string){let write=false;const b={
  select:()=>b,eq:()=>b,in:()=>b,single:()=>b,maybeSingle:()=>b,
  insert:(input:any)=>{write=true;fixture.writes.push({table,input});return b;},
  then:(resolve:any)=>Promise.resolve({data:write?null:table==='posts'?{id:'created',user_id:'viewer',content:'引用文',visibility:'public',profiles:{id:'viewer',username:'viewer'}}:[],error:null}).then(resolve),
};return b;}}}));
import { createPost } from './posts';
beforeEach(()=>{fixture.visible=true;fixture.writes=[];});
it('stores a reply quote using the reply reference, without referencing its root as the quoted post',async()=>{
  await createPost({content:'引用文',imageUrls:[],parentId:'reply:comment-id',isQuote:true});
  expect(fixture.writes).toHaveLength(1);
  expect(fixture.writes[0]).toMatchObject({table:'posts',input:{parent_id:null,quoted_reply_id:'comment-id',is_quote:true,content:'引用文'}});
});
it('does not quote a reply whose source is no longer accessible',async()=>{
  fixture.visible=false;
  await expect(createPost({content:'引用文',imageUrls:[],parentId:'reply:comment-id',isQuote:true})).rejects.toThrow('引用元の返信を閲覧できません');
  expect(fixture.writes).toEqual([]);
});
