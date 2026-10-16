import {beforeEach,expect,it,vi} from 'vitest';
import {getRecommendationContinuation as readContinuation} from './recommendation-continuation';
import {getBalancedRecommendationPage} from './balanced-recommendations';
import {createRecommendationCursor} from './recommendations';
vi.mock('./balanced-recommendations',()=>({getBalancedRecommendationPage:vi.fn()}));
const getRecommendationContinuation:typeof readContinuation=(cursor,viewer,signal,onReady)=>readContinuation(cursor,viewer,signal,onReady,{target:6});
const read=vi.mocked(getBalancedRecommendationPage);
const cursor=createRecommendationCursor([]);
const post=(id:string)=>({id,userId:id,imageUrls:[`https://example.com/${id}.jpg`],content:'',createdAt:'2026-10-16',author:{id,username:id}} as any);
const page=(ids:string[],key:number,extra:Record<string,unknown>={})=>({posts:ids.map(post),preferences:{authors:{},terms:{}},requestKey:key,next:{...cursor,pageKey:key},automaticPaused:false,pendingAnalysis:false,twitterError:null,visualError:null,...extra} as any);
beforeEach(()=>read.mockReset());
it('collects three sparse mixed responses into six ready cards and retains the final cursor',async()=>{
 read.mockResolvedValueOnce(page(['x:1','bsky:1'],1)).mockResolvedValueOnce(page(['x:2','bsky:2'],2)).mockResolvedValueOnce(page(['x:3','bsky:3'],3));
 const result=await getRecommendationContinuation(cursor,null);
 expect(result.posts.map(row=>row.id)).toEqual(['x:1','bsky:1','x:2','bsky:2','x:3','bsky:3']);
 expect(read).toHaveBeenCalledTimes(3);expect(read.mock.calls[1][0].pageKey).toBe(1);expect(result.next?.pageKey).toBe(3);
});
it('bounds sparse or empty scans to four reads rather than draining sources',async()=>{
 read.mockResolvedValue(page([],1));
 expect((await getRecommendationContinuation(cursor,null)).posts).toEqual([]);
 expect(read).toHaveBeenCalledTimes(4);
});
it('deduplicates across buffered responses without counting duplicates toward the reserve',async()=>{
 read.mockResolvedValueOnce(page(['a','b'],1)).mockResolvedValueOnce(page(['b','c'],2)).mockResolvedValueOnce(page(['d','e','f'],3));
 expect((await getRecommendationContinuation(cursor,null)).posts.map(row=>row.id)).toEqual(['a','b','c','d','e','f']);
});
it.each([{automaticPaused:true},{pendingAnalysis:true},{next:undefined}])('stops on a source or analysis boundary: %s',async boundary=>{
 read.mockResolvedValue(page(['a'],1,boundary));
 expect((await getRecommendationContinuation(cursor,null)).posts).toHaveLength(1);expect(read).toHaveBeenCalledTimes(1);
});
it('does not start another read after cancellation',async()=>{
 const controller=new AbortController();
 read.mockImplementationOnce(async()=>{controller.abort(new Error('cancelled'));return page(['a'],1);});
 await expect(getRecommendationContinuation(cursor,null,controller.signal)).rejects.toThrow('cancelled');expect(read).toHaveBeenCalledTimes(1);
});
it('prepares a production reserve of 20 verified cards instead of stopping at six',async()=>{
 read.mockResolvedValueOnce(page(Array.from({length:8},(_,i)=>'first-'+i),1)).mockResolvedValueOnce(page(Array.from({length:8},(_,i)=>'second-'+i),2)).mockResolvedValueOnce(page(Array.from({length:4},(_,i)=>'third-'+i),3));
 const result=await readContinuation(cursor,null);expect(result.posts).toHaveLength(20);expect(read).toHaveBeenCalledTimes(3);expect(read.mock.calls.map(call=>call[3]?.pageSize)).toEqual([20,12,4]);expect(result.next?.pageKey).toBe(3);
});

it.each(['twitterError','visualError'])('continues a healthy advancing cursor after a failed source: %s',async key=>{
 read.mockResolvedValueOnce(page(['a'],1,{[key]:new Error('unavailable')})).mockResolvedValueOnce(page(['b','c','d','e','f'],2));
 const result=await getRecommendationContinuation(cursor,null);expect(result.posts).toHaveLength(6);expect(read).toHaveBeenCalledTimes(2);
});
