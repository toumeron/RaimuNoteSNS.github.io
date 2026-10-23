import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Loader2 } from 'lucide-react';
import { isPagePullBlocked } from '@/lib/pagePullGesture';

const THRESHOLD=58;
/** Accept pulls across the timeline except its tabs; expand only the feed content. */
export function FeedPullRefreshRegion({enabled,onRefresh,children}:{enabled:boolean;onRefresh:()=>Promise<void>;children:ReactNode}) {
  const region=useRef<HTMLDivElement>(null);
  const refresh=useRef(onRefresh);refresh.current=onRefresh;
  const drag=useRef({active:false,x:0,y:0,distance:0,busy:false});
  const [distance,setDistance]=useState(0);
  const [refreshing,setRefreshing]=useState(false);
  const mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    const element=region.current;if(!enabled||!element)return;
    const html=document.documentElement,body=document.body;
    const previousHtml=html.style.overscrollBehaviorY,previousBody=body.style.overscrollBehaviorY;
    html.style.overscrollBehaviorY='contain';body.style.overscrollBehaviorY='contain';
    const clear=()=>{drag.current.active=false;drag.current.distance=0;if(mounted.current&&!drag.current.busy)setDistance(0);};
    const atTop=()=>Math.max(window.scrollY,html.scrollTop,body.scrollTop)<=2;
    const start=(event:TouchEvent)=>{
      clear();
      const target=event.target instanceof Element?event.target:null;
      if(drag.current.busy||event.touches.length!==1||!atTop()||isPagePullBlocked()||target?.closest('[role="tablist"], [role="tab"], [data-lime-timeline-tabs], [data-lime-feed-tab-row], [data-lime-desktop-feed-tabs]'))return;
      const point=event.touches[0];Object.assign(drag.current,{active:true,x:point.clientX,y:point.clientY});
    };
    const move=(event:TouchEvent)=>{
      if(!drag.current.active)return;
      if(event.touches.length!==1||!atTop()||isPagePullBlocked()){clear();return;}
      const point=event.touches[0],dy=point.clientY-drag.current.y,dx=point.clientX-drag.current.x;
      if(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>8){clear();return;}
      if(dy<=0){drag.current.distance=0;setDistance(0);return;}
      if(event.cancelable)event.preventDefault();
      const next=Math.min(dy*.6,320);drag.current.distance=next;setDistance(next);
    };
    const end=()=>{
      if(!drag.current.active)return;
      if(isPagePullBlocked()||drag.current.distance<THRESHOLD){clear();return;}
      drag.current.active=false;drag.current.busy=true;setRefreshing(true);setDistance(56);
      void Promise.resolve().then(()=>refresh.current()).catch(error=>console.debug('Feed refresh unavailable',error)).finally(()=>{
        drag.current.busy=false;drag.current.distance=0;if(mounted.current){setRefreshing(false);setDistance(0);}
      });
    };
    window.addEventListener('touchstart',start,{passive:true});window.addEventListener('touchmove',move,{passive:false});window.addEventListener('touchend',end);window.addEventListener('touchcancel',clear);
    return()=>{
      clear();html.style.overscrollBehaviorY=previousHtml;body.style.overscrollBehaviorY=previousBody;
      window.removeEventListener('touchstart',start);window.removeEventListener('touchmove',move);window.removeEventListener('touchend',end);window.removeEventListener('touchcancel',clear);
    };
  },[enabled]);
  return <div ref={region} data-lime-feed-pull-region>
    {enabled&&<div data-lime-feed-pull-indicator className="pointer-events-none flex items-end justify-center overflow-hidden text-muted-foreground" style={{height:distance,transition:drag.current.active?'none':'height 180ms ease-out'}}>
      {distance>0&&<span role="status" aria-label={refreshing?'更新中':distance>=THRESHOLD?'離して更新':'引っ張って更新'} className="flex h-14 w-full items-center justify-center">
        {refreshing?<Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-primary"/>:distance>=THRESHOLD?<ArrowUp aria-hidden="true" className="h-6 w-6"/>:<ArrowDown aria-hidden="true" className="h-6 w-6"/>}
      </span>}
    </div>}
    <div className="space-y-5">{children}</div>
  </div>;
}
