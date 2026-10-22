import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({get:vi.fn(),callbacks:[] as (()=>void)[],removed:vi.fn()}));
vi.mock("@/lib/supabase", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(),
  getAccountReadClient:state.get
}));
import { useSharedListUpdates } from "@/hooks/useSharedAccountLists";
afterEach(()=>{cleanup();vi.clearAllMocks();state.callbacks=[];});
it('updates the open combined list from owner-scoped native events and closes readers when sharing turns off',async()=>{
 const owners:string[]=[];
 state.get.mockImplementation(async(id:string)=>({channel:()=>{const channel={on:(_type:string,filter:any,cb:()=>void)=>{expect(filter.filter).toBe(`user_id=eq.${id}`);owners.push(id);state.callbacks.push(cb);return channel;},subscribe:()=>channel};return channel;},removeChannel:state.removed}));
 const client=new QueryClient();const invalidate=vi.spyOn(client,'invalidateQueries');
 const wrapper=({children}:any)=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
 const view=renderHook(({enabled})=>useSharedListUpdates('notifications',['a','b'],enabled),{initialProps:{enabled:true},wrapper});
 await waitFor(()=>expect(owners).toEqual(['a','b']));
 state.callbacks[1]();expect(invalidate).toHaveBeenCalledWith({queryKey:['notifications','shared']});expect(invalidate).toHaveBeenCalledWith({queryKey:['notification-unread-count','b'],exact:true});
 view.rerender({enabled:false});expect(state.removed).toHaveBeenCalledTimes(2);client.clear();
});
it('does not connect when sharing is disabled',()=>{
 const client=new QueryClient();renderHook(()=>useSharedListUpdates('bookmarks',['a','b'],false),{wrapper:({children}:any)=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
 expect(state.get).not.toHaveBeenCalled();client.clear();
});
