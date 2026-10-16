import {useSyncExternalStore} from 'react';
const key='lime-video-muted';
const event='lime:video-sound-change';
let fallback=true;
export function readVideoMuted():boolean{
 try{const value=localStorage.getItem(key);return value===null?true:value!=='false';}catch{return fallback;}
}
export function setVideoMuted(muted:boolean):void{
 fallback=muted;
 try{localStorage.setItem(key,String(muted));}catch{/* Retain the choice in this session if storage is disabled. */}
 if(typeof window!=='undefined')window.dispatchEvent(new Event(event));
}
function subscribe(change:()=>void){
 const storage=(e:StorageEvent)=>{if(e.key===key||e.key===null)change();};
 window.addEventListener(event,change);window.addEventListener('storage',storage);
 return()=>{window.removeEventListener(event,change);window.removeEventListener('storage',storage);};
}
export function useVideoMutedPreference(){
 return [useSyncExternalStore(subscribe,readVideoMuted,()=>true),setVideoMuted] as const;
}
