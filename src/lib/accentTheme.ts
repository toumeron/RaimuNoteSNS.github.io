import {useSyncExternalStore} from 'react';
export const ACCENT_COLORS=[
 {id:'pink',label:'ピンク',color:'#f43f86'},
 {id:'blue',label:'ブルー',color:'#1DA1F2'},
 {id:'yellow',label:'イエロー',color:'#ffd400'},
 {id:'purple',label:'パープル',color:'#7856ff'},
 {id:'orange',label:'オレンジ',color:'#ff7a00'},
 {id:'green',label:'グリーン',color:'#00ad80'},
] as const;
export type AccentColor=typeof ACCENT_COLORS[number]['id'];
const KEY='lime-accent-color',EVENT='lime-accent-change';
const valid=(value:unknown):value is AccentColor=>ACCENT_COLORS.some(c=>c.id===value);
export function getAccentColor():AccentColor{try{const value=localStorage.getItem(KEY);return valid(value)?value:'pink'}catch{return 'pink'}}
export function applyAccentTheme(){document.documentElement.dataset.accent=getAccentColor()}
export function setAccentColor(color:AccentColor){if(!valid(color))return;try{localStorage.setItem(KEY,color)}catch{}document.documentElement.dataset.accent=color;window.dispatchEvent(new Event(EVENT));}
function subscribe(listener:()=>void){const update=()=>{applyAccentTheme();listener()};window.addEventListener(EVENT,listener);window.addEventListener('storage',update);return()=>{window.removeEventListener(EVENT,listener);window.removeEventListener('storage',update)}}
export function useAccentColor(){return useSyncExternalStore(subscribe,()=>{const color=document.documentElement.dataset.accent;return valid(color)?color:getAccentColor()},()=> 'pink' as AccentColor)}
