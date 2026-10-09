import {cleanup,renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,expect,it,vi} from 'vitest';
const load=vi.hoisted(()=>vi.fn());
vi.mock('@/api/search-news',()=>({getLatestSearchNews:load}));
import {useSearchNews} from './useSearchNews';
afterEach(()=>{cleanup();vi.clearAllMocks();});
const result={items:[{id:'article'}],sources:{article:{authors:[{id:'author',avatarUrl:'avatar.jpg'}],postsCount:1}}};
it('keeps article and avatars together on remount without reloading originals',async()=>{
 load.mockResolvedValue(result);
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const wrapper=({children}:any)=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
 const first=renderHook(()=>useSearchNews('viewer'),{wrapper});
 await waitFor(()=>expect(first.result.current.data).toEqual(result));first.unmount();
 const second=renderHook(()=>useSearchNews('viewer'),{wrapper});
 expect(second.result.current.data).toEqual(result);expect(second.result.current.isPending).toBe(false);
 await new Promise(resolve=>setTimeout(resolve,20));expect(load).toHaveBeenCalledTimes(1);
 second.unmount();client.clear();
});
it('does not reuse another viewers source metadata after account switching',async()=>{
 load.mockResolvedValueOnce(result).mockResolvedValueOnce({items:[],sources:{}});
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const wrapper=({children}:any)=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
 const view=renderHook(({id})=>useSearchNews(id),{wrapper,initialProps:{id:'viewer-a'}});
 await waitFor(()=>expect(view.result.current.data).toEqual(result));view.rerender({id:'viewer-b'});
 expect(view.result.current.data).toBeUndefined();
 await waitFor(()=>expect(view.result.current.data).toEqual({items:[],sources:{}}));expect(load).toHaveBeenCalledTimes(2);
 view.unmount();client.clear();
});
