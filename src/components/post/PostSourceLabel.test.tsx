import { cleanup, render, act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PostSourceLabel, PostSourceLabelVisibility, AnimatedCount } from "@/components/post/PostSourceLabel";

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
