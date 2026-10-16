import {observePostElements} from '@/lib/observePostElements';
import { recordLearnedRecommendation } from "@/api/topics";
import { useEffect } from 'react';
import { recordRecommendationImpression } from '@/lib/recommendations';

/** Count actual visible impressions, not virtualized rows or quick scrolls. */
export function useRecommendationImpressions(enabled:boolean,viewerId:string|null) {
  useEffect(()=>{
    if(!enabled || typeof IntersectionObserver==='undefined') return;
    const observed=new Map<Element,string|null>();
    const recorded=new Set<string>();
    const timers=new Map<Element,ReturnType<typeof setTimeout>>();
    const clear=(element:Element)=>{const timer=timers.get(element);if(timer) clearTimeout(timer);timers.delete(element);};
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries) {
        const id=entry.target.getAttribute('data-lime-recommendation-post');
        const visible=entry.isIntersecting && entry.intersectionRect.height>=Math.min(240,entry.boundingClientRect.height*.4);
        if(!visible || document.hidden) {clear(entry.target);continue;}
        if(!id || recorded.has(id) || timers.has(entry.target)) continue;
        timers.set(entry.target,setTimeout(()=>{
          timers.delete(entry.target);
          if(document.hidden || !entry.target.isConnected || entry.target.getAttribute('data-lime-recommendation-post')!==id) return;
          recordLearnedRecommendation(id,viewerId,0);
          recorded.add(id);recordRecommendationImpression(id,viewerId,Date.now(),entry.target.getAttribute('data-lime-recommendation-fingerprint')??undefined);
        },1500));
      }
    },{threshold:[0,.05,.1,.15,.2,.4,.6,.8,1]});
    const stopTracking=observePostElements('data-lime-recommendation-post',element=>{
      const id=element.getAttribute('data-lime-recommendation-post');
      if(observed.has(element)&&observed.get(element)===id)return;
      clear(element);observer.unobserve(element);observed.set(element,id);observer.observe(element);
    },element=>{observer.unobserve(element);observed.delete(element);clear(element);});
    const visibility=()=>{
      if(document.hidden) for(const element of timers.keys()) clear(element);
      else {observer.disconnect();document.querySelectorAll('[data-lime-recommendation-post]').forEach(element=>observer.observe(element));}
    };
    document.addEventListener('visibilitychange',visibility);
    return ()=>{
      observer.disconnect();stopTracking();
      document.removeEventListener('visibilitychange',visibility);
      for(const element of timers.keys()) clear(element);
    };
  },[enabled,viewerId]);
}
