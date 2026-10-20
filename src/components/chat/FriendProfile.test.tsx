import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, expect, it, vi, beforeEach } from "vitest";
import { FriendProfile, TypingPixelCat, MessagePixelCat, useMessagePixelCat } from "@/components/chat/FriendProfile";
import { findAssistant } from "@/lib/aiFriends";
import { useRef } from "react";

describe("FriendProfile", () => {
afterEach(() => { cleanup(); localStorage.clear(); });
it('persists profile fields on the existing friend and invokes talk and call actions', () => {
  const friend = findAssistant('owner', 'builtin:km170')!;
  const onClose = vi.fn(), onTalk = vi.fn(), onCall = vi.fn();
  render(<FriendProfile friend={friend} uid="owner" avatars={{}} onClose={onClose} onTalk={onTalk} onCall={onCall}/>);
  expect(document.body.style.overflow).toBe('hidden');
  fireEvent.click(screen.getByRole('button', { name: 'お気に入り' }));
  fireEvent.click(screen.getByRole('button', { name: 'プロフィールを編集' }));
  fireEvent.change(screen.getByLabelText('誕生日'), { target: { value: '2000-09-29' } });
  expect(findAssistant('owner', friend.id)).toMatchObject({ favorite: true, birthday: '09-29' });
  expect(screen.getByText('9/29')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'トーク' }));
  expect(onTalk).toHaveBeenCalledWith(expect.objectContaining({ id: friend.id }));
  fireEvent.click(screen.getByRole('button', { name: '音声通話' }));
  expect(onCall).toHaveBeenCalledOnce(); expect(onClose).toHaveBeenCalledTimes(2);
});
it('closes with Escape and restores document scrolling', () => {
  const onClose = vi.fn();
  const { unmount } = render(<FriendProfile friend={findAssistant('owner', 'builtin:km170')!} uid="owner" avatars={{}} onClose={onClose} onTalk={vi.fn()} onCall={vi.fn()}/>);
  fireEvent.keyDown(document, { key: 'Escape' }); expect(onClose).toHaveBeenCalledOnce();
  unmount(); expect(document.body.style.overflow).not.toBe('hidden');
});
});

describe("PixelCat", () => {
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
});
