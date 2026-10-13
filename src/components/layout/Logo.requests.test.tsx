import {cleanup,render,waitFor,act} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({viewer:'viewer',read:vi.fn(async()=>({data:{feature:'limepro'},error:null})),authRead:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:state.viewer}})}));
vi.mock('@/lib/supabase',()=>({supabase:{auth:{getUser:state.authRead},from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:state.read})})})})}}));
import {Logo} from './Logo';
afterEach(()=>{cleanup();localStorage.clear();state.read.mockClear();state.authRead.mockClear();state.viewer='viewer';});
it('shares the entitlement request between logos and repeated focus events without another auth read',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const view=render(<QueryClientProvider client={client}><MemoryRouter><Logo/><Logo/></MemoryRouter></QueryClientProvider>);
 await waitFor(()=>expect(state.read).toHaveBeenCalledTimes(1));
 await act(async()=>{for(let i=0;i<30;i++)window.dispatchEvent(new Event('focus'));});
 expect(state.read).toHaveBeenCalledTimes(1);expect(state.authRead).not.toHaveBeenCalled();
 state.viewer='other';view.rerender(<QueryClientProvider client={client}><MemoryRouter><Logo/><Logo/></MemoryRouter></QueryClientProvider>);
 await waitFor(()=>expect(state.read).toHaveBeenCalledTimes(2));view.unmount();client.clear();
});
