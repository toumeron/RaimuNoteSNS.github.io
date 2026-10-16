import {expect,it,vi} from 'vitest';
it('persists actual views across reloads and isolates accounts',async()=>{
 localStorage.clear();
 const first=await import("@/hooks/useTrendViews");first.recordTrendView('x:123','account-a');
 vi.resetModules();
 const reloaded=await import("@/hooks/useTrendViews");
 expect(reloaded.readTrendViews('account-a')).toEqual(new Set(['x:123']));
 expect(reloaded.readTrendViews('account-b')).toEqual(new Set());
 expect(reloaded.readTrendViews(null)).toEqual(new Set());
});
it('retains session views when local storage cannot be written',async()=>{
 const store=await import("@/hooks/useTrendViews");
 const failing=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
 try{store.recordTrendView('x:quota','blocked');expect(store.readTrendViews('blocked').has('x:quota')).toBe(true);}finally{failing.mockRestore();}
});

it('persists delivered batches before a view timer can fire and deduplicates them',async()=>{
 const store=await import("@/hooks/useTrendViews");store.recordTrendDeliveries(['x:fast-a','x:fast-b','x:fast-a'],'fast-scroll');
 expect(store.readTrendViews('fast-scroll')).toEqual(new Set(['x:fast-a','x:fast-b']));
 vi.resetModules();const reloaded=await import("@/hooks/useTrendViews");expect(reloaded.readTrendViews('fast-scroll')).toEqual(new Set(['x:fast-a','x:fast-b']));
});

it('does not repeatedly parse or rewrite an unchanged delivered history',async()=>{
 const store=await import("@/hooks/useTrendViews");store.recordTrendDeliveries(['x:same'],'stable-history');
 const parse=vi.spyOn(JSON,'parse'),write=vi.spyOn(Storage.prototype,'setItem');
 try{for(let i=0;i<100;i++){store.readTrendViews('stable-history');store.recordTrendView('x:same','stable-history');}
 expect(parse).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();}finally{parse.mockRestore();write.mockRestore();}
});
