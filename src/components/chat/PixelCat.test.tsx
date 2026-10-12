import {render,screen,act,cleanup} from '@testing-library/react';
import {useRef} from 'react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {TypingPixelCat,MessagePixelCat,useMessagePixelCat} from './PixelCat';
let reduced=false;
function Preview(){const ref=useRef<HTMLDivElement>(null);const visit=useMessagePixelCat(ref,'conversation',true);return <div ref={ref} data-root><div data-pixel-cat-message="message"><div className="dm-bubble">会話本文</div>{visit&&<MessagePixelCat motion={visit.motion} offset={visit.offset}/>}</div><div role="status">フレンドが入力中<TypingPixelCat/></div></div>;}
beforeEach(()=>{
 vi.useFakeTimers();vi.spyOn(Math,'random').mockReturnValue(0);reduced=false;
 vi.spyOn(window,'matchMedia').mockImplementation(()=>({get matches(){return reduced;},media:'',onchange:null,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn(),dispatchEvent:()=>true}));
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(){const top=this.hasAttribute('data-root')?0:50;return {x:0,y:top,left:0,right:300,top,bottom:this.hasAttribute('data-root')?300:90,width:300,height:this.hasAttribute('data-root')?300:40,toJSON(){}};});
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
it('keeps the typing label readable and briefly visits a visible message',()=>{
 const view=render(<Preview/>);expect(screen.getByRole('status')).toHaveTextContent('フレンドが入力中');expect(view.container.querySelector('.pixel-cat-typing [aria-hidden="true"]')).not.toBeNull();
 expect(view.container.querySelector('.pixel-cat-perch')).toBeNull();act(()=>vi.advanceTimersByTime(20001));expect(view.container.querySelector('.pixel-cat-perch [aria-hidden="true"]')).not.toBeNull();expect(screen.getByText('会話本文')).toBeVisible();act(()=>vi.advanceTimersByTime(12500));expect(view.container.querySelector('.pixel-cat-perch')).toBeNull();
});
it('does not schedule a playful visit when motion is reduced and removes timers on unmount',()=>{
 reduced=true;const view=render(<Preview/>);act(()=>vi.advanceTimersByTime(60000));expect(view.container.querySelector('.pixel-cat-perch')).toBeNull();view.unmount();expect(vi.getTimerCount()).toBe(0);
});
