import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({viewer:'viewer',loaded:0}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:fixture.viewer}})}));
vi.mock('@/components/stickers/Stickers',async()=>({OfflineBookmarkContext:(await import('react')).createContext(null)}));
vi.mock('./MediaLightbox',()=>{fixture.loaded++;return{MediaLightbox:({selection,onClose}:any)=><section role="dialog"><span>{selection.url}</span><button onClick={onClose}>閉じる</button></section>};});
import {MediaLightboxRoot} from './MediaLightboxRoot';
import {openMediaViewer} from './openMediaViewer';
afterEach(cleanup);
it('keeps the first open event while lazily loading the viewer and closes on account changes',async()=>{
 const ui=()=> <MemoryRouter><MediaLightboxRoot/></MemoryRouter>;
 const view=render(ui());expect(fixture.loaded).toBe(0);
 act(()=>openMediaViewer({url:'https://example.com/first.jpg'}));expect(await screen.findByText('https://example.com/first.jpg')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'閉じる'}));expect(screen.queryByRole('dialog')).toBeNull();
 act(()=>openMediaViewer({url:'https://example.com/second.jpg'}));await screen.findByText('https://example.com/second.jpg');
 fixture.viewer='another-viewer';view.rerender(ui());expect(screen.queryByRole('dialog')).toBeNull();
});
