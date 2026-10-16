import { observePostElements } from "@/lib/observePostElements";
import { useEffect } from "react";

// trendViews
// Keep actual views across refreshes, independently for each local account.
const memory=new Map<string,Set<string>>();
const serialized=new Map<string,string|null>();
const key=(viewerId:string|null)=>`lime_trend_views:${viewerId??'guest'}`;
function readTrendViews(viewerId:string|null):Set<string>{
 const scope=key(viewerId),views=new Set(memory.get(scope));
 try{
  const raw=localStorage.getItem(scope);
  if(!serialized.has(scope)||serialized.get(scope)!==raw){
   const stored:unknown=JSON.parse(raw??'[]');
   if(Array.isArray(stored))for(const id of stored)if(typeof id==='string')views.add(id);
   serialized.set(scope,raw);
  }
 }catch{/* Keep browsing if storage is unavailable. */}
 memory.set(scope,views);return new Set(views);
}
function recordTrendView(id:string,viewerId:string|null):void{
 recordTrendDeliveries([id],viewerId);
}
/** Suppress already delivered cards even after a fast scroll or a refresh. */
function recordTrendDeliveries(ids:Iterable<string>,viewerId:string|null):void{
 const views=readTrendViews(viewerId),before=views.size;for(const id of ids)views.add(id);
 if(views.size===before)return;
 memory.set(key(viewerId),views);
 try{const raw=JSON.stringify([...views]);localStorage.setItem(key(viewerId),raw);serialized.set(key(viewerId),raw);}catch{/* Retain session history if storage is full. */}
}

// useTrendViews
/** Count actual visible impressions, not virtualized rows or quick scrolls. */
function useTrendViews(enabled:boolean,viewerId:string|null) {
  useEffect(()=>{
    if(!enabled || typeof IntersectionObserver==='undefined') return;
    const observed=new Map<Element,string|null>();
    const recorded=new Set<string>();
    const timers=new Map<Element,ReturnType<typeof setTimeout>>();
    const clear=(element:Element)=>{const timer=timers.get(element);if(timer) clearTimeout(timer);timers.delete(element);};
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries) {
        const id=entry.target.getAttribute('data-lime-trend-post');
        const visible=entry.isIntersecting && entry.intersectionRect.height>=Math.min(240,entry.boundingClientRect.height*.4);
        if(!visible || document.hidden) {clear(entry.target);continue;}
        if(!id || recorded.has(id) || timers.has(entry.target)) continue;
        timers.set(entry.target,setTimeout(()=>{
          timers.delete(entry.target);
          if(document.hidden || !entry.target.isConnected || entry.target.getAttribute('data-lime-trend-post')!==id) return;
          recorded.add(id);recordTrendView(id,viewerId);
        },1500));
      }
    },{threshold:[0,.05,.1,.15,.2,.4,.6,.8,1]});
    const stopTracking=observePostElements('data-lime-trend-post',element=>{
      const id=element.getAttribute('data-lime-trend-post');
      if(observed.has(element)&&observed.get(element)===id)return;
      clear(element);observer.unobserve(element);observed.set(element,id);observer.observe(element);
    },element=>{observer.unobserve(element);observed.delete(element);clear(element);});
    const visibility=()=>{
      if(document.hidden) for(const element of timers.keys()) clear(element);
      else {observer.disconnect();document.querySelectorAll('[data-lime-trend-post]').forEach(element=>observer.observe(element));}
    };
    document.addEventListener('visibilitychange',visibility);
    return ()=>{
      observer.disconnect();stopTracking();
      document.removeEventListener('visibilitychange',visibility);
      for(const element of timers.keys()) clear(element);
    };
  },[enabled,viewerId]);
}

export { useTrendViews };
export { readTrendViews };
export { recordTrendView };
export { recordTrendDeliveries };
