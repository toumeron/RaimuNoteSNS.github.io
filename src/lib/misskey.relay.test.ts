import {beforeEach,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({session:{} as object|null,invoke:vi.fn()}));
vi.mock('./supabase',()=>({supabase:{auth:{getSession:async()=>({data:{session:fixture.session}})},functions:{invoke:fixture.invoke}}}));
import {misskeyRequest,misskeyProfile,fetchMisskeyTopicPosts} from './misskey';
beforeEach(()=>{fixture.session={};fixture.invoke.mockReset();vi.unstubAllGlobals();});
it('includes replies in an author profile scan',async()=>{
 const {misskeyFeed}=await import('./misskey');
 fixture.invoke.mockImplementation(async(_name:string,{body}:any)=>({data:{data:body.endpoint==='users/show'?{id:'creator',username:'creator'}:[]},error:null}));
 await misskeyFeed({actor:'misskey-user:creator',filter:'posts_with_replies',includeReposts:true,limit:100});
 expect(fixture.invoke).toHaveBeenCalledWith('link-preview',expect.objectContaining({body:{mode:'misskey',endpoint:'users/notes',params:{limit:100,userId:'creator',withReplies:true}}}));
});
it('uses the existing authenticated relay without a cross-origin browser request',async()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 fixture.invoke.mockResolvedValue({data:{data:[{id:'local',username:'cat'}]},error:null});
 expect(await misskeyRequest('users/search',{query:'cat',i:'do-not-forward'})).toEqual([{id:'local',username:'cat'}]);
 expect(fetcher).not.toHaveBeenCalled();
 expect(fixture.invoke).toHaveBeenCalledWith('link-preview',expect.objectContaining({body:{mode:'misskey',endpoint:'users/search',params:{query:'cat'}}}));
});
it('treats an absent exact user as a search miss rather than invalid profile data',async()=>{
 fixture.invoke.mockResolvedValue({data:{data:null},error:null});
 await expect(misskeyProfile('missing-relay-test@misskey.io')).rejects.toThrow('見つかりません');
});
it('keeps signed-out public reads available',async()=>{
 fixture.session=null;const fetcher=vi.fn().mockResolvedValue(new Response('[]'));vi.stubGlobal('fetch',fetcher);
 expect(await misskeyRequest('notes/local-timeline')).toEqual([]);
 expect(fetcher).toHaveBeenCalledWith('https://misskey.io/api/notes/local-timeline',expect.anything());
 expect(fixture.invoke).not.toHaveBeenCalled();
});
it('pages topic notes through the authenticated relay without fetching accounts',async()=>{
 const notes=Array.from({length:20},(_,index)=>({id:`note-${index}`,text:'猫の写真',createdAt:'2026-10-08T00:00:00Z',visibility:'public',user:{id:'cat',username:'cat'}}));
 fixture.invoke.mockResolvedValue({data:{data:notes},error:null});
 const first=await fetchMisskeyTopicPosts({query:'猫',limit:20});
 expect(first.posts).toHaveLength(20);expect(first.cursor).toBe('note-19');
 fixture.invoke.mockResolvedValue({data:{data:[]},error:null});
 const second=await fetchMisskeyTopicPosts({query:'猫',cursor:first.cursor,limit:20});
 expect(second.cursor).toBeNull();expect(fixture.invoke).toHaveBeenCalledTimes(2);
 expect(fixture.invoke).toHaveBeenLastCalledWith('link-preview',expect.objectContaining({body:{mode:'misskey',endpoint:'notes/search',params:{query:'猫',limit:20,untilId:'note-19'}}}));
});
it('requests creator images through the existing relay without a text query',async()=>{
 const {misskeyFeed}=await import('./misskey');fixture.invoke.mockImplementation(async(_name:string,{body}:any)=>({data:{data:body.endpoint==='users/show'?{id:'media-creator',username:'media'}:[{id:'media-only',createdAt:new Date().toISOString(),text:null,visibility:'public',user:{id:'media-creator',username:'media'},files:[{type:'image/png',url:'https://images.example/work.png',comment:null}]}]},error:null}));
 const page=await misskeyFeed({actor:'misskey-user:media-creator',filter:'posts_with_media'});
 expect(page.posts[0].content).toBe('');expect(page.posts[0].imageUrls).toHaveLength(1);
 expect(fixture.invoke).toHaveBeenCalledWith('link-preview',expect.objectContaining({body:{mode:'misskey',endpoint:'users/notes',params:{limit:30,userId:'media-creator',withFiles:true}}}));
});
it('loads direct replies and keeps image-only replies while omitting private ones', async () => {
 const {misskeyThread}=await import('./misskey');
 const note={id:'root123',text:'親の投稿',createdAt:'2026-10-11',visibility:'public',user:{id:'owner',username:'owner'}};
 fixture.invoke.mockImplementation(async(_name:string,{body}:any)=>({data:{data:body.endpoint==='notes/show'?note:[{...note,id:'reply123',text:null,files:[{type:'image/png',url:'https://images.example/reply.png'}]},{...note,id:'private123',visibility:'followers'}]},error:null}));
 const thread=await misskeyThread('misskey:https://misskey.io/notes/root123');
 expect(thread.replies).toHaveLength(1);expect(thread.replies[0].imageUrls).toHaveLength(1);
 expect(fixture.invoke).toHaveBeenCalledWith('link-preview',expect.objectContaining({body:{mode:'misskey',endpoint:'notes/replies',params:{noteId:'root123',limit:100}}}));
});
it('does not hide a reply fetch failure as an empty thread',async()=>{
 const {misskeyThread}=await import('./misskey');
 fixture.invoke.mockImplementation(async(_name:string,{body}:any)=>body.endpoint==='notes/show'?{data:{data:{id:'root123',visibility:'public',text:'親',user:{id:'owner',username:'owner'}}},error:null}:{data:null,error:new Error('read failed')});
 await expect(misskeyThread('misskey:https://misskey.io/notes/root123')).rejects.toThrow('取得に失敗');
});
