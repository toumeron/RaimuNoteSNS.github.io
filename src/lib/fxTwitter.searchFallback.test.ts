import{afterEach,expect,it,vi}from'vitest';
const relay=vi.hoisted(()=>vi.fn());vi.mock('./twitterSearchRelay',()=>({relayTwitterSearch:relay}));
import{searchXPage}from'./fxTwitter';
afterEach(()=>{vi.unstubAllGlobals();});
it('uses alternative search on a 404, hydrates at most six posts with current counts, and resumes directly',async()=>{
 relay.mockResolvedValueOnce({ids:['201','202'],cursor:6}).mockResolvedValueOnce({ids:['203'],cursor:null});
 const fetcher=vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('/search?')?{code:404,results:[]}:{code:200,status:{id:url.match(/status\/(\d+)/)![1],type:'status',text:'JR東日本',likes:42,author:{id:'123',screen_name:'rail'}}}),{status:url.includes('/search?')?404:200}));vi.stubGlobal('fetch',fetcher);
 const first=await searchXPage('JR東日本');expect(first.posts.map(post=>post.id)).toEqual(['x:201','x:202']);expect(first.posts[0].likesCount).toBe(42);expect(first.cursor).toBe('yahoo:6');
 const next=await searchXPage('JR東日本',{cursor:first.cursor});expect(next.posts[0].id).toBe('x:203');expect(next.cursor).toBeNull();expect(fetcher.mock.calls.filter(([url])=>url.includes('/search?'))).toHaveLength(1);expect(relay.mock.calls[1][2]).toBe(6);
});
