import {useSyncExternalStore} from 'react';
export type CompanionPreferences = {enabled:boolean;modelId:string;size:number;side:'left'|'right';x:number|null;y:number|null;viewportWidth?:number;viewportHeight?:number};
export const DEFAULT_COMPANION:CompanionPreferences={enabled:false,modelId:'default',size:220,side:'right',x:null,y:null};
const event='lime-companion-change';
export function companionKey(userId:string){return `lime-companion:${userId}`;}
export function readCompanion(userId:string):CompanionPreferences{
 try{const raw=JSON.parse(localStorage.getItem(companionKey(userId))||'null');if(!raw)return DEFAULT_COMPANION;
 return {enabled:raw.enabled===true,modelId:typeof raw.modelId==='string'?raw.modelId:'default',size:Math.max(120,Math.min(360,Number(raw.size)||220)),side:raw.side==='left'?'left':'right',x:Number.isFinite(raw.x)?raw.x:null,y:Number.isFinite(raw.y)?raw.y:null,viewportWidth:Number(raw.viewportWidth)>0?Number(raw.viewportWidth):undefined,viewportHeight:Number(raw.viewportHeight)>0?Number(raw.viewportHeight):undefined};
 }catch{return DEFAULT_COMPANION;}
}
export function updateCompanion(userId:string,patch:Partial<CompanionPreferences>){
 localStorage.setItem(companionKey(userId),JSON.stringify({...readCompanion(userId),...patch}));window.dispatchEvent(new Event(event));
}
function subscribe(callback:()=>void){window.addEventListener(event,callback);window.addEventListener('storage',callback);return()=>{window.removeEventListener(event,callback);window.removeEventListener('storage',callback);};}
function snapshot(userId:string){try{return localStorage.getItem(companionKey(userId));}catch{return null;}}
export function useCompanion(userId:string){const raw=useSyncExternalStore(subscribe,()=>snapshot(userId),()=>null);return raw?readCompanion(userId):DEFAULT_COMPANION;}
