import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './animated-count.css';

// Match LikeButton's 300ms vertical count transition in both directions.
export function AnimatedCount({count}:{count:number}) {
  const value=Math.max(0,Number(count)||0);
  const previous=useRef(value);
  const [transition,setTransition]=useState<{old:number;value:number;version:number}|null>(null);
  useLayoutEffect(()=>{
    if(previous.current===value) return;
    const old=previous.current;
    previous.current=value;
    setTransition(current=>({old,value,version:(current?.version ?? 0)+1}));
  },[value]);
  useEffect(()=>{
    if(!transition) return;
    const timer=window.setTimeout(()=>setTransition(null),320);
    return ()=>window.clearTimeout(timer);
  },[transition]);
  const format=(n:number)=> n===0 ? '' : n>=10000 ? `${(n/10000).toFixed(1).replace(/\.0$/,'')}万` : n.toLocaleString();
  return <span aria-label={format(value)} className={`repost-count ${transition ? transition.value>transition.old ? 'is-up' : 'is-down' : ''}`}>
    {transition ? <span key={transition.version} className="repost-count-layers" aria-hidden="true"><span className="repost-count-old">{format(transition.old)}</span><span className="repost-count-new">{format(transition.value)}</span></span> : <span>{format(value)}</span>}
  </span>;
}
