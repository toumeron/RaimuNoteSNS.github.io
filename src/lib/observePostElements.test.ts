import { afterEach, expect, it, vi } from "vitest";
import { observePostElements, observeDocumentHeight } from "@/lib/observePostElements";

describe("observePostElements", () => {
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();});
const flush=()=>new Promise<void>(resolve=>queueMicrotask(resolve));
it('tracks inserted, changed and removed rows without rescanning the document for unrelated updates',async()=>{
 document.body.innerHTML='<section><div data-lime-trend-post="first"></div><span id="counter"></span></section>';
 const scan=vi.spyOn(document,'querySelectorAll'),add=vi.fn(),remove=vi.fn();
 const stop=observePostElements('data-lime-trend-post',add,remove);
 expect(scan).toHaveBeenCalledTimes(1);expect(add).toHaveBeenCalledTimes(1);
 for(let i=0;i<100;i++)document.getElementById('counter')!.textContent=String(i);
 await flush();expect(scan).toHaveBeenCalledTimes(1);expect(add).toHaveBeenCalledTimes(1);
 const wrapper=document.createElement('section');wrapper.innerHTML='<article data-lime-trend-post="next"></article>';document.body.append(wrapper);
 await flush();expect(add).toHaveBeenCalledTimes(2);
 const post=wrapper.firstElementChild!;post.setAttribute('data-lime-trend-post','updated');await flush();expect(add).toHaveBeenCalledTimes(3);
 wrapper.remove();await flush();expect(remove).toHaveBeenCalledWith(post);
 expect(scan).toHaveBeenCalledTimes(1);stop();
});
});

describe("observeDocumentHeight", () => {
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('does no layout reads while scrolling, batches growth and disconnects cleanly',()=>{
 let resized:()=>void=()=>{},frame:FrameRequestCallback=()=>{};
 const observe=vi.fn(),disconnect=vi.fn();
 vi.stubGlobal('ResizeObserver',class{observe=observe;disconnect=disconnect;constructor(callback:()=>void){resized=callback;}});
 const raf=vi.fn((callback:FrameRequestCallback)=>{frame=callback;return 1;});vi.stubGlobal('requestAnimationFrame',raf);
 const cancel=vi.fn();vi.stubGlobal('cancelAnimationFrame',cancel);
 const height=vi.spyOn(document.documentElement,'scrollHeight','get').mockReturnValue(1000),notify=vi.fn();
 const stop=observeDocumentHeight(notify);expect(notify).toHaveBeenLastCalledWith(1000);expect(observe).toHaveBeenCalledTimes(2);
 for(let i=0;i<200;i++)window.dispatchEvent(new Event('scroll'));
 expect(height).toHaveBeenCalledTimes(1);
 height.mockReturnValue(2000);for(let i=0;i<100;i++)resized();expect(raf).toHaveBeenCalledTimes(1);
 frame(0);expect(notify).toHaveBeenLastCalledWith(2000);expect(height).toHaveBeenCalledTimes(2);
 resized();stop();expect(cancel).toHaveBeenCalledWith(1);expect(disconnect).toHaveBeenCalledTimes(1);
});
});
