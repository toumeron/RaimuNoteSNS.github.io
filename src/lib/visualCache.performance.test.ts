import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import prototypes from './recommendationVisualClassifierData.json';
const key='lime_recommendation_visual_cache_v1';
const visual=()=>({version:1 as const,kind:'untrusted-label',topics:[],confidence:1,similarity:1,vector:[...prototypes.prototypes[0].vectors[0]]});
let flush:(()=>void)|undefined;
beforeEach(()=>{vi.resetModules();localStorage.clear();});
afterEach(()=>{flush?.();flush=undefined;vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
it('classifies only the requested saved image, once, rather than all 150 images at startup',async()=>{
 localStorage.setItem(key,JSON.stringify(Array.from({length:150},(_,i)=>[`https://example.com/${i}`,visual()])));
 const module=await import('./recommendationVisual');flush=module.flushVisualCache;
 const norm=vi.spyOn(Math,'hypot');
 expect(module.readVisualCache('https://example.com/1')?.kind).toBe('moe');expect(norm).toHaveBeenCalledTimes(1);
 module.readVisualCache('https://example.com/1');expect(norm).toHaveBeenCalledTimes(1);
 module.readVisualCache('https://example.com/2');expect(norm).toHaveBeenCalledTimes(2);
});
it('coalesces PWA saves, keeps existing entries, and flushes when leaving the app',async()=>{
 vi.useFakeTimers();vi.stubGlobal('navigator',{standalone:true});
 localStorage.setItem(key,JSON.stringify([['https://example.com/existing',visual()]]));
 const module=await import('./recommendationVisual');flush=module.flushVisualCache;
 const timers=vi.spyOn(globalThis,'setTimeout'),cancelTimer=vi.spyOn(globalThis,'clearTimeout');
 const saved=vi.spyOn(Storage.prototype,'setItem');
 module.writeVisualCache('https://example.com/new',visual());module.writeVisualCache('https://example.com/newer',visual());
 const scheduled=timers.mock.results[timers.mock.calls.findIndex(call=>call[1]===250)].value;
 expect(saved).not.toHaveBeenCalled();expect(module.readVisualCache('https://example.com/new')).toBeTruthy();
 window.dispatchEvent(new Event('pagehide'));expect(saved).toHaveBeenCalledOnce();
 expect(JSON.parse(localStorage.getItem(key)!).map((entry:any)=>entry[0])).toEqual(['https://example.com/existing','https://example.com/new','https://example.com/newer']);
 expect(cancelTimer).toHaveBeenCalledWith(scheduled);
});
