import {beforeEach,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({session:{} as object|null,invoke:vi.fn()}));
vi.mock('./supabase',()=>({supabase:{auth:{getSession:async()=>({data:{session:fixture.session}})},functions:{invoke:fixture.invoke}}}));
import {misskeyRequest,misskeyProfile,fetchMisskeyTopicPosts} from './misskey';
beforeEach(()=>{fixture.session={};fixture.invoke.mockReset();vi.unstubAllGlobals();vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('CORS unavailable')));});
it('includes replies in an author profile scan',async()=>{
 const {misskeyFeed}=await import('./misskey');
 fixture.invoke.mockImplementation(async(_name:string,{body}:any)=>({data:{data:body.endpoint==='users/show'?{id:'creator',username:'creator'}:[]},error:null}));
 await misskeyFeed({actor:'misskey-user:creator',filter:'posts_with_replies',includeReposts:true,limit:100});
 expect(fixture.invoke).toHaveBeenCalledWith('link-preview',expect.objectContaining({body:{mode:'misskey',endpoint:'users/notes',params:{limit:100,userId:'creator',withReplies:true}}}));
});
it('falls back to the authenticated relay when the public browser read fails',async()=>{
 const fetcher=vi.fn().mockRejectedValue(new TypeError('CORS'));vi.stubGlobal('fetch',fetcher);
 fixture.invoke.mockResolvedValue({data:{data:[{id:'local',username:'cat'}]},error:null});
 expect(await misskeyRequest('users/search',{query:'cat',i:'do-not-forward'})).toEqual([{id:'local',username:'cat'}]);
 expect(fetcher).toHaveBeenCalledTimes(1);
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

it('keeps Misskey renote totals in posts and quotes',async()=>{
 const {mapMisskeyNote}=await import('./misskey');
 const quoted={id:'quoted-count',createdAt:'2026-10-17T00:00:00Z',text:'元の投稿',visibility:'public',user:{id:'artist',username:'artist'},renoteCount:24};
 const post=mapMisskeyNote({...quoted,id:'quote-count',text:'引用',renoteCount:12,renote:quoted})!;
 expect(post.repostsCount).toBe(12);expect(post.externalDetails?.reposts).toBe(12);expect(post.parentPost?.repostsCount).toBe(24);
});

it('uses the public read API even when the shared relay would be rate limited',async()=>{
 fixture.session={user:{id:'limited-misskey'}};
 fixture.invoke.mockResolvedValue({data:null,error:{context:new Response(null,{status:429,headers:{'retry-after':'300'}})}});
 const fetcher=vi.fn().mockImplementation(async()=>new Response(JSON.stringify([{id:'available',username:'cat'}])));vi.stubGlobal('fetch',fetcher);
 expect(await misskeyRequest('users/search',{query:'cat'})).toEqual([{id:'available',username:'cat'}]);
 expect(await misskeyRequest('users/search',{query:'dog'})).toEqual([{id:'available',username:'cat'}]);
 expect(fixture.invoke).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(2);
 expect(fetcher.mock.calls[0][0]).toBe('https://misskey.io/api/users/search');
});

it('publishes an exact Misskey profile before the broad account search finishes',async()=>{
 const {searchMisskey}=await import('./misskey');
 let finishSearch!:(value:Response)=>void;
 const pending=new Promise<Response>(resolve=>{finishSearch=resolve;});
 vi.stubGlobal('fetch',vi.fn().mockImplementation(async(url:string)=>url.endsWith('/users/search')?pending:new Response(JSON.stringify({id:'live-km170',username:'km170',name:'たんたんめん',avatarUrl:'https://example.com/avatar.png'}))));
 const publish=vi.fn(),search=searchMisskey('km170',false,undefined,publish);
 await vi.waitFor(()=>expect(publish).toHaveBeenCalledWith([expect.objectContaining({id:'misskey-user:live-km170',displayName:'たんたんめん',avatarUrl:'https://example.com/avatar.png'})]));
 finishSearch(new Response('[]'));
 expect((await search).users).toHaveLength(1);
});

it('finds kana variants of display names and retains federated accounts without follower thresholds',async()=>{
 const {searchMisskey}=await import('./misskey');
 const fetcher=vi.fn().mockImplementation(async(_url:string,init:RequestInit)=>{
  const body=JSON.parse(String(init.body));
  return Response.json(body.query==='あおぞらの絵描き'?[{id:'small-artist',username:'unrelated_handle',host:'art.example',name:'あおぞらの絵描き',followersCount:0}]:[]);
 });vi.stubGlobal('fetch',fetcher);
 const result=await searchMisskey('アオゾラノ絵描キ',false);
 expect(result.users).toEqual([expect.objectContaining({username:'unrelated_handle@art.example',displayName:'あおぞらの絵描き'})]);
 expect(fetcher.mock.calls.some(([,init])=>JSON.parse(String(init.body)).query==='あおぞらの絵描き')).toBe(true);
 expect(fetcher.mock.calls.every(([,init])=>JSON.parse(String(init.body)).origin==='combined')).toBe(true);
});

it('keeps a resolved inactive account searchable by its display name when the server omits it',async()=>{
 const {searchMisskey}=await import('./misskey');
 vi.stubGlobal('fetch',vi.fn().mockImplementation(async(url:string)=>Response.json(url.endsWith('/users/show')?{id:'inactive-name-test',username:'inactive_artist',name:'久遠の絵描き',avatarUrl:'https://example.com/artist.png'}:[])));
 await misskeyProfile('inactive_artist@misskey.io');
 const result=await searchMisskey('久遠の絵描き',false);
 expect(result.users).toEqual([expect.objectContaining({id:'misskey-user:inactive-name-test',displayName:'久遠の絵描き'})]);
});
