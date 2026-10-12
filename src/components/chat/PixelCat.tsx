import {useEffect,useState,type RefObject,type CSSProperties} from 'react';
import './pixel-cat.css';
export const LIME_AI_CAT_ICON=`${import.meta.env.BASE_URL}limeai-cat.png`;
export type CatMotion='sit'|'walk'|'pounce';
const head=['...#.....#...','...##...##...','...#######...','..#########..','..##.###.##..','..####.####..','..#########..','...#######...','.....#####...'];
function pixels(rows:string[]){return rows.flatMap((row,y)=>[...row].flatMap((cell,x)=>cell==='#'?[<rect key={`${x}:${y}`} x={x} y={y} width="1" height="1"/>]:[]));}
function useSpriteClock(once:boolean){
 const [frame,setFrame]=useState(0);
 useEffect(()=>{
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');let animation=0,start=performance.now(),last=-1;
  const tick=(now:number)=>{if(reduced.matches||document.hidden)return;const next=once?Math.min(119,Math.floor((now-start)/100)):Math.floor((now-start)/100)%120;if(next!==last){last=next;setFrame(next);}if(!once||next<119)animation=requestAnimationFrame(tick);};
  const restart=()=>{cancelAnimationFrame(animation);if(reduced.matches){setFrame(0);return;}if(!document.hidden){start=performance.now();last=-1;animation=requestAnimationFrame(tick);}};
  restart();reduced.addEventListener('change',restart);document.addEventListener('visibilitychange',restart);
  return()=>{cancelAnimationFrame(animation);reduced.removeEventListener('change',restart);document.removeEventListener('visibilitychange',restart);};
 },[once]);return frame;
}
/** Twelve-second choreography with articulated pixel poses, rather than a bobbing image. */
export function PixelCat({motion='walk',perched=false}:{motion?:CatMotion;perched?:boolean}){
 const frame=useSpriteClock(perched),time=frame/10;
 const action=time<2.4?'walk':time<3?'settle':time<5.8?'groom':time<6.6?'look':time<8.2?'stretch':time<9.6?(motion==='sit'?'groom':'jump'):'walk';
 const returnTrip=time>=9.6,direction=returnTrip?-1:1;
 const stride=frame%6,leg=[0,1,1,0,-1,-1][stride];
 let x=time<2.4?2+Math.floor(time*5):time>=9.6?14-Math.floor((time-9.6)*5):14;
 if(perched&&time>11.2)x=14+Math.floor((time-11.2)*22);
 const jump=action==='jump'?-Math.round(Math.sin((time-8.2)/1.4*Math.PI)*4):0;
 const lowered=action==='settle'||action==='groom'?1:0,stretch=action==='stretch';
 const blink=frame%43>=40,tail=[0,1,2,1,0,-1][Math.floor(frame/3)%6];
 const faceShift=action==='look'?1:0;
 return <span className="pixel-cat" aria-hidden="true" data-pixel-cat={motion} data-cat-action={action} data-cat-frame={frame}><svg viewBox="0 0 40 20" shapeRendering="crispEdges" focusable="false"><g transform={`translate(${x+(direction<0?22:0)} ${3+jump}) scale(${direction} 1)`}>
  <g transform={`translate(0 ${action==='walk'&&stride%3===1?-1:0})`}>
   <path d={stretch?'M7 8h9v4H5v-1H3V9h4Z':'M9 8h3V6h3v1h1v5H5v-2H4V9h5Z'}/>
   <g transform={`translate(${faceShift+(stretch?-1:0)} ${lowered+(stretch?2:0)})`}>{pixels(head)}{blink&&<><rect x="4" y="4" width="1" height="1"/><rect x="8" y="4" width="1" height="1"/></>}</g>
   <g transform={`translate(${Math.round(tail/2)} ${stretch?2:0})`}><path d="M16 9h1V4h-1V2h1V1h2v1h1v2h-1V3h-1v7h-2Z"/></g>
  </g>
  {action==='groom'?<><rect x="5" y="11" width="2" height="2"/><rect x="8" y={7+Math.floor(frame/3)%3} width="2" height="2"/><rect x="12" y="12" width="3" height="1"/></>:<>{[4,7,11,14].map((foot,i)=><rect key={foot} x={foot+(action==='walk'?(i%2?leg:-leg):stretch&&i<2?-2:0)} y={action==='jump'?11:12+(action==='walk'&&i%2===stride%2?-1:0)} width="2" height={action==='jump'?1:2}/>)}</>}
 </g></svg></span>;
}
export function TypingPixelCat(){return <span className="pixel-cat-typing"><PixelCat/></span>;}
export function MessagePixelCat({motion,offset}:{motion:CatMotion;offset?:{left:number;top:number}}){return <span className="pixel-cat-perch" style={offset as CSSProperties}><PixelCat motion={motion} perched/></span>;}
export type CatVisit={id:string;motion:CatMotion;offset:{left:number;top:number}};
/** One timer per conversation; choose only visible bubbles with clear space. */
export function useMessagePixelCat(root:RefObject<HTMLElement>,scope:string,enabled:boolean){
 const [visit,setVisit]=useState<CatVisit|null>(null);
 useEffect(()=>{
  setVisit(null);if(!enabled)return;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  let timer:ReturnType<typeof setTimeout>|undefined,departure:ReturnType<typeof setTimeout>|undefined;
  const schedule=(first=false)=>{timer=setTimeout(appear,first?20000+Math.random()*40000:80000+Math.random()*100000);};
  const appear=()=>{
   if(document.hidden||reduced.matches||!root.current){schedule();return;}
   const viewport=root.current.getBoundingClientRect();
   const rows=Array.from(root.current.querySelectorAll<HTMLElement>('[data-pixel-cat-message]'));
   const contentBoxes=Array.from(root.current.querySelectorAll('.dm-bubble,.dm-message-media,.dm-group-sender,.dm-sender-avatar')).map(element=>({element,box:element.getBoundingClientRect()}));
   const choices=rows.flatMap(row=>{
    const anchor=row.querySelector('.dm-bubble,.dm-message-media');if(!anchor)return [];
    const box=anchor.getBoundingClientRect(),rowBox=row.getBoundingClientRect();
    const left=row.classList.contains('is-own')?box.right-72:box.left+8;
    const cat={left,right:left+64,top:box.top-34,bottom:box.top+1};
    if(box.width<80||cat.top<viewport.top+2||box.top>=viewport.bottom-24||cat.left<viewport.left||cat.right>viewport.right
     ||contentBoxes.some(other=>other.element!==anchor&&cat.left<other.box.right&&cat.right>other.box.left&&cat.top<other.box.bottom&&cat.bottom>other.box.top))return [];
    return [{row,offset:{left:left-rowBox.left,top:box.top-rowBox.top-27}}];
   });
   if(choices.length){const choice=choices[Math.floor(Math.random()*choices.length)];setVisit({id:choice.row.dataset.pixelCatMessage!,motion:(['sit','walk','pounce'] as const)[Math.floor(Math.random()*3)],offset:choice.offset});departure=setTimeout(()=>setVisit(null),12500);}
   schedule();
  };
  const clear=()=>{setVisit(null);};
  const hide=()=>{if(document.hidden)clear();};
  window.addEventListener('resize',clear);window.visualViewport?.addEventListener('resize',clear);reduced.addEventListener('change',clear);document.addEventListener('visibilitychange',hide);root.current?.addEventListener('scroll',clear,{passive:true});const element=root.current;
  schedule(true);
  return()=>{clearTimeout(timer);clearTimeout(departure);window.removeEventListener('resize',clear);window.visualViewport?.removeEventListener('resize',clear);reduced.removeEventListener('change',clear);document.removeEventListener('visibilitychange',hide);element?.removeEventListener('scroll',clear);};
 },[root,scope,enabled]);
 return visit;
}
