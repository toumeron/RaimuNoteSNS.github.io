import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({loaded:0,finish:undefined as (()=>void)|undefined}));
vi.mock('./OverlayPostComposer',async()=>{
 fixture.loaded++;await new Promise<void>(resolve=>{fixture.finish=resolve;});
 return {PostOverlay:({onClose,initialQuotedPost}:any)=><section data-testid="loaded-composer"><span>{initialQuotedPost?.content}</span><button onClick={onClose}>投稿画面を閉じる</button></section>,PostComposer:({initialContent}:any)=><span>{initialContent}</span>};
});
import {PostOverlay,PostComposer} from "@/components/layout/AppLayout";
afterEach(cleanup);
it('does not load a closed composer, allows closing while loading, and preserves quote props on opening',async()=>{
 const close=vi.fn(),quote={content:'引用する本文'} as any;
 const view=render(<PostOverlay isOpen={false} onClose={close}/>);expect(fixture.loaded).toBe(0);
 view.rerender(<PostOverlay isOpen onClose={close} initialQuotedPost={quote}/>);
 await waitFor(()=>expect(fixture.loaded).toBe(1));fireEvent.click(screen.getByRole('button',{name:'閉じる'}));expect(close).toHaveBeenCalledOnce();
 view.rerender(<PostOverlay isOpen={false} onClose={close}/>);expect(screen.queryByRole('status')).toBeNull();
 await act(async()=>{fixture.finish!();});view.rerender(<PostOverlay isOpen onClose={close} initialQuotedPost={quote}/>);
 expect(await screen.findByText('引用する本文')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'投稿画面を閉じる'}));expect(close).toHaveBeenCalledTimes(2);
});
it('preserves the exported composer interface after splitting its code',async()=>{
 render(<PostComposer initialContent="下書きの本文"/>);expect(await screen.findByText('下書きの本文')).toBeTruthy();
});
