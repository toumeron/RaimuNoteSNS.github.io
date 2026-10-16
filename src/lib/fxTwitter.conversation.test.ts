import {afterEach,expect,it,vi} from 'vitest';
import {xConversationPage,xFeed,searchXPage} from './fxTwitter';
const raw=(id:string,parent?:string)=>({id,type:'status',text:id,created_at:'2026-10-15T00:00:00Z',author:{id:'123',screen_name:'artist',verification:{verified:true,type:'individual'}},replying_to:parent?{screen_name:'artist',status:parent}:null});
afterEach(()=>vi.unstubAllGlobals());
it('keeps ancestors separate from replies and pages through replies without duplicates',async()=>{
 const fetcher=vi.fn().mockImplementation((url:string)=>Promise.resolve(new Response(JSON.stringify(url.includes('cursor=next')?{code:200,status:raw('102','101'),thread:[raw('100'),raw('101','100'),raw('102','101')],replies:[raw('104','103')],cursor:{bottom:'next'}}:{code:200,status:raw('102','101'),thread:[raw('100'),raw('101','100'),raw('102','101'),raw('103','102')],replies:[raw('103','102'),raw('103','102')],cursor:{bottom:'next'}}))));vi.stubGlobal('fetch',fetcher);
 const first=await xConversationPage('x:102');expect(first.post?.externalReplyParent?.id).toBe('x:101');expect(first.post?.externalReplyParent?.externalReplyParent?.id).toBe('x:100');expect(first.replies.map(post=>post.id)).toEqual(['x:103']);expect(first.cursor).toBe('next');
 const next=await xConversationPage('x:102','next');expect(next.replies.map(post=>post.id)).toEqual(['x:104']);expect(next.cursor).toBeNull();
 expect(fetcher.mock.calls[0][0]).toContain('/conversation/102');
});
it('retains parent context from grouped profile replies and keeps cursors',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({code:200,results:[{type:'thread',statuses:[raw('111'),raw('112','111')]}],cursor:{bottom:'more'}}))));
 const page=await xFeed({actor:'artist@twitter.com',filter:'posts_with_replies'});expect(page.posts[1].externalReplyParent?.id).toBe('x:111');expect(page.cursor).toBe('more');
});
it('uses the correct Twitter search feed, full operators, pagination and cancellation',async()=>{
 const fetcher=vi.fn().mockImplementation(()=>Promise.resolve(new Response(JSON.stringify({code:200,results:[raw('121')],cursor:{bottom:'after'}}))));vi.stubGlobal('fetch',fetcher);const signal=new AbortController().signal;
 const page=await searchXPage('anime from:artist@twitter.com filter:videos',{cursor:'before',feed:'top',signal});const url=new URL(fetcher.mock.calls[0][0]);expect(url.searchParams.get('q')).toBe('anime from:artist filter:videos');expect(url.searchParams.get('feed')).toBe('top');expect(url.searchParams.get('cursor')).toBe('before');expect(page.cursor).toBe('after');
});
it('uses the author timeline for an author-only search even when global search is unavailable',async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({code:200,results:[raw('131')],cursor:{bottom:null}})));vi.stubGlobal('fetch',fetcher);
 expect((await searchXPage('(from:uniqueartist)')).posts[0].id).toBe('x:131');expect(fetcher.mock.calls[0][0]).toContain('/profile/uniqueartist/statuses?');
});
it('reports upstream search unavailability instead of silently claiming there are no posts',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({code:404,results:[]}),{status:404})));await expect(searchXPage('unavailable-global-query')).rejects.toThrow('LimeNoteへのログインが必要です');
});
it('uses the conversation endpoint through the shared external thread loader too',async()=>{
 const {fetchBlueskyPostThread}=await import('./bluesky');
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({code:200,status:raw('151'),thread:[raw('151')],replies:[raw('152','151')]})));vi.stubGlobal('fetch',fetcher);
 const thread=await fetchBlueskyPostThread('x:151');expect(thread.replies.map(post=>post.id)).toEqual(['x:152']);expect(fetcher.mock.calls[0][0]).toContain('/conversation/151');
});
it('ends reply pagination when the response contains only the post and ancestors even if a cursor is present',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({code:200,status:raw('171','170'),thread:[raw('170'),raw('171','170')],replies:[],cursor:{bottom:'phantom-next'}}))));
 const page=await xConversationPage('x:171');expect(page.replies).toEqual([]);expect(page.cursor).toBeNull();expect(page.post?.externalReplyParent?.id).toBe('x:170');
});
