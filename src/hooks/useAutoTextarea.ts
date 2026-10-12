import {useCallback,useLayoutEffect,type RefObject} from 'react';

/** Fit actual wrapped lines instead of reserving empty rows above attachments. */
export function useAutoTextarea(ref:RefObject<HTMLTextAreaElement>,value:string,maxHeight=320){
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
