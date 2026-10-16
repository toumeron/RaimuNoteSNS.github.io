import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('@/lib/fxTwitter',()=>({searchXPage:vi.fn()}));
import {searchXPage} from '@/lib/fxTwitter';
import {createTwitterTrendCursor,getTwitterTrendPage} from './twitter-trends';
const search=vi.mocked(searchXPage);
const cursor=()=>({...createTwitterTrendCursor({followed:['digital-illustration'],dismissed:[]}),fallbackPositions:[]});
const post=(id:string,likesCount:number,extra={})=>({id,userId:id,source:'x',content:'',imageUrls:[],likesCount,createdAt:'2026-10-17T00:00:00Z',author:{id,username:id},...extra}) as any;
beforeEach(()=>{search.mockReset();vi.spyOn(Math,'random').mockReturnValue(.9999);});afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it('selects only explicit non-dismissed topics and requests popular twitter posts',async()=>{
 const state=createTwitterTrendCursor({followed:['science','pets'],dismissed:['pets']});
 expect(state.positions).toHaveLength(1);expect(state.positions[0].query).toBe('(科学 研究)');
 search.mockResolvedValue({posts:[],cursor:null});await getTwitterTrendPage(state);
 expect(search).toHaveBeenCalledWith(state.positions[0].query,expect.objectContaining({feed:'top',preferAlternative:true}));
});
it('accepts popular candidates below 1000 likes while excluding reposts and other sources',async()=>{
 search.mockResolvedValue({posts:[post('x:1',1000),post('x:2',999),post('x:3',2000),post('bsky:4',5000,{source:'bluesky'}),post('x:5',4000,{profileRepostedBy:'actor'}),post('x:6',NaN)],cursor:null});
 const result=await getTwitterTrendPage(cursor());expect(result.posts.map(row=>row.id)).toEqual(['x:3','x:1','x:2']);expect(result.next).toBeUndefined();
});
it('advances low-like popular posts without replaying prior posts',async()=>{
 search.mockResolvedValueOnce({posts:[post('x:first',1200)],cursor:'page2'}).mockResolvedValueOnce({posts:[post('x:low',999),post('x:first',1200)],cursor:'page3'});
 const first=await getTwitterTrendPage(cursor()),second=await getTwitterTrendPage(first.next!);
 expect(second.posts.map(row=>row.id)).toEqual(['x:low']);expect(second.next?.positions[0].cursor).toBe('page3');
});
it('ends a repeated source cursor instead of retrying it indefinitely',async()=>{
 const state=cursor();state.positions[0].cursor='same';search.mockResolvedValue({posts:[],cursor:'same'});
 expect((await getTwitterTrendPage(state)).next).toBeUndefined();expect(search).toHaveBeenCalledTimes(1);
});
it('bounds a nonresponsive reader instead of remaining loading forever',async()=>{
 vi.useFakeTimers();search.mockImplementation(()=>new Promise(()=>{}));
 const pending=expect(getTwitterTrendPage(cursor())).rejects.toMatchObject({name:'TimeoutError'});
 await vi.advanceTimersByTimeAsync(8001);await pending;
});

it('uses random popular-topic sources immediately when no topics are followed',async()=>{
 const state=createTwitterTrendCursor({followed:[],dismissed:['crypto']});
 expect(state.positions).toEqual([]);expect(state.fallbackPositions!.length).toBeGreaterThan(3);
 expect(state.fallbackPositions!.some(position=>position.query.includes('仮想通貨'))).toBe(false);
 let id=0;search.mockImplementation(async()=>({posts:[post('x:popular-'+(++id),2000),post('x:low',999)],cursor:null}));
 const result=await getTwitterTrendPage(state);
 expect(result.posts).toHaveLength(4);expect(result.posts.some(row=>row.likesCount===999)).toBe(true);
 expect(search).toHaveBeenCalledTimes(3);expect(result.next).toBeDefined();
});
it('delivers a low-like topic candidate without waiting for unrelated fallback searches',async()=>{
 const state=cursor();state.fallbackPositions=[{query:'(写真 動画)',cursor:null,done:false}];
 search.mockImplementation(async query=>({posts:query===state.positions[0].query?[post('x:topic-low',999)]:[post('x:popular',1500)],cursor:null}));
 const result=await getTwitterTrendPage(state);expect(result.posts.map(row=>row.id)).toEqual(['x:topic-low']);expect(search).toHaveBeenCalledTimes(1);
});
it('shuffles popular candidates and does not replay them on subsequent scroll pages',async()=>{
 const random=vi.spyOn(Math,'random').mockReturnValue(0);
 try{
  const state=cursor();state.positions=[];state.fallbackPositions=[{query:'popular',cursor:null,done:false}];
  search.mockResolvedValueOnce({posts:[post('x:high',5000),post('x:middle',3000),post('x:minimum',1000)],cursor:'next'}).mockResolvedValueOnce({posts:[post('x:high',5000),post('x:fresh',2000)],cursor:null});
  const first=await getTwitterTrendPage(state);expect(first.posts.map(row=>row.id)).toEqual(['x:middle','x:minimum','x:high']);
  const second=await getTwitterTrendPage(first.next!);expect(second.posts.map(row=>row.id)).toEqual(['x:fresh']);expect(second.next).toBeUndefined();
 }finally{random.mockRestore();}
});
it('continues with popular candidates when the topic source fails',async()=>{
 const state=cursor();state.fallbackPositions=[{query:'popular',cursor:null,done:false}];
 search.mockRejectedValueOnce(new Error('topic unavailable')).mockResolvedValueOnce({posts:[post('x:popular',2000)],cursor:null});
 expect((await getTwitterTrendPage(state)).posts.map(row=>row.id)).toEqual(['x:popular']);
});
it('keeps overflow candidates for the next page rather than discarding them',async()=>{
 const state=cursor();state.positions=[];state.fallbackPositions=[{query:'popular',cursor:null,done:false}];
 search.mockResolvedValue({posts:Array.from({length:25},(_,i)=>post('x:pool-'+i,1000+i)),cursor:null});
 const first=await getTwitterTrendPage(state),second=await getTwitterTrendPage(first.next!);
 expect(first.posts).toHaveLength(20);expect(first.posts.every(row=>row.likesCount>=1005)).toBe(true);expect(second.posts).toHaveLength(5);expect(new Set([...first.posts,...second.posts].map(row=>row.id)).size).toBe(25);expect(second.next).toBeUndefined();
});

it('excludes viewed posts after refresh and from buffered scroll pages without hiding unseen posts',async()=>{
 search.mockResolvedValue({posts:[post('x:viewed',5000),post('x:unseen',2000)],cursor:null});
 const first=await getTwitterTrendPage(cursor(),undefined,new Set(['x:viewed']));
 expect(first.posts.map(row=>row.id)).toEqual(['x:unseen']);
 const state=cursor();state.remaining=[post('x:buffer-viewed',4000),post('x:buffer-unseen',3000)];
 search.mockResolvedValue({posts:[],cursor:null});
 const next=await getTwitterTrendPage(state,undefined,new Set(['x:buffer-viewed']));
 expect(next.posts.map(row=>row.id)).toEqual(['x:buffer-unseen']);
});

it('retains fetched topic posts when the popular fallback times out',async()=>{
 vi.useFakeTimers();
 const state=cursor();state.fallbackPositions=[{query:'popular',cursor:null,done:false}];
 search.mockResolvedValueOnce({posts:[post('x:ready',2000)],cursor:null}).mockImplementationOnce(()=>new Promise(()=>{}));
 const pending=getTwitterTrendPage(state);
 await vi.advanceTimersByTimeAsync(8001);
 const page=await pending;
 expect(page.posts.map(row=>row.id)).toEqual(['x:ready']);
 expect(page.next?.fallbackPositions?.[0].done).toBe(false);
});
it('keeps failed sources available when another source supplied posts',async()=>{
 const state=cursor();state.fallbackPositions=[{query:'popular',cursor:null,done:false}];
 search.mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce({posts:[post('x:ready',2000)],cursor:null});
 const page=await getTwitterTrendPage(state);
 expect(page.posts.map(row=>row.id)).toEqual(['x:ready']);expect(page.next?.positions[0].done).toBe(false);
});
it('does not report an exhausted empty page when an unread source failed',async()=>{
 const state=cursor();state.fallbackPositions=[{query:'popular',cursor:null,done:false}];
 search.mockResolvedValueOnce({posts:[],cursor:null}).mockRejectedValueOnce(new Error('temporary'));
 await expect(getTwitterTrendPage(state)).rejects.toThrow('temporary');
});

it('delivers a successful popular source even when another source in the same batch never responds',async()=>{
 vi.useFakeTimers();
 const state=cursor();state.positions=[];state.fallbackPositions=[{query:'ready',cursor:null,done:false},{query:'slow',cursor:null,done:false}];
 search.mockImplementation(async query=>query==='ready'?{posts:[post('x:ready',2000)],cursor:null}:new Promise(()=>{}));
 const pending=getTwitterTrendPage(state);await vi.advanceTimersByTimeAsync(8001);
 const page=await pending;expect(page.posts.map(row=>row.id)).toEqual(['x:ready']);
 expect(page.next?.fallbackPositions?.find(row=>row.query==='slow')?.done).toBe(false);
});

it('returns the first usable popular batch without waiting for a stalled source',async()=>{
 vi.useFakeTimers();
 const state=cursor();state.positions=[];state.fallbackPositions=[{query:'ready',cursor:null,done:false},{query:'slow',cursor:null,done:false}];
 search.mockImplementation(query=>query==='ready'?new Promise(resolve=>setTimeout(()=>resolve({posts:[post('x:fast',15)],cursor:'more'}),50)):new Promise(()=>{}));
 let resolved=false;const pending=getTwitterTrendPage(state).then(page=>{resolved=true;return page;});
 await vi.advanceTimersByTimeAsync(50);expect(resolved).toBe(true);
 const page=await pending;expect(page.posts.map(row=>row.id)).toEqual(['x:fast']);expect(page.next?.fallbackPositions?.[1].done).toBe(false);
 expect(search).toHaveBeenCalledWith('ready',expect.objectContaining({feed:'top',limit:6}));
});
it('serves buffered candidates immediately without starting another network read',async()=>{
 const state=cursor();state.remaining=[post('x:reserved',5)];search.mockImplementation(()=>new Promise(()=>{}));
 const page=await getTwitterTrendPage(state);expect(page.posts.map(row=>row.id)).toEqual(['x:reserved']);expect(search).not.toHaveBeenCalled();
});
it('does not replay delivered posts across fresh cursors and successive pages',async()=>{
 search.mockResolvedValue({posts:[post('x:already',800),post('x:new',20)],cursor:'more'});
 const page=await getTwitterTrendPage(cursor(),undefined,new Set(['x:already']));expect(page.posts.map(row=>row.id)).toEqual(['x:new']);
 const next=await getTwitterTrendPage(page.next!,undefined,new Set(['x:already','x:new']));expect(next.posts).toEqual([]);
});

it('deduplicates one load at a time across 20 scroll pages and a refreshed cursor',async()=>{
 const delivered=new Set<string>();let state=cursor();
 for(let page=0;page<20;page++){
  search.mockResolvedValueOnce({posts:[post('x:repeat',500),post(`x:fresh-${page}`,page)],cursor:`page-${page+1}`});
  const result=await getTwitterTrendPage(state,undefined,delivered);
  expect(result.posts.some(post=>delivered.has(post.id))).toBe(false);
  expect(result.posts.some(post=>post.id===`x:fresh-${page}`)).toBe(true);
  result.posts.forEach(post=>delivered.add(post.id));state=result.next! as typeof state;
 }
 search.mockResolvedValue({posts:[post('x:repeat',500),post('x:fresh-0',10)],cursor:null});
 expect((await getTwitterTrendPage(cursor(),undefined,delivered)).posts).toEqual([]);
 expect(delivered.size).toBe(21);
});
