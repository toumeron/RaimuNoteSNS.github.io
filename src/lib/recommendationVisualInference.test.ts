import {afterEach,expect,it,vi} from 'vitest';
import type {PostWithAuthor} from '@/types';
import prototypes from './recommendationVisualPrototypes.json';
import {enrichRecommendationVisuals,idleRecommendationVisualWorker,releaseRecommendationVisualWorker,warmRecommendationVisualWorker} from './recommendationVisualInference';
const vector=prototypes.prototypes.find(row=>row.id==='moe')!.vectors[0];
const post=(id:string,url=id)=>({id,userId:id,imageUrls:['https://images.example/inference-'+url+'.jpg'],content:'',author:{id,username:id}}) as PostWithAuthor;
const workers:FakeWorker[]=[];
class FakeWorker{
 onmessage:((event:{data:{id:number;vector:number[]}})=>void)|null=null;
 onerror:(()=>void)|null=null;
 requests:Array<{id:number;url:string}>=[];
 terminate=vi.fn();
 constructor(){workers.push(this);}
 postMessage(data:{id:number;url?:string;warm?:boolean}){if(data.url)this.requests.push({id:data.id,url:data.url});}
 finish(){for(const request of this.requests.splice(0))this.onmessage?.({data:{id:request.id,vector}});}
}
afterEach(()=>{for(const worker of workers)worker.finish();releaseRecommendationVisualWorker();workers.length=0;vi.unstubAllGlobals();vi.useRealTimers();});
it('submits three uncached images before waiting for the first result and preserves input order',async()=>{
 vi.stubGlobal('Worker',FakeWorker);
 const pending=enrichRecommendationVisuals([post('parallel-a'),post('parallel-b'),post('parallel-c')],['digital-illustration']);
 expect(workers[0].requests).toHaveLength(3);workers[0].finish();
 const result=await pending;expect(result.map(post=>post.id)).toEqual(['parallel-a','parallel-b','parallel-c']);
 expect(result.every(post=>post.recommendationVisualStatus==='checked')).toBe(true);
});
it('shares one in-flight image analysis for duplicate URLs',async()=>{
 vi.stubGlobal('Worker',FakeWorker);
 const pending=enrichRecommendationVisuals([post('copy-a','shared'),post('copy-b','shared')],['digital-illustration']);
 expect(workers[0].requests).toHaveLength(1);workers[0].finish();
 expect((await pending).every(post=>post.recommendationVisualStatus==='checked')).toBe(true);
});
it('reuses the model after a reading pause and eventually releases its memory',async()=>{
 vi.useFakeTimers();vi.stubGlobal('Worker',FakeWorker);warmRecommendationVisualWorker();
 const first=enrichRecommendationVisuals([post('idle-first')],['digital-illustration']);workers[0].finish();await first;idleRecommendationVisualWorker();
 await vi.advanceTimersByTimeAsync(25000);expect(workers[0].terminate).not.toHaveBeenCalled();
 const second=enrichRecommendationVisuals([post('idle-second')],['digital-illustration']);expect(workers).toHaveLength(1);workers[0].finish();await second;idleRecommendationVisualWorker();
 await vi.advanceTimersByTimeAsync(120000);expect(workers[0].terminate).toHaveBeenCalledTimes(1);
});

it('keeps the initialized model when consuming a ready reserve cancels unfinished analysis',async()=>{
 vi.stubGlobal('Worker',FakeWorker);
 const controller=new AbortController();
 const cancelled=enrichRecommendationVisuals([post('cancel-reserve')],['digital-illustration'],controller.signal);
 const rejection=expect(cancelled).rejects.toMatchObject({name:'AbortError'});
 controller.abort();await rejection;expect(workers[0].terminate).not.toHaveBeenCalled();
 const next=enrichRecommendationVisuals([post('after-cancel')],['digital-illustration']);
 expect(workers).toHaveLength(1);workers[0].finish();expect((await next)[0].recommendationVisualStatus).toBe('checked');
});
<<<<<<< HEAD
=======

it('does not repeatedly request a failed image when scrolling reaches it again',async()=>{
 vi.useFakeTimers();vi.stubGlobal('Worker',FakeWorker);
 const first=enrichRecommendationVisuals([post('failed-first','failed-shared')],['digital-illustration']);
 workers[0].onerror?.();expect((await first)[0].recommendationVisualStatus).toBe('unavailable');
 const second=await enrichRecommendationVisuals([post('failed-next','failed-shared')],['digital-illustration']);
 expect(second[0].recommendationVisualStatus).toBe('unavailable');expect(workers).toHaveLength(1);
 await vi.advanceTimersByTimeAsync(60001);
 const retry=enrichRecommendationVisuals([post('failed-recovered','failed-shared')],['digital-illustration']);
 expect(workers).toHaveLength(2);workers[1].finish();expect((await retry)[0].recommendationVisualStatus).toBe('checked');
});
>>>>>>> 374490cc (“update23”)
