import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AnimatedCount } from './AnimatedCount';
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
  expect(view.container.textContent).toBe('0');
});
