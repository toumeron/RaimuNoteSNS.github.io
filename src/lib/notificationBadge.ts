import {supabase} from '@/lib/supabase';
let latest=0;
type BadgeNavigator=Navigator&{setAppBadge?:(count:number)=>Promise<void>;clearAppBadge?:()=>Promise<void>};
export async function refreshNotificationBadge(userId:string,readIds:string[]=[]){
 const request=++latest;
 const {count,error}=await supabase.from('notifications').select('id',{count:'exact',head:true}).eq('user_id',userId).eq('is_read',false);
 if(error||request!==latest)return;
 const unread=Math.max(0,count??0);const nav=navigator as BadgeNavigator;
 try{if(unread&&nav.setAppBadge)await nav.setAppBadge(unread);else if(!unread&&nav.clearAppBadge)await nav.clearAppBadge();}catch{/* Badge APIs are optional. */}
 if(request!==latest)return;
 window.dispatchEvent(new CustomEvent('lime-notification-count-changed',{detail:{userId,count:unread}}));
 try{
  // ready never resolves on an unregistered page; badge refresh must not wait for it.
  const registration=await navigator.serviceWorker?.getRegistration(import.meta.env.BASE_URL);
  if(request!==latest)return;
  const worker=registration?.active??navigator.serviceWorker?.controller;
  worker?.postMessage({type:unread?'LIME_SET_BADGE':'LIME_CLEAR_BADGE',count:unread});
  if(readIds.length){
   worker?.postMessage({type:'LIME_NOTIFICATIONS_READ',ids:readIds,count:unread});
   const notices=await registration?.getNotifications?.();
   notices?.filter(n=>readIds.includes(n.data?.notificationId)||readIds.includes(n.tag)).forEach(n=>n.close());
  }
 }catch{/* Keep successful read updates even when the worker is unavailable. */}
}
