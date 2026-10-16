import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useViewportWidth, useScrollDirection } from "@/hooks/useViewportWidth";

describe("useViewportWidth", () => {
afterEach(()=>{cleanup();vi.unstubAllGlobals();Object.defineProperty(window,'innerWidth',{value:1024,configurable:true});});
it('shares one native listener across 100 cards and updates only when the breakpoint changes',()=>{
 let change!:()=>void;const add=vi.fn((_:string,callback:()=>void)=>{change=callback;}),remove=vi.fn();
 vi.stubGlobal('matchMedia',()=>({addEventListener:add,removeEventListener:remove}));
 Object.defineProperty(window,'innerWidth',{value:390,configurable:true});
 let renders=0;function Card(){renders++;return <span>{String(useViewportWidth(640))}</span>;}
 const view=render(<>{Array.from({length:100},(_,i)=><Card key={i}/>)}</>);
 expect(add).toHaveBeenCalledTimes(1);expect(view.getAllByText('true')).toHaveLength(100);const initial=renders;
 act(()=>change());expect(renders).toBe(initial);
 act(()=>{Object.defineProperty(window,'innerWidth',{value:1000,configurable:true});change();});
 expect(view.getAllByText('false')).toHaveLength(100);expect(renders).toBe(initial+100);
 view.unmount();expect(remove).toHaveBeenCalledTimes(1);
});
});

describe("useScrollDirection", () => {
afterEach(()=>{cleanup();Object.defineProperty(window,'scrollY',{value:0,configurable:true});});
const scroll=(y:number)=>act(()=>{Object.defineProperty(window,'scrollY',{value:y,configurable:true});window.dispatchEvent(new Event('scroll'));});
it('does not rerender the application for continued scrolling in the same direction',()=>{
 let renders=0;const view=renderHook(()=>{renders++;return useScrollDirection();});
 const start=renders;
 scroll(50);expect(renders).toBe(start);expect(view.result.current).toBe(true);
 scroll(200);expect(view.result.current).toBe(false);const hiddenRenders=renders;
 for(let y=300;y<=10000;y+=100)scroll(y);
 expect(renders).toBe(hiddenRenders);
 scroll(9800);expect(view.result.current).toBe(true);const shownRenders=renders;
 for(let y=9700;y>=0;y-=100)scroll(y);
 expect(renders).toBe(shownRenders);
});
});
