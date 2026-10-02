import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReplyChain } from './ReplyChain';
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('avatar connectors', () => {
  it('connects avatar bottoms to the next avatar tops across variable card heights', () => {
    let resize!: () => void;
    let taller = false;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect = disconnect; });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const top = this.getAttribute('data-avatar-index') === '0' ? 120 : this.getAttribute('data-avatar-index') === '1' ? taller ? 620 : 420 : 100;
      return { top, bottom: top + 44, left: 10, width: 44 } as DOMRect;
    });
    const view = render(<ReplyChain><div data-lime-thread-item><div data-lime-thread-avatar data-avatar-index="0" /></div><div data-lime-thread-item><div data-lime-thread-avatar data-avatar-index="1" /></div></ReplyChain>);
    const line = view.container.querySelector('line')!;
    expect(line.getAttribute('x1')).toBe('22');
    expect(line.getAttribute('x2')).toBe('22');
    expect(line.getAttribute('y1')).toBe('72');
    expect(line.getAttribute('y2')).toBe('312');
    taller = true; act(() => resize());
    expect(line.getAttribute('y2')).toBe('512');
    view.unmount(); expect(disconnect).toHaveBeenCalled();
  });
});
