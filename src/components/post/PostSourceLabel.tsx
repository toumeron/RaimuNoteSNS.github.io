import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Globe } from "lucide-react";
import "@/components/post/post-actions.css";

// PostSourceLabel
const PostSourceLabelVisibility=createContext(true);
function PostSourceLabel({post,small=false}:{post:{id:string;source?:string};small?:boolean}){
 const visible=useContext(PostSourceLabelVisibility);
 if(!visible)return null;
 const label=post.source==='x'||post.id.startsWith('x:')?'twitter':post.source==='misskey'||post.id.startsWith('misskey:')?'Misskey':post.source==='bluesky'||post.id.startsWith('bsky:')?'Bluesky':null;
 if(!label)return null;
 return <div data-lime-post-provider className="mt-1.5 flex items-center gap-1 text-muted-foreground/70"><Globe className="h-3.5 w-3.5"/><span className={small?'text-[13px] font-medium':'text-[15px] font-medium'}>{label}</span></div>;
}

// AnimatedCount
// Match LikeButton's 300ms vertical count transition in both directions.
function AnimatedCount({count}:{count:number}) {
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

export { PostSourceLabel };
export { PostSourceLabelVisibility };
export { AnimatedCount };
