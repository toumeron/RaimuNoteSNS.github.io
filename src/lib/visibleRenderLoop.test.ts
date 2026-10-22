import {afterEach,expect,it,vi} from 'vitest';
import {bindVisibleRenderLoop} from "@/lib/utils";
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('stops offscreen/hidden rendering and resumes with a fresh animation clock',()=>{
 let hidden=false,notify!:(entries:any[])=>void;
 vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
 const disconnect=vi.fn();vi.stubGlobal('IntersectionObserver',class{constructor(callback:any){notify=callback;}observe(){}disconnect=disconnect;});
 const element=document.createElement('div'),setLoop=vi.fn(),render=vi.fn(),resume=vi.fn();
 const stop=bindVisibleRenderLoop(element,setLoop,render,resume);expect(setLoop).toHaveBeenLastCalledWith(render);
 notify([{target:element,isIntersecting:false}]);expect(setLoop).toHaveBeenLastCalledWith(null);
 hidden=true;document.dispatchEvent(new Event('visibilitychange'));notify([{target:element,isIntersecting:true}]);expect(setLoop).toHaveBeenCalledTimes(2);
 hidden=false;document.dispatchEvent(new Event('visibilitychange'));expect(setLoop).toHaveBeenLastCalledWith(render);expect(resume).toHaveBeenCalledTimes(2);
 window.dispatchEvent(new Event('pagehide'));expect(setLoop).toHaveBeenLastCalledWith(null);window.dispatchEvent(new Event('pageshow'));expect(setLoop).toHaveBeenLastCalledWith(render);
 stop();expect(disconnect).toHaveBeenCalledOnce();const calls=setLoop.mock.calls.length;document.dispatchEvent(new Event('visibilitychange'));expect(setLoop).toHaveBeenCalledTimes(calls);
});
