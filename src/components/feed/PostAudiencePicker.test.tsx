import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const mode = vi.hoisted(() => ({mobile: true}));
vi.mock('@/hooks/useViewportWidth', async original => ({...await original<typeof import('@/hooks/useViewportWidth')>(),useIsMobile: () => mode.mobile}));
import { PostAudiencePicker } from './PostAudiencePicker';
import { PostComposerFrame } from './PostComposerFrame';
import type { Community } from '@/api/communities';
const community = {id:'one',name:'テストの会',cover_url:'https://res.cloudinary.com/demo/image/upload/cover.jpg',member_count:12} as Community;
const base = {trigger:<button type="button">公開範囲を選択</button>,visibility:'public' as const, communities:[community],disabled:false,onSelect:vi.fn()};
afterEach(() => {cleanup();vi.restoreAllMocks();mode.mobile=true;base.onSelect.mockReset();});
it('opens a bottom sheet with the real audiences, community cover and member count', () => {
 render(<PostAudiencePicker {...base}><span>desktop</span></PostAudiencePicker>);
 fireEvent.click(screen.getByRole('button',{name:'公開範囲を選択'}));
 expect(screen.getByRole('dialog')).toHaveAttribute('data-lime-audience-sheet');
 expect(screen.getByText('12人のメンバー')).toBeInTheDocument();
 expect(screen.queryByText(/サークル/)).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'全員'})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByRole('button',{name:/テストの会/}));
 expect(base.onSelect).toHaveBeenCalledWith('public','one');
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('changes the existing restricted audience without inventing a circle', () => {
 render(<PostAudiencePicker {...base} communityId="one" canPostMembersOnly><span>desktop</span></PostAudiencePicker>);
 fireEvent.click(screen.getByRole('button',{name:'公開範囲を選択'}));
 expect(screen.getByRole('button',{name:/テストの会/})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByRole('button',{name:/フォロー中/}));
 expect(base.onSelect).toHaveBeenCalledWith('following',undefined);
});
it('keeps community quotes scoped to their source and hides unavailable member-only options', () => {
 render(<PostAudiencePicker {...base} communityId="one" quotedCommunityId="one" communities={[community,{...community,id:'two',name:'別の会'}]}><span>desktop</span></PostAudiencePicker>);
 fireEvent.click(screen.getByRole('button',{name:'公開範囲を選択'}));
 expect(screen.getByRole('button',{name:'全員'})).toBeDisabled();
 expect(screen.getByRole('button',{name:/別の会/})).toBeDisabled();
 expect(screen.getByRole('button',{name:/テストの会/})).toBeEnabled();
 expect(screen.queryByText('メンバー限定')).not.toBeInTheDocument();
});
it('retains the desktop menu and does not open before draft hydration', () => {
 mode.mobile=false;
 const view=render(<PostAudiencePicker {...base}><span>desktop</span></PostAudiencePicker>);
 expect(screen.getByText('desktop')).toBeInTheDocument();
 mode.mobile=true;view.rerender(<PostAudiencePicker {...base} disabled trigger={<button disabled>公開範囲を選択</button>}><span>desktop</span></PostAudiencePicker>);
 expect(screen.getByRole('button',{name:'公開範囲を選択'})).toBeDisabled();
});
it('Escape dismisses only the audience sheet while composing', () => {
 const close=vi.fn();
 render(<PostComposerFrame isOpen onClose={close}>{()=><PostAudiencePicker {...base}><span>desktop</span></PostAudiencePicker>}</PostComposerFrame>);
 fireEvent.click(screen.getByRole('button',{name:'公開範囲を選択'}));
 fireEvent.keyDown(screen.getAllByRole('dialog').at(-1)!,{key:'Escape'});
 expect(close).not.toHaveBeenCalled();
 expect(document.querySelector('[data-lime-audience-sheet]')).not.toBeInTheDocument();
});

it('closes from the handle on tap or a downward drag, but not a small drag', () => {
 render(<PostAudiencePicker {...base}><span>desktop</span></PostAudiencePicker>);
 const open=()=>fireEvent.click(screen.getByRole('button',{name:'公開範囲を選択'}));
 const pointer=(target:HTMLElement,type:string,y:number)=>{const event=new Event(type,{bubbles:true});Object.assign(event,{clientY:y,pointerId:1});fireEvent(target,event);};
 open();fireEvent.click(screen.getByRole('button',{name:'公開範囲の選択を閉じる'}));expect(screen.queryByRole('dialog')).toBeNull();
 open();let handle=screen.getByRole('button',{name:'公開範囲の選択を閉じる'});
 pointer(handle,'pointerdown',20);pointer(handle,'pointermove',45);pointer(handle,'pointerup',45);fireEvent.click(handle);
 expect(screen.getByRole('dialog')).toBeInTheDocument();
 pointer(handle,'pointerdown',20);pointer(handle,'pointermove',130);pointer(handle,'pointerup',130);
 expect(screen.queryByRole('dialog')).toBeNull();
});
