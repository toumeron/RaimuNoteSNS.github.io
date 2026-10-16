import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/hooks/useLists',()=>({useListCatalog:()=>({data:[]}),useInvalidateLists:()=>vi.fn()}));
import { TimelineTabBar } from './TimelineTabBar';
import { normalizeTimelineTabs, useTimelineTabs, saveTimelineTabs } from '@/lib/timelineTabs';
beforeEach(()=>localStorage.clear());afterEach(cleanup);
function Mount({owner='owner'}:{owner?:string}){const tabs=useTimelineTabs(owner);return <TimelineTabBar tabs={tabs} owner={owner} active="all" onSelect={vi.fn()} onDoubleClick={vi.fn()}/>;}
it('customizes tab order and persists changes without hide buttons',()=>{
 const view=render(<Mount/>);fireEvent.click(screen.getByRole('button',{name:'タイムラインのタブをカスタマイズ'}));
 fireEvent.keyDown(screen.getByRole('button',{name:'トレンドをドラッグして並べ替え'}),{key:'ArrowUp'});
 expect(screen.getAllByRole('tab', { hidden: true }).map(t=>t.textContent)).toEqual(['最新','トレンド','フォロー中']);
 expect(screen.queryByRole('button',{name:/を非表示/})).not.toBeInTheDocument();
 view.unmount();render(<Mount/>);expect(screen.getAllByRole('tab', { hidden: true }).map(t=>t.textContent)).toEqual(['最新','トレンド','フォロー中']);
});
it('keeps at least one tab and isolates account configurations',()=>{
 saveTimelineTabs('owner',['following']);render(<Mount/>);
 fireEvent.click(screen.getByRole('button',{name:'タイムラインのタブをカスタマイズ'}));
 expect(screen.queryByRole('button',{name:/を非表示/})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'トレンド'}));expect(screen.getAllByRole('tab',{hidden:true})).toHaveLength(2);
 cleanup();render(<Mount owner="other"/>);expect(screen.getAllByRole('tab', { hidden: true })).toHaveLength(3);
 expect(normalizeTimelineTabs(['bad','all','all'])).toEqual(['all']);expect(normalizeTimelineTabs([])).toHaveLength(3);
});
it('keeps the tab list horizontally scrollable and supports keyboard selection',()=>{
 const select=vi.fn();const tabs=normalizeTimelineTabs(null).map(value=>({value,label:value}));render(<TimelineTabBar tabs={tabs} active="all" onSelect={select} onDoubleClick={vi.fn()}/>);
 expect(screen.getByRole('tablist')).toHaveClass('overflow-x-auto');fireEvent.keyDown(screen.getByRole('tablist'),{key:'ArrowRight'});expect(select).toHaveBeenCalledWith('following');
});
it('reorders tabs using the drag handle on touch/pointer devices',()=>{
 render(<Mount/>);
 fireEvent.click(screen.getByRole('button',{name:'タイムラインのタブをカスタマイズ'}));
 const handle=screen.getByRole('button',{name:'最新をドラッグして並べ替え'});
 const target=screen.getByRole('button',{name:'トレンドをドラッグして並べ替え'}).closest('[data-timeline-tab-item]');
 handle.setPointerCapture=vi.fn();
 const original=document.elementFromPoint;
 document.elementFromPoint=vi.fn().mockReturnValue(target);
 try {
  const down=new Event('pointerdown',{bubbles:true});Object.assign(down,{pointerId:1,clientY:0});fireEvent(handle,down);const up=new Event('pointerup',{bubbles:true});Object.assign(up,{pointerId:1,clientY:200});fireEvent(handle,up);
  expect(screen.getAllByRole('tab',{hidden:true}).map(t=>t.textContent)).toEqual(['フォロー中','トレンド','最新']);
 } finally {document.elementFromPoint=original;}
});
it('searches customization choices without changing visible tabs',()=>{
 render(<Mount/>);fireEvent.click(screen.getByRole('button',{name:'タイムラインのタブをカスタマイズ'}));
 fireEvent.change(screen.getByRole('textbox',{name:'タブを検索'}),{target:{value:'トレンド'}});
 expect(screen.getByRole('button',{name:'トレンドをドラッグして並べ替え'})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'最新をドラッグして並べ替え'})).not.toBeInTheDocument();
 expect(screen.getAllByRole('tab',{hidden:true})).toHaveLength(3);
});
it('previews drag movement and animates neighboring rows before persisting on drop',()=>{
 render(<Mount/>);fireEvent.click(screen.getByRole('button',{name:'タイムラインのタブをカスタマイズ'}));
 const handle=screen.getByRole('button',{name:'最新をドラッグして並べ替え'});
 const row=handle.closest<HTMLElement>('[data-timeline-tab-item]')!;
 const target=screen.getByRole('button',{name:'トレンドをドラッグして並べ替え'}).closest<HTMLElement>('[data-timeline-tab-item]')!;
 const rows=Array.from(screen.getByRole('dialog').querySelectorAll<HTMLElement>('[data-timeline-tab-item]'));
 const animations=rows.map(element=>{
  Object.defineProperty(element,'offsetTop',{configurable:true,get:()=>Array.from(element.parentElement!.children).indexOf(element)*96});
  element.animate=vi.fn();return element.animate;
 });
 handle.setPointerCapture=vi.fn();
 const original=document.elementFromPoint;document.elementFromPoint=vi.fn().mockReturnValue(target);
 const pointer=(type:string,y:number)=>{const event=new Event(type,{bubbles:true});Object.assign(event,{pointerId:1,clientX:10,clientY:y});fireEvent(handle,event);};
 try {
  pointer('pointerdown',10);pointer('pointermove',180);
  expect(row).toHaveAttribute('data-dragging','true');expect(row.style.transform).toContain('translateY(');
  expect(animations.some(animation=>vi.mocked(animation).mock.calls.length>0)).toBe(true);
  expect(screen.getAllByRole('tab',{hidden:true}).map(t=>t.textContent)).toEqual(['最新','フォロー中','トレンド']);
  pointer('pointerup',180);
  expect(row).not.toHaveAttribute('data-dragging');
  expect(screen.getAllByRole('tab',{hidden:true}).map(t=>t.textContent)).toEqual(['フォロー中','トレンド','最新']);
 } finally {document.elementFromPoint=original;}
});
it('keeps the existing mobile and desktop tab typography and provides a full-screen mobile editor',()=>{
 const tabs=normalizeTimelineTabs(null).map(value=>({value,label:value}));
 const view=render(<TimelineTabBar tabs={tabs} active="all" onSelect={vi.fn()} onDoubleClick={vi.fn()}/>);
 expect(screen.getByRole('tab',{name:'all'})).toHaveClass('h-10','text-base','feed-tabs-trigger');
 fireEvent.click(screen.getByRole('button',{name:'タイムラインのタブをカスタマイズ'}));
 expect(screen.getByRole('dialog')).toHaveClass('max-md:inset-0','max-md:h-[var(--timeline-editor-height,100dvh)]','max-md:rounded-none');
 view.unmount();render(<TimelineTabBar variant="desktop" tabs={tabs} active="all" onSelect={vi.fn()} onDoubleClick={vi.fn()}/>);
 expect(screen.getByRole('tab',{name:'all'})).toHaveClass('text-sm','font-bold','rounded-xl');
});
it('shows directional scroll controls only for hidden tabs and keeps the plus outside the scroller',()=>{
 render(<Mount/>);
 const scroller=screen.getByRole('tablist');
 const plus=screen.getByRole('button',{name:'タイムラインのタブをカスタマイズ'});
 expect(scroller.contains(plus)).toBe(false);
 expect(screen.queryByRole('button',{name:'タブを右にスクロール'})).not.toBeInTheDocument();
 Object.defineProperties(scroller,{clientWidth:{configurable:true,value:100},scrollWidth:{configurable:true,value:300},scrollLeft:{configurable:true,writable:true,value:0}});
 scroller.scrollBy=vi.fn();fireEvent(window,new Event('resize'));
 const arrow=screen.getByRole('button',{name:'タブを右にスクロール'});expect(arrow).toHaveClass('opacity-0','pointer-events-none','group-hover/timeline-scroll:opacity-100');expect(arrow.className).not.toContain('group-focus-within');
 fireEvent.click(arrow);
 expect(scroller.scrollBy).toHaveBeenCalledWith({left:80,behavior:'smooth'});
 expect(screen.queryByRole('button',{name:'タブを左にスクロール'})).not.toBeInTheDocument();
 scroller.scrollLeft=100;fireEvent.scroll(scroller);
 expect(screen.getByRole('button',{name:'タブを左にスクロール'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'タブを右にスクロール'})).toBeInTheDocument();
 scroller.scrollLeft=200;fireEvent.scroll(scroller);
 expect(screen.queryByRole('button',{name:'タブを右にスクロール'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'タブを左にスクロール'}));
 expect(scroller.scrollBy).toHaveBeenLastCalledWith({left:-80,behavior:'smooth'});
 Object.defineProperty(scroller,'clientWidth',{configurable:true,value:300});scroller.scrollLeft=0;fireEvent(window,new Event('resize'));
 expect(screen.queryByRole('button',{name:'タブを左にスクロール'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'タブを右にスクロール'})).not.toBeInTheDocument();
});
it('does not show an edit button, focuses the screen instead of opening the keyboard, and sizes it to the visual viewport',()=>{
 render(<Mount/>);fireEvent.click(screen.getByRole('button',{name:'タイムラインのタブをカスタマイズ'}));
 expect(screen.queryByRole('button',{name:'編集'})).not.toBeInTheDocument();
 const dialog=screen.getByRole('dialog');
 expect(dialog).toHaveClass('overflow-hidden','overscroll-none');
 expect(dialog.style.getPropertyValue('--timeline-editor-height')).toBe(`${window.innerHeight}px`);
 expect(document.activeElement).not.toBe(screen.getByRole('textbox',{name:'タブを検索'}));
});
it('persists the drag preview when capture is lost and preserves it after reopening',()=>{
 const view=render(<Mount/>);fireEvent.click(screen.getByRole('button',{name:'タイムラインのタブをカスタマイズ'}));
 const handle=screen.getByRole('button',{name:'最新をドラッグして並べ替え'});handle.setPointerCapture=vi.fn();
 const pointer=(type:string,y:number)=>{const event=new Event(type,{bubbles:true});Object.assign(event,{pointerId:1,clientY:y});fireEvent(handle,event);};
 pointer('pointerdown',0);pointer('pointermove',210);pointer('lostpointercapture',210);
 expect(screen.getAllByRole('tab',{hidden:true}).map(t=>t.textContent)).toEqual(['フォロー中','トレンド','最新']);
 view.unmount();render(<Mount/>);
 expect(screen.getAllByRole('tab').map(t=>t.textContent)).toEqual(['フォロー中','トレンド','最新']);
});
it('locks the mobile document, follows the visible viewport height and restores scrolling on close',()=>{
 const media=vi.spyOn(window,'matchMedia').mockImplementation(query=>({matches:query.includes('max-width'),media:query,onchange:null,addListener:vi.fn(),removeListener:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn(),dispatchEvent:vi.fn()}));
 const scroll=vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
 const original=Object.getOwnPropertyDescriptor(window,'visualViewport');
 const viewport=Object.assign(new EventTarget(),{height:600,offsetTop:0});
 Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});
 const previous=document.body.style.position;
 try {
  const view=render(<Mount/>);fireEvent.click(screen.getByRole('button',{name:'タイムラインのタブをカスタマイズ'}));
  expect(document.body.style.position).toBe('fixed');
  const dialog=screen.getByRole('dialog');expect(dialog.style.getPropertyValue('--timeline-editor-height')).toBe('600px');
  viewport.height=400;viewport.dispatchEvent(new Event('resize'));expect(dialog.style.getPropertyValue('--timeline-editor-height')).toBe('400px');
  view.unmount();expect(document.body.style.position).toBe(previous);expect(scroll).toHaveBeenCalled();
 } finally {media.mockRestore();scroll.mockRestore();if(original)Object.defineProperty(window,'visualViewport',original);else delete window.visualViewport;}
});
it('offers every topic separately and persists/reorders topic tabs with ordinary tabs',()=>{
 render(<Mount/>);fireEvent.click(screen.getByRole('button',{name:'タイムラインのタブをカスタマイズ'}));
 expect(screen.getAllByRole('button',{name:/を追加$/})).toHaveLength(22);
 fireEvent.click(screen.getByRole('button',{name:'科学を追加'}));
 expect(screen.getAllByRole('tab',{hidden:true}).at(-1)).toHaveTextContent('科学');
 fireEvent.keyDown(screen.getByRole('button',{name:'科学をドラッグして並べ替え'}),{key:'ArrowUp'});
 expect(normalizeTimelineTabs(JSON.parse(localStorage.getItem('lime_timeline_tabs:owner:v1')!))).toEqual(['all','following','topic:science','trending']);
 expect(normalizeTimelineTabs(['topic:unknown','topic:science','topic:science'])).toEqual(['topic:science']);
});

it('removes only topic tabs and makes them available again',()=>{
 saveTimelineTabs('owner',['following','topic:science']);render(<Mount/>);
 fireEvent.click(screen.getByRole('button',{name:'タイムラインのタブをカスタマイズ'}));
 expect(screen.queryByRole('button',{name:'トレンドを外す'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'科学を外す'}));
 expect(screen.getByRole('button',{name:'科学を追加'})).toBeInTheDocument();
 expect(screen.getAllByRole('tab',{hidden:true})).toHaveLength(1);
 expect(JSON.parse(localStorage.getItem('lime_timeline_tabs:owner:v1')!)).toEqual(['following']);
 fireEvent.click(screen.getByRole('button',{name:'科学を追加'}));
 expect(screen.getAllByRole('tab',{hidden:true})).toHaveLength(2);
 expect(screen.getByRole('dialog')).toHaveClass('border-0','shadow-none');
});
