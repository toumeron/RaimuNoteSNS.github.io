const fixture=vi.hoisted(()=>({read:vi.fn(()=>null as {did:string;handle:string;accessJwt:string;refreshJwt:string}|null)}));
vi.mock("@/lib/bluesky",()=>({BSKY_SESSION_STORAGE_KEY:'lime_bluesky_session',getStoredBlueskySession:fixture.read}));
vi.mock("@/lib/fxTwitter",()=>({isXId:(id?:string)=>!!id?.startsWith('x:')}));
vi.mock("@/lib/misskey",()=>({isMisskeyId:(id?:string)=>!!id?.startsWith('misskey:')}));
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useViewportWidth, useScrollDirection, useTimelinePortalTheme, useMinuteTick } from "@/hooks/useViewportWidth";
import { useBlueskySession } from "@/hooks/useAuth";

describe("useViewportWidth", () => {
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
});

describe("sharedPwaSubscriptions", () => {




afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();localStorage.clear();fixture.read.mockReset().mockReturnValue(null);});
it('200 posts share session listeners and refresh once per event; unchanged sessions do not rerender cards',()=>{
 const add=vi.spyOn(window,'addEventListener'),remove=vi.spyOn(window,'removeEventListener');let renders=0;
 function Card(){renders++;return <span>{useBlueskySession('bsky:post')?.handle??'signed-out'}</span>;}
 const view=render(<>{Array.from({length:200},(_,i)=><Card key={i}/>)}</>);
 expect(add.mock.calls.filter(([type])=>type==='lime-bluesky-session-changed')).toHaveLength(1);
 expect(add.mock.calls.filter(([type])=>type==='storage')).toHaveLength(1);
 expect(fixture.read.mock.calls.length).toBeLessThanOrEqual(2);
 const session={did:'did:example',handle:'artist',accessJwt:'access',refreshJwt:'refresh'};
 act(()=>window.dispatchEvent(new CustomEvent('lime-bluesky-session-changed',{detail:{session}})));
 expect(view.getAllByText('artist')).toHaveLength(200);const previous=renders;
 act(()=>window.dispatchEvent(new CustomEvent('lime-bluesky-session-changed',{detail:{session:{...session}}})));
 expect(renders).toBe(previous);
 act(()=>window.dispatchEvent(new CustomEvent('lime-bluesky-session-changed',{detail:{session:null}})));
 expect(view.getAllByText('signed-out')).toHaveLength(200);
 fixture.read.mockReturnValue(session);act(()=>window.dispatchEvent(new StorageEvent('storage',{key:null})));
 expect(view.getAllByText('artist')).toHaveLength(200);
 view.unmount();expect(remove.mock.calls.filter(([type])=>type==='lime-bluesky-session-changed')).toHaveLength(1);
});
it('Twitter and Misskey cards do not read or subscribe to a Bluesky session',()=>{
 const add=vi.spyOn(window,'addEventListener');
 function Card({id}:{id:string}){return <span>{useBlueskySession(id)?.handle??'none'}</span>;}
 const view=render(<><Card id="x:1"/><Card id="misskey:2"/></>);
 expect(fixture.read).not.toHaveBeenCalled();expect(add.mock.calls.filter(([type])=>type==='lime-bluesky-session-changed')).toHaveLength(0);
 view.rerender(<Card id="bsky:3"/>);expect(fixture.read).toHaveBeenCalled();
});
it('200 themed cards share a channel, preserve theme updates, and release it after unmount',()=>{
 const close=vi.fn(),channels:any[]=[];
 vi.stubGlobal('BroadcastChannel',class{onmessage:any;close=close;constructor(){channels.push(this);}});
 const add=vi.spyOn(window,'addEventListener');localStorage.setItem('lime_timeline_visual_theme','light');
 function Card(){return <span>{useTimelinePortalTheme(true)}</span>;}
 const view=render(<>{Array.from({length:200},(_,i)=><Card key={i}/>)}</>);
 expect(channels).toHaveLength(1);expect(view.getAllByText('light')).toHaveLength(200);
 expect(add.mock.calls.filter(([type])=>type==='timeline-visual-theme-changed')).toHaveLength(1);
 act(()=>window.dispatchEvent(new CustomEvent('timeline-visual-theme-changed',{detail:{theme:'dark'}})));
 expect(view.getAllByText('dark')).toHaveLength(200);
 act(()=>channels[0].onmessage({data:{theme:'light'}}));expect(view.getAllByText('light')).toHaveLength(200);
 view.unmount();expect(close).toHaveBeenCalledTimes(1);
});
it('200 relative-time consumers share one clock and suspend it while the PWA is hidden',()=>{
 vi.useFakeTimers();vi.spyOn(document,'hidden','get').mockReturnValue(false);
 const intervals=vi.spyOn(globalThis,'setInterval');let renders=0;
 function Card(){useMinuteTick();renders++;return null;}
 const view=render(<>{Array.from({length:200},(_,i)=><Card key={i}/>)}</>);
 expect(intervals).toHaveBeenCalledTimes(1);const initial=renders;
 act(()=>vi.advanceTimersByTime(60000));expect(renders).toBe(initial+200);
 vi.spyOn(document,'hidden','get').mockReturnValue(true);act(()=>document.dispatchEvent(new Event('visibilitychange')));
 const hidden=renders;act(()=>vi.advanceTimersByTime(600000));expect(renders).toBe(hidden);
 vi.spyOn(document,'hidden','get').mockReturnValue(false);act(()=>document.dispatchEvent(new Event('visibilitychange')));
 expect(renders).toBe(hidden+200);view.unmount();expect(vi.getTimerCount()).toBe(0);
});
});

describe('installed PWA state',()=>{
 afterEach(()=>{cleanup();vi.unstubAllGlobals();delete (navigator as Navigator&{standalone?:boolean}).standalone;});
 it('renders the iOS PWA layout immediately and shares one native subscription across 200 consumers',async()=>{
  const {useIsPWA}=await import('@/hooks/useViewportWidth');
  Object.defineProperty(navigator,'standalone',{configurable:true,value:true});
  const add=vi.fn(),remove=vi.fn();vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:add,removeEventListener:remove}));
  let renders=0;function Probe(){renders++;return <span>{String(useIsPWA())}</span>;}
  const view=render(<>{Array.from({length:200},(_,i)=><Probe key={i}/>)}</>);
  expect(view.getAllByText('true')).toHaveLength(200);expect(renders).toBe(200);expect(add).toHaveBeenCalledTimes(1);
  view.unmount();expect(remove).toHaveBeenCalledTimes(1);
 });
 it('updates installed status without an initial browser-layout flash',async()=>{
  const {useIsPWA}=await import('@/hooks/useViewportWidth');
  let changed!:()=>void;const query={matches:false,addEventListener:(_:string,callback:()=>void)=>{changed=callback;},removeEventListener:vi.fn()};vi.stubGlobal('matchMedia',()=>query);
  const view=renderHook(()=>useIsPWA());expect(view.result.current).toBe(false);
  act(()=>{query.matches=true;changed();});expect(view.result.current).toBe(true);
  view.unmount();
 });
});
