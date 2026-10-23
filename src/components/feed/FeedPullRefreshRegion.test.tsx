import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FeedPullRefreshRegion } from './FeedPullRefreshRegion';
beforeEach(()=>{Object.defineProperty(window,'scrollY',{configurable:true,value:0});document.documentElement.scrollTop=0;document.body.scrollTop=0;});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function touch(target:Element,type:string,y:number,x=10){
 const event=new Event(type,{bubbles:true,cancelable:true});Object.assign(event,{touches:type==='touchend'?[]:[{clientY:y,clientX:x}]});fireEvent(target,event);return event;
}
function setup(enabled=true){
 const refresh=vi.fn().mockResolvedValue(undefined);
 const view=render(<><header><button>ヘッダー</button><div data-lime-feed-tab-row><button role="tab">タブ</button><span>タブの余白</span></div></header><FeedPullRefreshRegion enabled={enabled} onRefresh={refresh}><article>フィードのポスト</article><textarea aria-label="投稿欄"/></FeedPullRefreshRegion></>);
 return {...view,refresh,indicator:()=>view.container.querySelector('[data-lime-feed-pull-indicator]')!};
}
it.each(['ヘッダー','フィードのポスト'])('accepts pulls from %s and expands only the feed',name=>{
 const view=setup(),target=screen.getByText(name);
 touch(target,'touchstart',0);touch(target,'touchmove',500);
 expect(view.indicator()).toHaveStyle({height:'300px'});expect(screen.getByRole('status')).toHaveAccessibleName('離して更新');
 expect(view.indicator().closest('header')).toBeNull();touch(target,'touchcancel',500);expect(view.indicator()).toHaveStyle({height:'0px'});
});
it('excludes both the tab button and the entire tab row',()=>{
 const view=setup();for(const target of [screen.getByRole('tab'),screen.getByText('タブの余白')]){touch(target,'touchstart',0);touch(target,'touchmove',300);touch(target,'touchend',300);}
 expect(view.indicator()).toHaveStyle({height:'0px'});expect(view.refresh).not.toHaveBeenCalled();
});
it('includes the inline post composer',()=>{
 const view=setup(),target=screen.getByLabelText('投稿欄');touch(target,'touchstart',0);touch(target,'touchmove',150);expect(view.indicator()).toHaveStyle({height:'90px'});
});
it('pins an inline spinner while loading and collapses when the refresh finishes',async()=>{
 const view=setup();let finish!:()=>void;view.refresh.mockReturnValue(new Promise<void>(resolve=>{finish=resolve;}));const target=screen.getByText('フィードのポスト');
 touch(target,'touchstart',0);touch(target,'touchmove',200);touch(target,'touchend',200);await act(async()=>{});
 expect(view.refresh).toHaveBeenCalledOnce();expect(view.indicator()).toHaveStyle({height:'56px'});expect(screen.getByRole('status')).toHaveAccessibleName('更新中');
 touch(target,'touchend',200);expect(view.refresh).toHaveBeenCalledOnce();await act(async()=>finish());expect(view.indicator()).toHaveStyle({height:'0px'});
});
it('cancels short, horizontal and scrolled gestures',()=>{
 const view=setup(),target=screen.getByText('フィードのポスト');
 touch(target,'touchstart',0);touch(target,'touchmove',20);touch(target,'touchend',20);expect(view.refresh).not.toHaveBeenCalled();
 touch(target,'touchstart',0);touch(target,'touchmove',10,200);touch(target,'touchmove',300,200);touch(target,'touchend',300);expect(view.refresh).not.toHaveBeenCalled();
 Object.defineProperty(window,'scrollY',{configurable:true,value:50});touch(target,'touchstart',0);touch(target,'touchmove',200);touch(target,'touchend',200);expect(view.refresh).not.toHaveBeenCalled();
});
it('does not compete with a portaled audience sheet, even if it opens during a pull',()=>{
 const view=setup(),target=screen.getByText('フィードのポスト');touch(target,'touchstart',0);touch(target,'touchmove',150);
 const sheet=document.createElement('section');sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','true');document.body.append(sheet);
 touch(sheet,'touchmove',300);touch(sheet,'touchend',300);expect(view.refresh).not.toHaveBeenCalled();expect(view.indicator()).toHaveStyle({height:'0px'});sheet.remove();
});
it('leaves desktop unchanged',()=>{
 const view=setup(false),target=screen.getByText('フィードのポスト');touch(target,'touchstart',0);touch(target,'touchmove',200);touch(target,'touchend',200);expect(view.indicator()).toBeNull();expect(view.refresh).not.toHaveBeenCalled();
});
