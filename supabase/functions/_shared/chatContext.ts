export type ContextItem = {role:string;parts?:{text?:string;inlineData?:unknown}[]};
/** Bound text before upstream requests. Keep instruction separate from the latest turn. */
export function boundedChatContext<T extends ContextItem>(items:T[]):T[]{
 const instructions=items.filter(i=>i.parts?.some(p=>p.text?.startsWith('【システム命令:'))).slice(0,1).map(i=>({...i,parts:i.parts?.map(p=>p.text?{...p,text:p.text.slice(0,2000)}:p)}));
 const history=items.filter(i=>!i.parts?.some(p=>p.text?.startsWith('【システム命令:'))).slice(-24);
 let remaining=4000;const kept:T[]=[];
 for(let n=history.length-1;n>=0;n--){const item=history[n];const parts=item.parts?.map(p=>{if(typeof p.text!=='string')return p;const limit=Math.min(remaining,n===history.length-1?3000:1000);const text=p.text.slice(0,limit);remaining-=text.length;return {...p,text}});if(parts?.some(p=>p.text||!('text'in p)))kept.unshift({...item,parts});if(remaining<=0)break;}
 return [...instructions,...kept] as T[];
}
