import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
vi.mock('@/hooks/useAuth',async original=>({...await original<typeof import('@/hooks/useAuth')>(),useAuth:()=>({user:null})}));
vi.mock('@/lib/aiFriends',async original=>({...await original<typeof import('@/lib/aiFriends')>(),useCachedChatImage:(src:string)=>src}));
vi.mock('@/components/feed/PostCard',async original=>({...await original<typeof import('@/components/feed/PostCard')>(),PostCard:({mediaPresentation}:{mediaPresentation:string})=>mediaPresentation==='actions'?<div data-lime-post-actions><div data-testid="count-action"><button><svg data-measure="icon"/><span className="tabular-nums" data-measure="count">187</span></button></div><div/><div/><div/></div>:null}));
import {MediaLightbox} from './MediaLightbox';
import type {MediaViewerSelection} from '@/lib/mediaThumbnail';
import type {PostWithAuthor} from '@/types';
let clients:QueryClient[]=[];
beforeEach(()=>{
 vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
 vi.stubGlobal('matchMedia',(query:string)=>({matches:query.includes('prefers-reduced-motion')||query.includes('min-width:768px'),media:query,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return true;}}));
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:800,bottom:600,width:800,height:600,toJSON:()=>({})});
 vi.spyOn(HTMLImageElement.prototype,'naturalWidth','get').mockReturnValue(1600);
 vi.spyOn(HTMLImageElement.prototype,'naturalHeight','get').mockReturnValue(1200);
});
afterEach(()=>{cleanup();clients.forEach(client=>client.clear());clients=[];vi.restoreAllMocks();vi.unstubAllGlobals();});
function mount(selection:MediaViewerSelection={url:'https://example.com/first.jpg',media:[{src:'https://example.com/first.jpg'},{src:'https://example.com/second.jpg'},{src:'https://example.com/third.jpg'}]}){
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);
 const view=render(<QueryClientProvider client={client}><MemoryRouter><MediaLightbox selection={selection} onClose={()=>{}}/></MemoryRouter></QueryClientProvider>);
 return {view,stage:document.querySelector('.lime-media-stage')!,image:screen.getByAltText('拡大画像 1')};
}
function wheel(target:Element,init:WheelEventInit){const event=new WheelEvent('wheel',{bubbles:true,cancelable:true,...init});act(()=>{target.dispatchEvent(event);});return event;}
function gesture(target:Element,type:string,scale=1){const event=new Event(type,{bubbles:true,cancelable:true});Object.assign(event,{scale,clientX:600,clientY:300});act(()=>{target.dispatchEvent(event);});return event;}
it('zooms around the trackpad pointer, pans with two-finger scrolling, and clamps the image',()=>{
 const {stage,image}=mount();
 expect(wheel(stage,{ctrlKey:true,deltaY:-200*Math.log(2),clientX:600,clientY:300}).defaultPrevented).toBe(true);
 expect(image.style.transform).toContain('translate(-200px, 0px) scale(2)');
 wheel(stage,{deltaX:20,deltaY:30});expect(image.style.transform).toContain('translate(-220px, -30px) scale(2)');
 wheel(stage,{deltaX:10000,deltaY:10000});expect(image.style.transform).toContain('translate(-400px, -300px) scale(2)');
 wheel(stage,{ctrlKey:true,deltaY:10000,clientX:400,clientY:300});expect(image.style.transform).toContain('translate(0px, 0px) scale(1)');
});
it('handles Safari gesture scales from the gesture start and avoids duplicate wheel scaling',()=>{
 const {stage,image}=mount();expect(gesture(stage,'gesturestart').defaultPrevented).toBe(true);
 gesture(stage,'gesturechange',2);expect(image.style.transform).toContain('scale(2)');
 wheel(stage,{ctrlKey:true,deltaY:-200});expect(image.style.transform).toContain('scale(2)');
 gesture(stage,'gesturechange',3);expect(image.style.transform).toContain('translate(-400px, 0px) scale(3)');
 gesture(stage,'gestureend');gesture(stage,'gesturestart');gesture(stage,'gesturechange',.5);
 expect(image.style.transform).toContain('translate(-100px, 0px) scale(1.5)');gesture(stage,'gestureend');
});
it('normalizes wheel line units without changing unzoomed vertical scrolling',()=>{
 const {stage,image}=mount();expect(wheel(stage,{deltaY:3,deltaMode:1}).defaultPrevented).toBe(false);
 wheel(stage,{ctrlKey:true,deltaY:-200*Math.log(2)/16,deltaMode:1,clientX:400,clientY:300});expect(image.style.transform).toContain('scale(2)');
});
it('switches images once per horizontal swipe, including momentum events',()=>{
 const {stage}=mount();const now=vi.spyOn(Date,'now').mockReturnValue(1000);
 expect(wheel(stage,{deltaX:85,deltaY:0}).defaultPrevented).toBe(true);expect(screen.getByAltText('拡大画像 2')).toBeTruthy();
 now.mockReturnValue(1030);wheel(stage,{deltaX:150});expect(screen.getByAltText('拡大画像 2')).toBeTruthy();
 now.mockReturnValue(1400);wheel(stage,{deltaX:85});expect(screen.getByAltText('拡大画像 3')).toBeTruthy();
});
it('does not intercept embedded-player gestures and removes its event handlers on close',()=>{
 const {stage,view,image}=mount();const frame=document.createElement('iframe');stage.append(frame);
 expect(wheel(frame,{ctrlKey:true,deltaY:-100}).defaultPrevented).toBe(false);expect(image.style.transform).toContain('scale(1)');
 view.unmount();expect(wheel(stage,{ctrlKey:true,deltaY:-100}).defaultPrevented).toBe(false);expect(gesture(stage,'gesturestart').defaultPrevented).toBe(false);
});

it('does not apply Safari scaling a second time while touch pointers own the pinch',()=>{
 vi.stubGlobal('PointerEvent',class extends MouseEvent {pointerId:number;constructor(type:string,init:PointerEventInit={}){super(type,init);this.pointerId=init.pointerId??1;}});
 const {stage,image}=mount();fireEvent.pointerDown(stage,{pointerId:1,button:0,clientX:400,clientY:300});
 gesture(stage,'gesturestart');gesture(stage,'gesturechange',2);expect(image.style.transform).toContain('scale(1)');
 fireEvent.pointerCancel(stage,{pointerId:1});
});
it('fits the blurred backdrop around the whole icon/count group and resizes it without changing its action slot',async()=>{
 const callbacks:Array<()=>void>=[];let countWidth=24;
 vi.stubGlobal('ResizeObserver',class{constructor(callback:()=>void){callbacks.push(callback);}observe(){}unobserve(){}disconnect(){}});
 vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function(this:HTMLElement){
  const count=this.dataset.measure==='count',host=this.dataset.testid==='count-action';const left=count?188:host?100:0,width=count?countWidth:host?200:800;
  return {x:left,y:0,left,top:0,right:left+width,bottom:600,width,height:600,toJSON:()=>({})};
 });
 vi.spyOn(SVGElement.prototype,'getBoundingClientRect').mockReturnValue({x:160,y:0,left:160,top:0,right:180,bottom:20,width:20,height:20,toJSON:()=>({})});
 const post={id:'',userId:'author',content:'',createdAt:'2026-10-22',imageUrls:['https://example.com/first.jpg'],author:{id:'author',username:'author',displayName:'Author'}} as PostWithAuthor;
 mount({url:'https://example.com/first.jpg',post});const action=screen.getByTestId('count-action');
 expect(action.style.getPropertyValue('--lime-media-action-width')).toBe('72px');
 expect(action.style.getPropertyValue('--lime-media-action-left')).toBe('86px');
 countWidth=60;act(()=>callbacks.forEach(callback=>callback()));await act(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
 expect(action.style.getPropertyValue('--lime-media-action-width')).toBe('108px');
 expect(action.style.width).toBe('');expect(action.style.height).toBe('');expect(action.style.margin).toBe('');
});
