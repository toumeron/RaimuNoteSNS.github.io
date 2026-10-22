import * as React from "react";
import { useCallback, useSyncExternalStore, useEffect, useRef, useState, useLayoutEffect, type RefObject } from "react";
import { useInView } from "react-intersection-observer";

// observePostElements
/** Track only changed subtrees, rather than rescanning the entire document
 * whenever a counter, icon, spinner or video control updates. */
function observePostElements(attribute:string,onAdd:(element:Element)=>void,onRemove:(element:Element)=>void){
 const selector=`[${attribute}]`,tracked=new Set<Element>();
 const collect=(node:Node,visit:(element:Element)=>void)=>{
  if(!(node instanceof Element))return;
  if(node.matches(selector))visit(node);
  node.querySelectorAll(selector).forEach(visit);
 };
 const add=(element:Element)=>{tracked.add(element);onAdd(element);};
 const remove=(element:Element)=>{if(tracked.delete(element))onRemove(element);};
 document.querySelectorAll(selector).forEach(add);
 const observer=new MutationObserver(records=>{
  for(const record of records){
   if(record.type==='attributes'){
    const element=record.target as Element;
    if(element.matches(selector))add(element);else remove(element);
   }else{
    record.removedNodes.forEach(node=>collect(node,element=>{if(!element.isConnected)remove(element);}));
    record.addedNodes.forEach(node=>collect(node,element=>{if(!tracked.has(element))add(element);}));
   }
  }
 });
 observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:[attribute]});
 return()=>{observer.disconnect();tracked.forEach(onRemove);tracked.clear();};
}

// observeDocumentHeight
/** Measure document growth, not every scroll event (which can force layout). */
function observeDocumentHeight(onHeight:(height:number)=>void){
 let frame=0;
 const measure=()=>{frame=0;onHeight(document.documentElement.scrollHeight);};
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
 const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(schedule);
 observer?.observe(document.documentElement);
 if(document.body)observer?.observe(document.body);
 window.addEventListener('resize',schedule,{passive:true});
 measure();
 return()=>{observer?.disconnect();window.removeEventListener('resize',schedule);if(frame)cancelAnimationFrame(frame);};
}

// sharedBrowserStore
/** One native subscription and one snapshot for all mounted consumers. */
function sharedBrowserStore<T>(read:()=>T,listen:(update:(value:T)=>void)=>()=>void,equal:(a:T,b:T)=>boolean=Object.is){
 let initialized=false,snapshot:T,stop:(()=>void)|undefined;
 const listeners=new Set<()=>void>();
 const getSnapshot=()=>{if(!initialized){snapshot=read();initialized=true;}return snapshot;};
 const update=(value:T)=>{if(initialized&&equal(snapshot,value))return;snapshot=value;initialized=true;listeners.forEach(notify=>notify());};
 const subscribe=(notify:()=>void)=>{
  listeners.add(notify);
  if(!stop){stop=listen(update);update(read());}
  return()=>{listeners.delete(notify);if(!listeners.size){stop?.();stop=undefined;initialized=false;}};
 };
 return {getSnapshot,subscribe};
}
const noBrowserSubscription=()=>()=>{};

type VisibilityListener=(visible:boolean)=>void;
const elementVisibilityPools=new Map<string,{observer:IntersectionObserver;listeners:Map<Element,Set<VisibilityListener>>;visible:Map<Element,boolean>}>();
/** Share viewport observations across cards and thumbnails, releasing empty pools. */
export function observeElementVisibility(element:Element,listener:VisibilityListener,rootMargin='0px'){
 if(typeof IntersectionObserver==='undefined'){
  let cancelled=false;queueMicrotask(()=>{if(!cancelled)listener(true);});return()=>{cancelled=true;};
 }
 let pool=elementVisibilityPools.get(rootMargin);
 if(!pool){
  const listeners=new Map<Element,Set<VisibilityListener>>(),visible=new Map<Element,boolean>();
  const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(!listeners.has(entry.target))continue;visible.set(entry.target,entry.isIntersecting);listeners.get(entry.target)?.forEach(notify=>notify(entry.isIntersecting));}},{rootMargin});
  pool={observer,listeners,visible};elementVisibilityPools.set(rootMargin,pool);
 }
 const current=pool;
 let listeners=current.listeners.get(element);
 if(!listeners){listeners=new Set();current.listeners.set(element,listeners);current.observer.observe(element);}
 listeners.add(listener);
 if(current.visible.has(element))queueMicrotask(()=>{if(listeners!.has(listener))listener(current.visible.get(element)!);});
 let stopped=false;
 return()=>{
  if(stopped)return;stopped=true;
  listeners!.delete(listener);
  if(!listeners!.size&&current.listeners.has(element)){current.observer.unobserve(element);current.listeners.delete(element);current.visible.delete(element);}
  if(!current.listeners.size){current.observer.disconnect();if(elementVisibilityPools.get(rootMargin)===current)elementVisibilityPools.delete(rootMargin);}
 };
}

const pageVisibility = sharedBrowserStore(() => !document.hidden, update => {
 const changed = () => update(!document.hidden);
 document.addEventListener('visibilitychange', changed);
 return () => document.removeEventListener('visibilitychange', changed);
});
/** One native listener for all cards; background tabs do no per-card reads. */
export function usePageVisible() {
 return useSyncExternalStore(pageVisibility.subscribe, pageVisibility.getSnapshot, () => true);
}

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

// use-mobile
const MOBILE_BREAKPOINT = 768;
const TIMELINE_PAGINATION_MARGIN = '300px 0px 500px 0px';

function useIsMobile() {
  return useViewportWidth(MOBILE_BREAKPOINT);
}

const installedPwa=sharedBrowserStore(
 ()=>typeof window!=='undefined'&&(window.matchMedia('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone===true),
 update=>{
  const query=window.matchMedia('(display-mode: standalone)');
  const changed=()=>update(query.matches||(navigator as Navigator&{standalone?:boolean}).standalone===true);
  query.addEventListener('change',changed);window.addEventListener('pageshow',changed);
  return()=>{query.removeEventListener('change',changed);window.removeEventListener('pageshow',changed);};
 });
function useIsPWA() {
 return useSyncExternalStore(installedPwa.subscribe,installedPwa.getSnapshot,()=>false);
}

/** The same viewport-driven pagination used by the home timeline. */
function useAutoPagination(query: {hasNextPage?: boolean; isFetching: boolean; isError: boolean; isFetchNextPageError?: boolean; fetchNextPage: (options?: {cancelRefetch?: boolean}) => Promise<unknown>}, enabled = true) {
  const {ref, inView} = useInView({rootMargin: TIMELINE_PAGINATION_MARGIN, fallbackInView: false});
  React.useEffect(() => {
    if (enabled && inView && query.hasNextPage && !query.isFetching && !query.isError && !query.isFetchNextPageError) void query.fetchNextPage({cancelRefetch: false});
  }, [enabled, inView, query.hasNextPage, query.isFetching, query.isError, query.isFetchNextPageError, query.fetchNextPage]);
  return ref;
}

export { useViewportWidth };
export { useScrollDirection };
export { useTimelinePortalTheme };
export { useAutoTextarea };
export { useMinuteTick };
export { useIsMobile };
export { useIsPWA };
export { useAutoPagination };
export { TIMELINE_PAGINATION_MARGIN };
export { observePostElements };
export { observeDocumentHeight };
export { sharedBrowserStore };
export { noBrowserSubscription };
