import { render, screen, act } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { ProfileVirtualizedListItem } from './ProfileVirtualizedRow';
let inView = true;
vi.mock('react-intersection-observer', () => ({ useInView: () => ({ ref: () => {}, inView }) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); inView = true; });
it('keeps an unmeasured row mounted when the observer marks it offscreen, then restores measured content', () => {
  let height = 0;
  let resize: () => void = () => {};
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => height);
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
  function Example() { const cache = useRef(new Map<string, number>()); return <ProfileVirtualizedListItem rowKey="post" heightCache={cache}><article>プロフィールの投稿</article></ProfileVirtualizedListItem>; }
  const view = render(<Example />);
  inView = false;
  view.rerender(<Example />);
  expect(screen.getByText('プロフィールの投稿')).toBeInTheDocument();
  height = 360;
  act(() => resize());
  expect(screen.queryByText('プロフィールの投稿')).not.toBeInTheDocument();
  expect(view.container.querySelector('[aria-hidden=true]')).toHaveStyle({ height: '360px' });
  inView = true;
  view.rerender(<Example />);
  expect(screen.getByText('プロフィールの投稿')).toBeInTheDocument();
});
