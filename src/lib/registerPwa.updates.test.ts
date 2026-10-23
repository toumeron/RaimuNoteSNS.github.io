import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerPwa } from './registerPwa';
const published='1792756800000-abcdef12';
let cancel:()=>void;
beforeEach(()=>{
 vi.useFakeTimers();vi.stubEnv('DEV',false);vi.stubEnv('VITE_PWA_BUILD_ID','');
 vi.spyOn(document,'readyState','get').mockReturnValue('complete');
 vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
 vi.stubGlobal('requestIdleCallback',undefined);
});
afterEach(()=>{cancel?.();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
function fixture(){
 const registration=Object.assign(new EventTarget(),{installing:null,waiting:null,update:vi.fn().mockResolvedValue(undefined)});
 const workers=Object.assign(new EventTarget(),{controller:{scriptURL:''},register:vi.fn().mockResolvedValue(registration)});
 vi.stubGlobal('navigator',{serviceWorker:workers,onLine:true});return {registration,workers};
}
it('checks an app kept in the foreground, pauses while hidden and checks immediately on resume',async()=>{
 const {registration}=fixture();cancel=registerPwa();await vi.advanceTimersByTimeAsync(1);
 expect(registration.update).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(60000);expect(registration.update).toHaveBeenCalledTimes(2);
 vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');await vi.advanceTimersByTimeAsync(120000);expect(registration.update).toHaveBeenCalledTimes(2);
 vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');document.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(0);expect(registration.update).toHaveBeenCalledTimes(3);
 window.dispatchEvent(new Event('focus'));await vi.advanceTimersByTimeAsync(0);expect(registration.update).toHaveBeenCalledTimes(3);
});
it('retries a failed registration rather than leaving the PWA without update checks',async()=>{
 vi.spyOn(console,'debug').mockImplementation(()=>{});const {workers}=fixture();workers.register.mockRejectedValueOnce(new Error('offline'));
 cancel=registerPwa();await vi.advanceTimersByTimeAsync(1);expect(workers.register).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(5000);expect(workers.register).toHaveBeenCalledTimes(2);
});
it('detects a published build independently and bypasses cached worker script responses',async()=>{
 const {workers}=fixture();const fetcher=vi.fn().mockResolvedValue(Response.json({buildId:published}));vi.stubGlobal('fetch',fetcher);
 cancel=registerPwa({buildId:'older'});await vi.advanceTimersByTimeAsync(1);
 expect(fetcher).toHaveBeenCalledWith(expect.stringMatching(/version\.json\?_=/),expect.objectContaining({cache:'no-store',credentials:'omit',signal:expect.any(AbortSignal)}));
 expect(workers.register).toHaveBeenCalledWith(`/RaimuNoteSNS.github.io/sw.js?build=${published}`,{scope:'/RaimuNoteSNS.github.io/',updateViaCache:'none'});
});
it('does not reinstall an identical build or treat a failed version request as an update',async()=>{
 const {workers}=fixture();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({buildId:published})));
 cancel=registerPwa({buildId:published});await vi.advanceTimersByTimeAsync(1);expect(workers.register).toHaveBeenCalledTimes(1);
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:503})));await vi.advanceTimersByTimeAsync(60000);expect(workers.register).toHaveBeenCalledTimes(1);
});
it('waits for draft persistence before a single reload and does not reload after disposal',async()=>{
 const {workers}=fixture();const reload=vi.fn();let complete!:()=>void;
 const prepareReload=vi.fn(()=>new Promise<void>(done=>{complete=done;}));cancel=registerPwa({reload,prepareReload});await vi.advanceTimersByTimeAsync(1);
 workers.dispatchEvent(new Event('controllerchange'));workers.dispatchEvent(new Event('controllerchange'));await vi.advanceTimersByTimeAsync(300);
 expect(prepareReload).toHaveBeenCalledOnce();expect(reload).not.toHaveBeenCalled();complete();await vi.advanceTimersByTimeAsync(0);expect(reload).toHaveBeenCalledOnce();
 cancel();
});
it('automatically retries reload preparation when the draft cannot yet be saved',async()=>{
 const {workers}=fixture();const reload=vi.fn(),prepareReload=vi.fn().mockRejectedValueOnce(new Error('storage busy')).mockResolvedValue(undefined);
 cancel=registerPwa({reload,prepareReload});await vi.advanceTimersByTimeAsync(1);workers.dispatchEvent(new Event('controllerchange'));await vi.advanceTimersByTimeAsync(300);expect(reload).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(2300);expect(reload).toHaveBeenCalledOnce();expect(prepareReload).toHaveBeenCalledTimes(2);
});
it('keeps a cache-busted current worker URL across launches',async()=>{
 const {workers}=fixture();workers.controller.scriptURL=`${location.origin}/RaimuNoteSNS.github.io/sw.js?build=${published}`;
 cancel=registerPwa();await vi.advanceTimersByTimeAsync(1);expect(workers.register.mock.calls[0][0]).toBe(workers.controller.scriptURL);
});
it('cancels timers, in-flight version checks and queued reloads',async()=>{
 const {registration,workers}=fixture();const reload=vi.fn();cancel=registerPwa({reload});await vi.advanceTimersByTimeAsync(1);workers.dispatchEvent(new Event('controllerchange'));cancel();await vi.advanceTimersByTimeAsync(120000);
 expect(reload).not.toHaveBeenCalled();expect(registration.update).toHaveBeenCalledTimes(1);
});
it('does not overlap an update request while the previous check is pending',async()=>{
 const {registration}=fixture();let finish!:()=>void;
 registration.update.mockReturnValueOnce(new Promise<void>(resolve=>{finish=resolve;}));
 cancel=registerPwa();await vi.advanceTimersByTimeAsync(1);await vi.advanceTimersByTimeAsync(120000);window.dispatchEvent(new Event('focus'));
 expect(registration.update).toHaveBeenCalledOnce();finish();await vi.advanceTimersByTimeAsync(0);
});
it('does not reload if disposed while draft persistence is pending',async()=>{
 const {workers}=fixture();const reload=vi.fn();let finish!:()=>void;
 cancel=registerPwa({reload,prepareReload:()=>new Promise<void>(resolve=>{finish=resolve;})});
 await vi.advanceTimersByTimeAsync(1);workers.dispatchEvent(new Event('controllerchange'));await vi.advanceTimersByTimeAsync(300);cancel();finish();await vi.advanceTimersByTimeAsync(0);
 expect(reload).not.toHaveBeenCalled();
});
