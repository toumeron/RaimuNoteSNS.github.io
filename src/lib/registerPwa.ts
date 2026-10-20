import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import type { AccountReadContext } from "@/lib/accountReadClient";

// registerPwa
/** Check on launch/resume and reload once when an updated worker takes control. */
function registerPwa({reload=()=>window.location.reload()}:{reload?:()=>void}={}) {
  if (!('serviceWorker' in navigator)) return () => {};
  const workers=navigator.serviceWorker;
  let cancelled=false,reloading=false,hadController=!!workers.controller;
  let timer:ReturnType<typeof setTimeout>|undefined,reloadTimer:ReturnType<typeof setTimeout>|undefined,idle:number|undefined;
  let registration:ServiceWorkerRegistration|undefined,lastCheck=0,checking=false;
  const cleanupWorkers:(()=>void)[]=[];
  const queueReload=()=>{
    if(cancelled||reloading||reloadTimer!==undefined||import.meta.env.DEV)return;
    reloadTimer=setTimeout(()=>{if(cancelled)return;reloading=true;reload();},250);
  };
  const controllerChanged=()=>{
    if(hadController)queueReload();
    hadController=!!workers.controller;
  };
  const workerMessage=(event:MessageEvent)=>{
    if(event.data?.type!=='LIME_PWA_UPDATE'||typeof event.data.token!=='string')return;
    (event.source as ServiceWorker|null)?.postMessage({type:'LIME_PWA_UPDATE_ACK',token:event.data.token});
    if(hadController)queueReload();
  };
  if(!import.meta.env.DEV){workers.addEventListener('controllerchange',controllerChanged);workers.addEventListener('message',workerMessage);}
  const activateWaiting=()=>registration?.waiting?.postMessage({type:'SKIP_WAITING'});
  const check=()=>{
    if(cancelled||!registration||checking||document.visibilityState==='hidden'||Date.now()-lastCheck<60000)return;
    lastCheck=Date.now();checking=true;
    void registration.update().catch(error=>console.debug('PWA update check unavailable',error)).finally(()=>{checking=false;});
    activateWaiting();
  };
  const register=()=>{
    if(cancelled)return;
    const script=import.meta.env.DEV?'dev-sw.js?dev-sw':'sw.js';
    void workers.register(`${import.meta.env.BASE_URL}${script}`,{scope:import.meta.env.BASE_URL,updateViaCache:'none'}).then(result=>{
      if(cancelled)return;registration=result;
      const found=()=>{
        const installing=result.installing;if(!installing)return;
        const state=()=>{if(installing.state==='installed')activateWaiting();};
        installing.addEventListener('statechange',state);cleanupWorkers.push(()=>installing.removeEventListener('statechange',state));state();
      };
      result.addEventListener('updatefound',found);cleanupWorkers.push(()=>result.removeEventListener('updatefound',found));found();activateWaiting();
      if(!import.meta.env.DEV)check();
    }).catch(error=>console.warn('PWA registration failed',error));
  };
  const schedule=()=>{
    if(cancelled||timer!==undefined||idle!==undefined)return;
    if(typeof window.requestIdleCallback==='function')idle=window.requestIdleCallback(register,{timeout:5000});
    else timer=setTimeout(register,1000);
  };
  if(document.readyState==='complete')schedule();else window.addEventListener('load',schedule,{once:true});
  if(!import.meta.env.DEV){window.addEventListener('focus',check);window.addEventListener('online',check);window.addEventListener('pageshow',check);document.addEventListener('visibilitychange',check);}
  return()=>{
    cancelled=true;window.removeEventListener('load',schedule);clearTimeout(timer);clearTimeout(reloadTimer);if(idle!==undefined)window.cancelIdleCallback(idle);
    workers.removeEventListener('controllerchange',controllerChanged);workers.removeEventListener('message',workerMessage);
    window.removeEventListener('focus',check);window.removeEventListener('online',check);window.removeEventListener('pageshow',check);document.removeEventListener('visibilitychange',check);cleanupWorkers.forEach(cleanup=>cleanup());
  };
}

// notificationBadge
const latestBadgeRequests=new Map<string,number>();
let latestDeviceBadgeRequest=0;
type BadgeNavigator=Navigator&{setAppBadge?:(count:number)=>Promise<void>;clearAppBadge?:()=>Promise<void>};
async function refreshNotificationBadge(userId:string,readIds:string[]=[],context?:AccountReadContext){
 const request=(latestBadgeRequests.get(userId)??0)+1;
 latestBadgeRequests.set(userId,request);
 const deviceRequest=context?0:++latestDeviceBadgeRequest;
 const {count,error}=await (context?.client??supabase).from('notifications').select('id',{count:'exact',head:true}).eq('user_id',userId).eq('is_read',false);
 if(error||request!==latestBadgeRequests.get(userId))return;
 const unread=Math.max(0,count??0);const nav=navigator as BadgeNavigator;
 // In-app unread counts must not wait for the optional OS badge API.
 window.dispatchEvent(new CustomEvent('lime-notification-count-changed',{detail:{userId,count:unread}}));
 // A saved account must update its own in-app count without replacing the active account's OS badge.
 if(context||deviceRequest!==latestDeviceBadgeRequest)return;
 try{
  const update=unread?nav.setAppBadge?.(unread):nav.clearAppBadge?.();
  void update?.catch(()=>{});
 }catch{/* Badge APIs are optional. */}
 try{
  // ready never resolves on an unregistered page; badge refresh must not wait for it.
  const registration=await navigator.serviceWorker?.getRegistration(import.meta.env.BASE_URL);
  if(request!==latestBadgeRequests.get(userId)||deviceRequest!==latestDeviceBadgeRequest)return;
  const worker=registration?.active??navigator.serviceWorker?.controller;
  worker?.postMessage({type:unread?'LIME_SET_BADGE':'LIME_CLEAR_BADGE',count:unread});
  if(readIds.length){
   worker?.postMessage({type:'LIME_NOTIFICATIONS_READ',ids:readIds,count:unread});
   const notices=await registration?.getNotifications?.();
   notices?.filter(n=>readIds.includes(n.data?.notificationId)||readIds.includes(n.tag)).forEach(n=>n.close());
  }
 }catch{/* Keep successful read updates even when the worker is unavailable. */}
}

// notificationToast
const timers=new Map<string,ReturnType<typeof setTimeout>>();
function showNotificationToast(id:string,title:string,message:string){
 const key=`notification-${id}`;const previous=timers.get(key);if(previous)clearTimeout(previous);
 toast(title,{id:key,description:message,duration:5000});
 // Sonner pauses its own timer while hovered; notification popups still expire.
 timers.set(key,setTimeout(()=>{toast.dismiss(key);timers.delete(key);},5000));
}
function dismissNotificationToasts(ids?:string[]){
 for(const [key,timer]of timers)if(!ids||ids.some(id=>key===`notification-${id}`)){clearTimeout(timer);toast.dismiss(key);timers.delete(key);}
}

export { registerPwa };
export { refreshNotificationBadge };
export { showNotificationToast };
export { dismissNotificationToasts };
