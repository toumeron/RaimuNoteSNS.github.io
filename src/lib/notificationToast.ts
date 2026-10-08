import {toast} from 'sonner';
const timers=new Map<string,ReturnType<typeof setTimeout>>();
export function showNotificationToast(id:string,title:string,message:string){
 const key=`notification-${id}`;const previous=timers.get(key);if(previous)clearTimeout(previous);
 toast(title,{id:key,description:message,duration:5000});
 // Sonner pauses its own timer while hovered; notification popups still expire.
 timers.set(key,setTimeout(()=>{toast.dismiss(key);timers.delete(key);},5000));
}
export function dismissNotificationToasts(ids?:string[]){
 for(const [key,timer]of timers)if(!ids||ids.some(id=>key===`notification-${id}`)){clearTimeout(timer);toast.dismiss(key);timers.delete(key);}
}
