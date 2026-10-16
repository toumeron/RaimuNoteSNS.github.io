import { useCallback, useSyncExternalStore, useEffect, useRef, useState, useLayoutEffect, type RefObject } from "react";
import { noBrowserSubscription, sharedBrowserStore } from "@/lib/observePostElements";

// useViewportWidth
// Cards share a single native breakpoint listener instead of one resize/rAF
// listener per card. The first render still uses the actual viewport width.
const stores=new Map<number,{listeners:Set<()=>void>;query:MediaQueryList;change:()=>void}>();
function subscribe(width:number,listener:()=>void){
 let store=stores.get(width);
 if(!store){
  const listeners=new Set<()=>void>(),query=window.matchMedia(`(max-width: ${width-1}px)`);
  const change=()=>listeners.forEach(notify=>notify());
  store={listeners,query,change};stores.set(width,store);query.addEventListener('change',change);
 }
 store.listeners.add(listener);
 return()=>{store!.listeners.delete(listener);if(!store!.listeners.size){store!.query.removeEventListener('change',store!.change);stores.delete(width);}};
}
function useViewportWidth(width:number){
 const listen=useCallback((listener:()=>void)=>subscribe(width,listener),[width]);
 const snapshot=useCallback(()=>typeof window!=='undefined'&&window.innerWidth<width,[width]);
 return useSyncExternalStore(listen,snapshot,()=>false);
}

// useScrollDirection
/** Keep the sampling position outside React: only a visibility change renders. */
function useScrollDirection(){
 const [visible,setVisible]=useState(true);
 const lastY=useRef(0),shown=useRef(true);
 useEffect(()=>{
  const scroll=()=>{
   const y=window.scrollY;
   if(Math.abs(y-lastY.current)<100)return;
   const next=y<lastY.current||y<=100;
   lastY.current=y;
   if(next!==shown.current){shown.current=next;setVisible(next);}
  };
  window.addEventListener('scroll',scroll,{passive:true});
  return()=>window.removeEventListener('scroll',scroll);
 },[]);
 return visible;
}

// useTimelinePortalTheme
type Theme='light'|'dark';
const normalize=(value:unknown):Theme=>value==='light'?'light':'dark';
const read=():Theme=>{try{return normalize(localStorage.getItem('lime_timeline_visual_theme'));}catch{return 'dark';}};
const store=sharedBrowserStore(read,update=>{
 const changed=(event:Event)=>update(normalize((event as CustomEvent<{theme?:string}>).detail?.theme));
 const storage=(event:StorageEvent)=>{if(event.key==='lime_timeline_visual_theme'||event.key===null)update(read());};
 window.addEventListener('timeline-visual-theme-changed',changed);
 window.addEventListener('storage',storage);
 const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('timeline-visual-theme');
 if(channel)channel.onmessage=event=>update(normalize(event.data?.theme));
 return()=>{window.removeEventListener('timeline-visual-theme-changed',changed);window.removeEventListener('storage',storage);channel?.close();};
});
const dark=():Theme=>'dark';
function useTimelinePortalTheme(enabled:boolean){
 return useSyncExternalStore(enabled?store.subscribe:noBrowserSubscription,enabled?store.getSnapshot:dark,dark);
}

// useAutoTextarea
/** Fit actual wrapped lines instead of reserving empty rows above attachments. */
function useAutoTextarea(ref:RefObject<HTMLTextAreaElement>,value:string,maxHeight=320){
 const resize=useCallback(()=>{
  const input=ref.current;if(!input)return;
  input.style.height='0px';
  const needed=input.scrollHeight;
  input.style.height=`${Math.min(maxHeight,needed)}px`;
  input.style.overflowY=needed>maxHeight?'auto':'hidden';
 },[ref,maxHeight]);
 useLayoutEffect(()=>{
  resize();window.addEventListener('resize',resize);
  const input=ref.current;let width=input?.clientWidth;
  const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(()=>{
   if(input&&input.clientWidth!==width){width=input.clientWidth;resize();}
  });
  if(input)observer?.observe(input);
  return()=>{window.removeEventListener('resize',resize);observer?.disconnect();};
 },[value,resize]);
 return resize;
}

// useMinuteTick
let tick=0,timer:ReturnType<typeof setInterval>|undefined;
const listeners=new Set<()=>void>();
const notify=()=>{tick++;listeners.forEach(listener=>listener());};
const stopTimer=()=>{if(timer!==undefined){clearInterval(timer);timer=undefined;}};
const startTimer=()=>{if(timer===undefined&&!document.hidden)timer=setInterval(notify,60000);};
const visibility=()=>{if(document.hidden)stopTimer();else{notify();startTimer();}};
const useMinuteTickSubscribe=(listener:()=>void)=>{
 listeners.add(listener);
 if(listeners.size===1){document.addEventListener('visibilitychange',visibility);startTimer();}
 return()=>{listeners.delete(listener);if(!listeners.size){stopTimer();document.removeEventListener('visibilitychange',visibility);}};
};
const snapshot=()=>tick;
/** Relative times share a clock; a background PWA does no minute rendering. */
function useMinuteTick(enabled=true){useSyncExternalStore(enabled?useMinuteTickSubscribe:noBrowserSubscription,snapshot,()=>0);}

export { useViewportWidth };
export { useScrollDirection };
export { useTimelinePortalTheme };
export { useAutoTextarea };
export { useMinuteTick };
