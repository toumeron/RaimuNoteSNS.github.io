import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('@/lib/fxTwitter',()=>({searchXPage:vi.fn()}));
import {searchXPage} from '@/lib/fxTwitter';
import {createTwitterTrendCursor,getTwitterTrendPage} from './twitter-trends';
const search=vi.mocked(searchXPage);
const cursor=()=>({...createTwitterTrendCursor({followed:['digital-illustration'],dismissed:[]}),fallbackPositions:[]});
const post=(id:string,likesCount:number,extra={})=>({id,userId:id,source:'x',content:'',imageUrls:[],likesCount,createdAt:'2026-10-17T00:00:00Z',author:{id,username:id},...extra}) as any;
beforeEach(()=>{search.mockReset();});afterEach(()=>{vi.useRealTimers();});
it('selects only explicit non-dismissed topics and requests popular twitter posts',async()=>{
 const state=createTwitterTrendCursor({followed:['science','pets'],dismissed:['pets']});
 expect(state.positions).toHaveLength(1);expect(state.positions[0].query).toBe('(科学 研究)');
 search.mockResolvedValue({posts:[],cursor:null});await getTwitterTrendPage(state);
 expect(search).toHaveBeenCalledWith(state.positions[0].query,expect.objectContaining({feed:'top',preferAlternative:true}));
});
it('enforces the inclusive 1000-like boundary locally, excludes reposts and other sources, and sorts by likes',async()=>{
 search.mockResolvedValue({posts:[post('x:1',1000),post('x:2',999),post('x:3',2000),post('bsky:4',5000,{source:'bluesky'}),post('x:5',4000,{profileRepostedBy:'actor'}),post('x:6',NaN)],cursor:null});
 const result=await getTwitterTrendPage(cursor());expect(result.posts.map(row=>row.id)).toEqual(['x:3','x:1']);expect(result.next).toBeUndefined();
});
it('advances a page containing only low-like posts without relaxing the condition or replaying posts',async()=>{
 search.mockResolvedValueOnce({posts:[post('x:first',1200)],cursor:'page2'}).mockResolvedValueOnce({posts:[post('x:low',999),post('x:first',1200)],cursor:'page3'});
 const first=await getTwitterTrendPage(cursor()),second=await getTwitterTrendPage(first.next!);
 expect(second.posts).toEqual([]);expect(second.next?.positions[0].cursor).toBe('page3');
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
 expect(result.posts).toHaveLength(3);expect(result.posts.every(row=>row.likesCount>=1000)).toBe(true);
 expect(search).toHaveBeenCalledTimes(3);expect(result.next).toBeDefined();
});
it('fills an empty topic result from popular posts in the same page without relaxing the threshold',async()=>{
 const state=cursor();state.fallbackPositions=[{query:'(写真 動画)',cursor:null,done:false}];
 search.mockImplementation(async query=>({posts:query===state.positions[0].query?[post('x:topic-low',999)]:[post('x:popular',1500)],cursor:null}));
 const result=await getTwitterTrendPage(state);expect(result.posts.map(row=>row.id)).toEqual(['x:popular']);expect(search).toHaveBeenCalledTimes(2);
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
