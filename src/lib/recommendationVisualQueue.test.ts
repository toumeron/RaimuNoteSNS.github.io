import {expect,it,vi} from 'vitest';
import {createRecommendationVisualQueue} from './recommendationVisualQueue';
const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
it('overlaps model startup and bounded downloads while keeping inference serial',async()=>{
 vi.useFakeTimers();try{
  const start=Date.now();let downloads=0,maxDownloads=0,inferences=0,maxInferences=0;
  const context=delay(1000).then(()=>({ready:true}));
  const run=createRecommendationVisualQueue({load:()=>context,prepare:async(id:number)=>{downloads++;maxDownloads=Math.max(downloads,maxDownloads);await delay(1000);downloads--;return id;},infer:async(_context,id)=>{inferences++;maxInferences=Math.max(inferences,maxInferences);await delay(100);inferences--;return id;}});
  const done=Promise.all(Array.from({length:6},(_,i)=>run(i)));let finished=false;void done.then(()=>{finished=true;});
  await vi.advanceTimersByTimeAsync(2399);expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(1);expect(await done).toEqual([0,1,2,3,4,5]);
  expect(Date.now()-start).toBe(2400);expect(maxDownloads).toBe(3);expect(maxInferences).toBe(1);
 }finally{vi.useRealTimers();}
});
it('lets ready images run before a slow earlier image download',async()=>{
 vi.useFakeTimers();try{
  const prepared:number[]=[],inferred:number[]=[];
  const run=createRecommendationVisualQueue({load:async()=>null,prepare:async(id:number)=>{await delay(id===0?3000:10);prepared.push(id);return id;},infer:async(_context,id)=>{inferred.push(id);return id;}});
  const jobs=[run(0),run(1),run(2)];await vi.advanceTimersByTimeAsync(20);
  expect(prepared).toEqual([1,2]);expect(inferred).toEqual([1,2]);
  await vi.advanceTimersByTimeAsync(3000);expect(await Promise.all(jobs)).toEqual([0,1,2]);
 }finally{vi.useRealTimers();}
});
it('releases capacity after failures and continues later images',async()=>{
 const run=createRecommendationVisualQueue({capacity:1,load:async()=>null,prepare:async(id:number)=>{if(id===0)throw new Error('unavailable');return id;},infer:async(_context,id)=>id});
 const result=await Promise.allSettled([run(0),run(1),run(2)]);
 expect(result.map(row=>row.status)).toEqual(['rejected','fulfilled','fulfilled']);
});
