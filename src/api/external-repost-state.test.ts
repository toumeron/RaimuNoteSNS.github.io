import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({reads:0,active:0,max:0,fail:false}));
vi.mock('@/lib/currentUser',()=>({getCurrentUserId:async()=> 'viewer'}));
vi.mock('@/lib/bluesky',()=>({fetchBlueskyPost:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabase:{from:()=>{
 const q={select:()=>q,eq:()=>q,maybeSingle:()=>q,abortSignal:()=>q,then:(resolve:any,reject:any)=>{
  m.reads++;m.active++;m.max=Math.max(m.max,m.active);
  return Promise.resolve().then(()=>{m.active--;return {data:null,count:1,error:m.fail?new Error('connection closed'):null};}).then(resolve,reject);
 }};return q;
}}}));
import {getExternalRepostState} from './external-posts';
let clock=Date.now();
beforeEach(()=>{clock+=20_000;vi.spyOn(Date,'now').mockReturnValue(clock);m.reads=0;m.active=0;m.max=0;m.fail=false;});
afterEach(()=>vi.restoreAllMocks());
it('bounds the number of simultaneous supplementary database reads for a large external feed',async()=>{
 const result=await Promise.all(Array.from({length:100},(_,i)=>getExternalRepostState('x:'+i)));
 expect(result).toHaveLength(100);expect(m.max).toBeLessThanOrEqual(6);expect(result[0]).toEqual({repostsCount:2,repostedByMe:false});
});
it('stops a thousand-card network failure burst, then recovers after the short cooldown',async()=>{
 m.fail=true;
 const result=await Promise.allSettled(Array.from({length:1000},(_,i)=>getExternalRepostState('x:'+i)));
 expect(result.every(row=>row.status==='rejected')).toBe(true);expect(m.reads).toBeLessThanOrEqual(6);
 const before=m.reads;await expect(getExternalRepostState('x:next')).rejects.toThrow('connection closed');expect(m.reads).toBe(before);
 clock+=16_000;vi.mocked(Date.now).mockReturnValue(clock);m.fail=false;
 await expect(getExternalRepostState('x:recovered')).resolves.toMatchObject({repostsCount:2});
});
it('never submits a cancelled offscreen read',async()=>{
 const controller=new AbortController();controller.abort(new DOMException('cancelled','AbortError'));
 await expect(getExternalRepostState('x:cancelled',controller.signal)).rejects.toThrow('cancelled');expect(m.reads).toBe(0);
});
