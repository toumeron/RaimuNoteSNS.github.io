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
  it('continues the final avatar line with a dotted line beside the inline expansion button', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const top = this.hasAttribute('data-lime-thread-more') ? 300 : this.hasAttribute('data-lime-thread-avatar') ? 120 : 100;
      return { top, bottom: top + 44, left: 10, width: 44 } as DOMRect;
    });
    const view = render(<ReplyChain><div data-lime-thread-item><div data-lime-thread-avatar /></div><button data-lime-thread-more>返信を表示</button></ReplyChain>);
    const lines = view.container.querySelectorAll('line');
    expect(lines).toHaveLength(2);
    expect(lines[0].getAttribute('y1')).toBe('72');
    expect(lines[0].getAttribute('y2')).toBe('192');
    expect(lines[1].getAttribute('x1')).toBe('22');
    expect(lines[1].getAttribute('stroke-dasharray')).toBe('2 6');
  });
  it('connects a parent to its child but does not connect that child to its sibling', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const index = this.getAttribute('data-avatar-index');
      const top = index === null ? 100 : 120 + Number(index) * 200;
      return { top, bottom: top + 44, left: 10, width: 44 } as DOMRect;
    });
    const view = render(<ReplyChain>
      <div data-lime-conversation-comment="parent"><div data-lime-thread-avatar data-avatar-index="0" /></div>
      <div data-lime-conversation-comment="answer" data-lime-conversation-parent="parent"><div data-lime-thread-avatar data-avatar-index="1" /></div>
      <div data-lime-conversation-comment="sibling" data-lime-conversation-parent="parent"><div data-lime-thread-avatar data-avatar-index="2" /></div>
    </ReplyChain>);
    const lines = view.container.querySelectorAll('line');
    expect(lines).toHaveLength(1);
    expect(lines[0].getAttribute('y2')).toBe('212');
  });
  it('anchors the expansion line to its parent instead of the last visible leaf', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const top = this.hasAttribute('data-lime-thread-more') ? 600 : this.getAttribute('data-avatar-index') === '0' ? 120 : this.getAttribute('data-avatar-index') === '1' ? 400 : 100;
      return { top, bottom: top + 44, left: 10, width: 44 } as DOMRect;
    });
    const view = render(<ReplyChain>
      <div data-lime-conversation-comment="parent"><div data-lime-thread-avatar data-avatar-index="0" /></div>
      <div data-lime-conversation-comment="leaf" data-lime-conversation-parent="parent"><div data-lime-thread-avatar data-avatar-index="1" /></div>
      <button data-lime-thread-more="parent">親への他の返信を表示</button>
    </ReplyChain>);
    const lines = view.container.querySelectorAll('line');
    expect(lines).toHaveLength(2);
    expect(lines[0].getAttribute('y1')).toBe('72');
    expect(lines[1].getAttribute('stroke-dasharray')).toBe('2 6');
    expect(lines[0].getAttribute('y2')).toBe('292');
    expect(lines[1].getAttribute('y1')).toBe('508');
  });

});
