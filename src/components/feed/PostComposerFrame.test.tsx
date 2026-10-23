import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PostComposerFrame } from './PostComposerFrame';
afterEach(() => {cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('keeps one mobile frame while content loads and follows the keyboard viewport without remounting', () => {
 vi.spyOn(window,'matchMedia').mockReturnValue({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()} as unknown as MediaQueryList);
 const viewport=Object.assign(new EventTarget(),{height:780,offsetTop:0});
 vi.stubGlobal('visualViewport',viewport);vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
 const close=vi.fn();const view=render(<PostComposerFrame isOpen onClose={close}>{()=> <p>読み込み中</p>}</PostComposerFrame>);
 const frame=screen.getByRole('dialog');expect(frame).toHaveStyle({height:'780px',top:'0px'});
 view.rerender(<PostComposerFrame isOpen onClose={close}>{()=> <textarea aria-label="本文"/>}</PostComposerFrame>);
 expect(screen.getByRole('dialog')).toBe(frame);expect(screen.getByLabelText('本文')).toBeInTheDocument();
 viewport.height=420;viewport.offsetTop=35;viewport.dispatchEvent(new Event('resize'));
 expect(frame).toHaveStyle({height:'420px',maxHeight:'420px',top:'35px'});
 expect(document.body.style.position).toBe('fixed');
 view.unmount();expect(document.body.style.position).toBe('');
});
