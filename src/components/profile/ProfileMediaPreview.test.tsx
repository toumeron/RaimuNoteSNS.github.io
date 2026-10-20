vi.mock("@/lib/mediaThumbnail", async importOriginal => {
 const actual = await importOriginal<typeof import("@/lib/mediaThumbnail")>();
 return {...actual, ...await (async importOriginal => ({...await importOriginal<typeof import("@/lib/mediaThumbnail")>(), resolvePostVideoPoster:m.poster}))(importOriginal)};
});


import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({setVisibility:((value:boolean)=>{}) as (value:boolean)=>void,visible:false,poster:vi.fn(),options:vi.fn()}));
vi.mock('react-intersection-observer',async()=>{const {useState}=await import('react');return {useInView:(options:unknown)=>{const [inView,setInView]=useState(false);m.setVisibility=setInView;m.options(options);return {ref:()=>{},inView};}};});

import { ProfileMediaPreview } from "@/components/ui/avatar";
beforeEach(()=>{
 m.visible=false;vi.clearAllMocks();m.poster.mockResolvedValue('blob:poster');
 const NativeURL=globalThis.URL;vi.stubGlobal('URL',class extends NativeURL{static revokeObjectURL=vi.fn();});
 vi.stubGlobal('IntersectionObserver',class{constructor(private callback:IntersectionObserverCallback){}observe(){this.callback([{isIntersecting:true}] as IntersectionObserverEntry[],this as unknown as IntersectionObserver);}disconnect(){}});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('mounts only nearby grid images using a thumbnail and releases them offscreen',()=>{
 const src='https://pbs.twimg.com/media/photo.jpg?name=orig';const view=render(<ProfileMediaPreview src={src}/>);
 expect(view.container.querySelector('img')).toBeNull();expect(m.options).toHaveBeenCalledWith({initialInView:false,rootMargin:'400px 0px'});
 act(()=>m.setVisibility(true));view.rerender(<ProfileMediaPreview src={src}/>);expect(view.container.querySelector('img')).toHaveAttribute('src','https://pbs.twimg.com/media/photo.jpg?name=small');
 act(()=>m.setVisibility(false));view.rerender(<ProfileMediaPreview src={src}/>);expect(view.container.querySelector('img')).toBeNull();expect(src).toContain('name=orig');
});
it('never fetches distant native video posters and revokes nearby poster blobs when they leave view',async()=>{
 const view=render(<ProfileMediaPreview postId="video" duration={16}/>);expect(m.poster).not.toHaveBeenCalled();
 act(()=>m.setVisibility(true));view.rerender(<ProfileMediaPreview postId="video" duration={16}/>);await screen.findByAltText('動画のプレビュー');expect(m.poster).toHaveBeenCalledTimes(1);
 const signal=m.poster.mock.calls[0][1] as AbortSignal;
 act(()=>m.setVisibility(false));view.rerender(<ProfileMediaPreview postId="video" duration={16}/>);
 await waitFor(()=>expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:poster'));expect(signal.aborted).toBe(true);expect(screen.queryByAltText('動画のプレビュー')).toBeNull();
});
it('does not mount offscreen external video thumbnails or load video files',()=>{
 const view=render(<ProfileMediaPreview postId="x:10" duration={10} external thumbnail="https://pbs.twimg.com/thumb.jpg"/>);
 expect(view.container.querySelector('img')).toBeNull();expect(m.poster).not.toHaveBeenCalled();
 act(()=>m.setVisibility(true));view.rerender(<ProfileMediaPreview postId="x:10" duration={10} external thumbnail="https://pbs.twimg.com/thumb.jpg"/>);
 expect(screen.getByAltText('動画のプレビュー')).toHaveAttribute('loading','lazy');expect(m.poster).not.toHaveBeenCalled();expect(view.container.querySelector('video')).toBeNull();
});
