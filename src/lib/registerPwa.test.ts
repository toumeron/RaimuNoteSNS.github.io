import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {registerPwa} from './registerPwa';
describe('PWA startup and automatic updates',()=>{
 beforeEach(()=>{vi.stubEnv('DEV',false);vi.useFakeTimers();vi.spyOn(document,'readyState','get').mockReturnValue('complete');vi.stubGlobal('requestIdleCallback',undefined);vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');});
 afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
 function fixture(controlled=true){
  const sw=Object.assign(new EventTarget(),{controller:controlled?{}:null,register:vi.fn()});
  const registration=Object.assign(new EventTarget(),{installing:null,waiting:null,update:vi.fn().mockResolvedValue(undefined)});
  sw.register.mockResolvedValue(registration);vi.stubGlobal('navigator',{serviceWorker:sw});return {sw,registration};
 }
 async function start(){await vi.advanceTimersByTimeAsync(1000);}
 it('checks on launch and resume, throttles duplicate resume events and reloads once',async()=>{
  const {sw,registration}=fixture();const reload=vi.fn();const cancel=registerPwa({reload});await start();expect(registration.update).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event('focus'));expect(registration.update).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(60000);window.dispatchEvent(new Event('focus'));await Promise.resolve();expect(registration.update).toHaveBeenCalledTimes(2);
  sw.dispatchEvent(new Event('controllerchange'));sw.dispatchEvent(new Event('controllerchange'));await vi.advanceTimersByTimeAsync(300);expect(reload).toHaveBeenCalledTimes(1);cancel();
 });
 it('does not reload when the first installed worker claims a new page',async()=>{
  const {sw}=fixture(false);const reload=vi.fn();const cancel=registerPwa({reload});await start();sw.controller={};sw.dispatchEvent(new Event('controllerchange'));await vi.advanceTimersByTimeAsync(300);expect(reload).not.toHaveBeenCalled();cancel();
 });
 it('acknowledges update messages so the worker will not navigate the page twice',async()=>{
  const {sw}=fixture();const reload=vi.fn(),postMessage=vi.fn();const cancel=registerPwa({reload});await start();sw.dispatchEvent(new MessageEvent('message',{data:{type:'LIME_PWA_UPDATE',token:'new'},source:{postMessage} as any}));await vi.advanceTimersByTimeAsync(300);expect(postMessage).toHaveBeenCalledWith({type:'LIME_PWA_UPDATE_ACK',token:'new'});expect(reload).toHaveBeenCalledTimes(1);cancel();
 });
 it('activates an update which is waiting and removes listeners on cancellation',async()=>{
  const {sw,registration}=fixture();const postMessage=vi.fn();registration.waiting={postMessage} as any;const reload=vi.fn();const cancel=registerPwa({reload});await start();expect(postMessage).toHaveBeenCalledWith({type:'SKIP_WAITING'});cancel();sw.dispatchEvent(new Event('controllerchange'));await vi.advanceTimersByTimeAsync(300);expect(reload).not.toHaveBeenCalled();
 });
 it('waits for page load and idle time before registering',()=>{
  const {sw}=fixture();vi.spyOn(document,'readyState','get').mockReturnValue('loading');let cb:IdleRequestCallback;vi.stubGlobal('requestIdleCallback',vi.fn(callback=>{cb=callback;return 1;}));vi.stubGlobal('cancelIdleCallback',vi.fn());const cancel=registerPwa();window.dispatchEvent(new Event('load'));expect(sw.register).not.toHaveBeenCalled();cb!({didTimeout:false,timeRemaining:()=>50});expect(sw.register).toHaveBeenCalledWith('/RaimuNoteSNS.github.io/sw.js',{scope:'/RaimuNoteSNS.github.io/',updateViaCache:'none'});cancel();
 });
 it('uses the development worker without production reload listeners',async()=>{
  vi.stubEnv('DEV',true);const {sw}=fixture();const reload=vi.fn();const cancel=registerPwa({reload});await start();expect(sw.register).toHaveBeenCalledWith('/RaimuNoteSNS.github.io/dev-sw.js?dev-sw',expect.anything());sw.dispatchEvent(new Event('controllerchange'));await vi.advanceTimersByTimeAsync(300);expect(reload).not.toHaveBeenCalled();cancel();
 });
 it('cancels pending registration',async()=>{const {sw}=fixture();const cancel=registerPwa();cancel();await start();expect(sw.register).not.toHaveBeenCalled();});
});
