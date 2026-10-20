import { useState } from "react";
import { selectProfilePosts } from "@/lib/utils";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/button";
import { PostTabMenu, postTabMenuOffsets } from "@/components/ui/avatar";
import { PostSourceLabel, PostSourceLabelVisibility, AnimatedCount } from "@/components/feed/QuotedPost";

describe("PostTabMenu", () => {
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('anchors the menu at the label height rather than above or below the whole tab', () => {
 const button={left:300,bottom:660};
 const result=postTabMenuOffsets(button,{left:344,top:628},{width:1200,height:1000});
 expect(button.left+result.alignOffset).toBe(320);
 expect(button.bottom+result.sideOffset).toBe(628);
});
it('keeps both overlapping panels within the viewport at the edges', () => {
 const button={left:980,bottom:770};
 const result=postTabMenuOffsets(button,{left:1010,top:740},{width:1024,height:768});
 expect(button.left+result.alignOffset).toBe(868);
 expect(button.bottom+result.sideOffset).toBe(594);
});
it('opens the options from a tab without nested buttons and selects posts',async()=>{
 const onFilterChange=vi.fn();
 render(<Tabs defaultValue="posts"><TabsList><PostTabMenu filter="all" sort="latest" onFilterChange={onFilterChange} onSortChange={vi.fn()}><TabsTrigger value="posts">すべて</TabsTrigger></PostTabMenu></TabsList></Tabs>);
 const tab=screen.getByRole('tab');
 expect(tab.querySelector('button')).toBeNull();
 expect(tab).toHaveAttribute('data-lime-post-tab-menu-anchor');
 expect(tab.parentElement).toHaveAttribute('role','tablist');
 expect(tab.getAttribute('data-state')).toBe('active');
 fireEvent.keyDown(tab,{key:'Enter'});
 fireEvent.click(await screen.findByRole('menuitem',{name:'ポスト'}));
 expect(onFilterChange).toHaveBeenCalledWith('posts');
});
it('opens on pointer press while keeping tab styling and a direct measurable button',async()=>{
 render(<Tabs defaultValue="posts"><TabsList><PostTabMenu filter="all" sort="latest" onFilterChange={vi.fn()} onSortChange={vi.fn()}><TabsTrigger value="posts" className="flex-1 shrink-0 min-w-max">すべて</TabsTrigger></PostTabMenu></TabsList></Tabs>);
 const tab=screen.getByRole('tab');
 fireEvent(tab,new MouseEvent('pointerdown',{bubbles:true,button:0,ctrlKey:false}));
 expect(screen.queryByRole('menu')).toBeNull();
 fireEvent(tab,new MouseEvent('pointerup',{bubbles:true,button:0}));
 fireEvent.click(tab);
 expect(await screen.findByRole('menu')).toBeVisible();
 expect(tab).toHaveAttribute('data-state','active');
 expect(tab).toHaveAttribute('aria-expanded','true');
});
it.each([
 ['iPhone', 'iPhone', 1],
 ['Mozilla/5.0 Macintosh', 'MacIntel', 5],
])('uses the native select on iOS/iPadOS (%s)', (agent, platform, touchPoints) => {
 vi.spyOn(navigator,'userAgent','get').mockReturnValue(agent);
 vi.spyOn(navigator,'platform','get').mockReturnValue(platform);
 Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,value:touchPoints});
 const filter=vi.fn(), sort=vi.fn();
 render(<Tabs defaultValue="posts"><TabsList><PostTabMenu filter="all" sort="latest" onFilterChange={filter} onSortChange={sort}><TabsTrigger value="posts">すべて</TabsTrigger></PostTabMenu></TabsList></Tabs>);
 const select=screen.getByRole('combobox',{name:'ポストの表示'});
 expect(select.tagName).toBe('SELECT');
 fireEvent.change(select,{target:{value:'posts'}});
 expect(filter).toHaveBeenCalledWith('posts');
 expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['すべて','ポスト']);
 expect(sort).not.toHaveBeenCalled();
 expect(screen.queryByRole('menu')).toBeNull();
});

it('opens sorting only on click, with one divider and an overlapping sort panel',async()=>{
 const sort=vi.fn(), filter=vi.fn();
 render(<Tabs defaultValue="posts"><TabsList><PostTabMenu filter="posts" sort="latest" onFilterChange={filter} onSortChange={sort}><TabsTrigger value="posts">ポスト</TabsTrigger></PostTabMenu></TabsList></Tabs>);
 fireEvent.keyDown(screen.getByRole('tab'),{key:'Enter'});
 const menu=await screen.findByRole('menu');
 expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(1);
 const sorting=screen.getByRole('menuitem',{name:'並び替え'});
 fireEvent.pointerMove(sorting,{pointerType:'mouse'});
 expect(screen.queryByRole('menuitem',{name:/新しい順/})).toBeNull();
 fireEvent.click(sorting);
 expect(screen.getByRole('group',{name:'並び替え'})).toBeVisible();
 const behind=screen.getByRole('menuitem',{name:'すべて'});
 expect(behind).toHaveAttribute('aria-disabled','true');
 fireEvent.click(behind);
 expect(filter).not.toHaveBeenCalled();
 expect(screen.getByRole('group',{name:'並び替え'})).toBeVisible();
 fireEvent.click(screen.getByRole('menuitem',{name:'人気順'}));
 expect(sort).toHaveBeenCalledWith('popular');
});

it.each(['desktop','mobile'])('filters rendered twitter profile entries when selecting posts on %s, including later pages',async(device)=>{
 vi.spyOn(navigator,'userAgent','get').mockReturnValue(device==='mobile'?'iPhone':'Desktop');
 const own={id:'x:601',userId:'x-user:1'},quote={...own,id:'x:602',isQuote:true};
 const repost={...own,id:'x:603',profileRepostedBy:'x-user:1'},partial={...own,id:'x:604',externalRepostedBy:{id:'x-user:1'}};
 function ProfileEntries(){
  const [filter,setFilter]=useState<'all'|'posts'>('all'),[more,setMore]=useState(false);
  const rows=[own,quote,repost,partial,...(more?[{...own,id:'x:605',userId:'x-user:2'},{...own,id:'x:606'}]:[])].map(post=>({post}));
  return <><Tabs defaultValue="posts"><TabsList><PostTabMenu filter={filter} sort="latest" onFilterChange={setFilter} onSortChange={()=>{}}><TabsTrigger value="posts">{filter==='all'?'すべて':'ポスト'}</TabsTrigger></PostTabMenu></TabsList></Tabs><ul>{selectProfilePosts(rows,filter,'latest','x-user:1').map(row=><li key={row.post.id}>{row.post.id}</li>)}</ul><button onClick={()=>setMore(true)}>次のページ</button></>;
 }
 render(<ProfileEntries/>);
 expect(screen.getAllByRole('listitem')).toHaveLength(4);
 if(device==='mobile')fireEvent.change(screen.getByRole('combobox',{name:'ポストの表示'}),{target:{value:'posts'}});
 else{fireEvent.keyDown(screen.getByRole('tab'),{key:'Enter'});fireEvent.click(await screen.findByRole('menuitem',{name:'ポスト'}));}
 expect(screen.getAllByRole('listitem').map(row=>row.textContent).sort()).toEqual(['x:601','x:602']);
 fireEvent.click(screen.getByRole('button',{name:'次のページ'}));
 expect(screen.getAllByRole('listitem').map(row=>row.textContent).sort()).toEqual(['x:601','x:602','x:606']);
});
});

describe("PostSourceLabel", () => {
describe("PostSourceLabel", () => {
afterEach(cleanup);
it('hides every external source inside the profile scope and preserves labels elsewhere',()=>{
 const posts=[{id:'x:1',source:'x'},{id:'bsky:1',source:'bluesky'},{id:'misskey:1',source:'misskey'}];
 const view=render(<><PostSourceLabelVisibility.Provider value={false}><section data-testid="profile">{posts.map(post=><PostSourceLabel key={post.id} post={post}/>)}</section></PostSourceLabelVisibility.Provider><section data-testid="timeline">{posts.map(post=><PostSourceLabel key={post.id} post={post}/>)}</section></>);
 expect(view.getByTestId('profile').querySelectorAll('[data-lime-post-provider]')).toHaveLength(0);
 expect(view.getByTestId('timeline').querySelectorAll('[data-lime-post-provider]')).toHaveLength(3);
});
});

describe("AnimatedCount", () => {
afterEach(()=>{cleanup();vi.useRealTimers();});
it('slides counts upwards on increases and downwards on decreases, then removes old values',()=>{
  vi.useFakeTimers();
  const view=render(<AnimatedCount count={2}/>);
  view.rerender(<AnimatedCount count={3}/>);
  expect(view.container.querySelector('.repost-count')).toHaveClass('is-up');
  expect(view.container.querySelector('.repost-count-old')).toHaveTextContent('2');
  expect(view.container.querySelector('.repost-count-new')).toHaveTextContent('3');
  act(()=>vi.advanceTimersByTime(320));
  expect(view.container.textContent).toBe('3');
  view.rerender(<AnimatedCount count={2}/>);
  expect(view.container.querySelector('.repost-count')).toHaveClass('is-down');
  act(()=>vi.advanceTimersByTime(320));
  expect(view.container.textContent).toBe('2');
});
it('restarts the transition for rapid changes and retains the latest count',()=>{
  vi.useFakeTimers();
  const view=render(<AnimatedCount count={0}/>);
  view.rerender(<AnimatedCount count={1}/>);
  act(()=>vi.advanceTimersByTime(200));
  view.rerender(<AnimatedCount count={0}/>);
  act(()=>vi.advanceTimersByTime(120));
  expect(view.container.querySelector('.repost-count')).toHaveClass('is-down');
  act(()=>vi.advanceTimersByTime(200));
  expect(view.container.textContent).toBe('');
});
});
});
