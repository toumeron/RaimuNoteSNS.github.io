import {afterEach,expect,it,vi} from 'vitest';
import {readRecommendationReserve,saveRecommendationReserve,clearRecommendationReserve} from './recommendationReserve';
const page=(n=20)=>({posts:Array.from({length:n},(_,i)=>({id:'post-'+i,userId:'author-'+i,author:{id:'author-'+i},imageUrls:[]})),preferences:{authors:{},terms:{}},next:undefined} as any);
afterEach(()=>{sessionStorage.clear();vi.restoreAllMocks();});
it('retains only a complete reserve for the same account and sources',()=>{
 saveRecommendationReserve('viewer:a',page(19));expect(readRecommendationReserve('viewer:a')).toBeUndefined();
 saveRecommendationReserve('viewer:a',page());expect(readRecommendationReserve('viewer:a')?.posts).toHaveLength(20);expect(readRecommendationReserve('viewer:b')).toBeUndefined();clearRecommendationReserve();expect(readRecommendationReserve('viewer:a')).toBeUndefined();
});
it('expires prepared work after two minutes and rejects malformed checkpoints',()=>{
 const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now);saveRecommendationReserve('viewer',page());vi.mocked(Date.now).mockReturnValue(now+120001);expect(readRecommendationReserve('viewer')).toBeUndefined();
 sessionStorage.setItem('lime-recommendation-reserve-v1','broken');expect(readRecommendationReserve('viewer')).toBeUndefined();
});
