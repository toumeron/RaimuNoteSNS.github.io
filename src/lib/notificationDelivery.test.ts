import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({count:3,set:vi.fn(),clear:vi.fn(),dismiss:vi.fn(),toast:vi.fn(),message:vi.fn(),closed:vi.fn(),rpc:vi.fn(),pushOwner:'owner'}));
vi.mock('sonner',()=>({toast:Object.assign(state.toast,{dismiss:state.dismiss})}));
vi.mock("@/lib/supabase", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(),
  supabase:{auth:{getSession:async()=>({data:{session:{user:{id:state.pushOwner}}}})},rpc:(...args:unknown[])=>state.rpc(...args),from:()=>{const q={select:()=>q,eq:()=>q,then:(done:Function)=>Promise.resolve({count:state.count,error:null}).then(done as never)};return q;}}
}));
import { refreshNotificationBadge } from "@/App";
import { showNotificationToast, dismissNotificationToasts } from "@/App";
beforeEach(()=>{vi.useFakeTimers();Object.assign(state,{count:3});for(const name of ['set','clear','dismiss','toast','message','closed'] as const)state[name].mockClear();Object.defineProperty(navigator,'setAppBadge',{configurable:true,value:state.set});Object.defineProperty(navigator,'clearAppBadge',{configurable:true,value:state.clear});Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{getRegistration:async()=>({active:{postMessage:state.message},getNotifications:async()=>[{tag:'read',data:{notificationId:'read'},close:state.closed}]})}});});
afterEach(()=>{dismissNotificationToasts();vi.useRealTimers();});
it('dismisses notification popups after five seconds independently of toast hover state',async()=>{showNotificationToast('one','title','body');expect(state.dismiss).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(5000);expect(state.dismiss).toHaveBeenCalledWith('notification-one');});
it('reading closes the relevant popup without dismissing unrelated notifications',()=>{showNotificationToast('one','title','body');showNotificationToast('two','title','body');dismissNotificationToasts(['one']);expect(state.dismiss.mock.calls).toEqual([['notification-one']]);});
it('updates unread badge from the saved count and clears badge and read OS notices at zero',async()=>{await refreshNotificationBadge('owner');expect(state.set).toHaveBeenCalledWith(3);state.count=0;await refreshNotificationBadge('owner',['read']);expect(state.clear).toHaveBeenCalled();expect(state.closed).toHaveBeenCalled();expect(state.message).toHaveBeenCalledWith({type:'LIME_NOTIFICATIONS_READ',ids:['read'],count:0});});
it('does not wait indefinitely for serviceWorker.ready on an unregistered page',async()=>{Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{ready:new Promise(()=>{}),getRegistration:async()=>undefined}});await refreshNotificationBadge('owner');expect(state.set).toHaveBeenCalledWith(3);});

it('updates the in-app count even when the OS badge API never completes',async()=>{
 state.count=0;state.clear.mockImplementationOnce(()=>new Promise(()=>{}));
 const changed=vi.fn();window.addEventListener('lime-notification-count-changed',changed);
 try{await refreshNotificationBadge('owner',['read']);expect(changed).toHaveBeenCalledOnce();expect((changed.mock.calls[0][0] as CustomEvent).detail).toEqual({userId:'owner',count:0});expect(state.closed).toHaveBeenCalled();}
 finally{window.removeEventListener('lime-notification-count-changed',changed);}
});


it('refreshes saved-account counts independently without overwriting the active OS badge',async()=>{
 let release!:(value:unknown)=>void;
 const account={from:()=>{const q={select:()=>q,eq:()=>q,then:(done:Function)=>new Promise(resolve=>{release=resolve;}).then(done as never)};return q;}};
 const changed=vi.fn();window.addEventListener('lime-notification-count-changed',changed);
 try{
  const other=refreshNotificationBadge('other',['other-read'],{client:account as never,userId:'other'});
  await refreshNotificationBadge('owner');
  release({count:0,error:null});await other;
  expect(changed.mock.calls.map(call=>(call[0]as CustomEvent).detail)).toEqual([{userId:'owner',count:3},{userId:'other',count:0}]);
  expect(state.set).toHaveBeenCalledExactlyOnceWith(3);expect(state.clear).not.toHaveBeenCalled();
 }finally{window.removeEventListener('lime-notification-count-changed',changed);}
});


async function pushFixture(endpoint:string){
 vi.stubEnv('VITE_VAPID_PUBLIC_KEY','AQID');
 class Permission {static permission='granted';static requestPermission=vi.fn().mockResolvedValue('granted');}
 vi.stubGlobal('Notification',Permission);vi.stubGlobal('PushManager',class {});
 const subscription={endpoint,options:{},toJSON:()=>({keys:{p256dh:'public-key',auth:'auth-key'}})};
 const registration={update:vi.fn().mockResolvedValue(undefined),pushManager:{getSubscription:vi.fn().mockResolvedValue(subscription),subscribe:vi.fn()}};
 Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{ready:Promise.resolve(registration)}});
 state.rpc.mockReset().mockResolvedValue({error:null});state.pushOwner='owner';
 const {requestPermissionAndSubscribe}=await import('@/hooks/useOSNotification');
 return {requestPermissionAndSubscribe,subscription,registration};
}

it('saves one Push registration for concurrent lifecycle events, rechecks changes and expires its short memory',async()=>{
 try {
  const {requestPermissionAndSubscribe,subscription}=await pushFixture('https://push.example/coalesced');
  expect(await Promise.all([requestPermissionAndSubscribe('owner'),requestPermissionAndSubscribe('owner'),requestPermissionAndSubscribe('owner')])).toEqual([true,true,true]);
  expect(state.rpc).toHaveBeenCalledTimes(1);
  expect(await requestPermissionAndSubscribe('owner')).toBe(true);expect(state.rpc).toHaveBeenCalledTimes(1);
  subscription.endpoint='https://push.example/replaced';expect(await requestPermissionAndSubscribe('owner')).toBe(true);expect(state.rpc).toHaveBeenCalledTimes(2);
  vi.setSystemTime(Date.now()+15*60_000+1);expect(await requestPermissionAndSubscribe('owner')).toBe(true);expect(state.rpc).toHaveBeenCalledTimes(3);
 }finally{vi.unstubAllGlobals();vi.unstubAllEnvs();}
});
it('rebinds the browser endpoint after account switches and retries failed registrations',async()=>{
 try {
  const {requestPermissionAndSubscribe}=await pushFixture('https://push.example/accounts');
  expect(await requestPermissionAndSubscribe('owner')).toBe(true);
  state.pushOwner='other';expect(await requestPermissionAndSubscribe('owner')).toBe(false);expect(state.rpc).toHaveBeenCalledTimes(1);
  expect(await requestPermissionAndSubscribe('other')).toBe(true);expect(state.rpc).toHaveBeenCalledTimes(2);
  state.pushOwner='owner';state.rpc.mockResolvedValueOnce({error:{message:'offline'}});
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  try{expect(await requestPermissionAndSubscribe('owner')).toBe(false);expect(await requestPermissionAndSubscribe('owner')).toBe(true);expect(state.rpc).toHaveBeenCalledTimes(4);}finally{log.mockRestore();}
 }finally{vi.unstubAllGlobals();vi.unstubAllEnvs();}
});
