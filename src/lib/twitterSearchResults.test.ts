import {expect,it,vi,beforeEach} from 'vitest';
const search=vi.hoisted(()=>vi.fn());
vi.mock('./fxTwitter',()=>({searchXPage:search}));
vi.mock('./timelinePaging',()=>({normalizeTimelineBlueskyPost:(post:any)=>post}));
import { searchTwitterResults } from "@/lib/twitterSearch";
const post=(id:string,content='match')=>({id,source:'x',content}) as any;
const options={cursor:null,feed:'top' as const,matches:(post:any)=>post.content==='match'};
beforeEach(()=>search.mockReset());
it('reads another source page after filtering instead of filling the page with other services',async()=>{
 search.mockResolvedValueOnce({posts:[post('x:1'),post('x:2','irrelevant')],cursor:'next'}).mockResolvedValueOnce({posts:[post('x:1'),...Array.from({length:19},(_,i)=>post('x:'+String(i+3)))],cursor:'third'});
 const page=await searchTwitterResults('query',options);
 expect(page.posts).toHaveLength(20);expect(new Set(page.posts.map(post=>post.id)).size).toBe(20);expect(page.cursor).toBe('third');
 expect(search.mock.calls[1][1]).toMatchObject({cursor:'next',limit:20});
});
it('keeps each request bounded and excludes already shown and reserved posts',async()=>{
 search.mockResolvedValue({posts:[post('x:seen'),post('x:buffer'),post('x:valid')],cursor:'same'});
 const page=await searchTwitterResults('query',{...options,exclude:new Set(['x:seen','x:buffer'])});
 expect(page.posts.map(post=>post.id)).toEqual(['x:valid']);expect(page.cursor).toBeNull();expect(search).toHaveBeenCalledTimes(2);
});
it('returns partial successful results and resumes at the failed page on a later load',async()=>{
 search.mockResolvedValueOnce({posts:[post('x:1')],cursor:'next'}).mockRejectedValueOnce(new Error('temporary'));
 const page=await searchTwitterResults('query',options);expect(page.posts).toHaveLength(1);expect(page.cursor).toBe('next');expect(page.error).toBeInstanceOf(Error);
});
it('does not fetch another page when enough relevant twitter candidates are available',async()=>{
 search.mockResolvedValue({posts:Array.from({length:20},(_,i)=>post('x:'+i)),cursor:'next'});
 expect((await searchTwitterResults('query',options)).posts).toHaveLength(20);expect(search).toHaveBeenCalledTimes(1);
});
it('propagates cancellation rather than publishing a stale partial batch',async()=>{
 const reason=new Error('Cancelled search'),signal={aborted:false,reason};
 search.mockImplementation(async()=>{signal.aborted=true;return {posts:[post('x:stale')],cursor:null};});
 let caught:unknown;try{await searchTwitterResults('query',{...options,signal:signal as AbortSignal});}catch(error){caught=error;}
 expect((caught as Error)?.message).toBe('Cancelled search');
});

it('uses already buffered twitter posts without adding network work',async()=>{
 const page=await searchTwitterResults('query',{...options,cursor:'next',target:0});
 expect(page).toMatchObject({posts:[],cursor:'next',error:null});expect(search).not.toHaveBeenCalled();
});
