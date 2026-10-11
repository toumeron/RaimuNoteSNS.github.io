import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({user:'a',accounts:[{id:'a',needsLogin:false},{id:'b',needsLogin:false},{id:'expired',needsLogin:true}],client:vi.fn(),bookmarks:vi.fn(),notifications:vi.fn()}));
vi.mock("@/hooks/useSharedListUpdates",()=>({useSharedListUpdates:vi.fn()}));
vi.mock('./useAuth',()=>({useAuth:()=>({user:{id:state.user},accounts:state.accounts})}));
vi.mock('@/lib/accountReadClient',async importOriginal=>({...await importOriginal<typeof import('@/lib/accountReadClient')>(),getAccountReadClient:state.client}));
vi.mock('@/api/bookmarks',()=>({getBookmarkPage:state.bookmarks}));
vi.mock('@/api/notifications',()=>({getNotifications:state.notifications}));
import { useSharedBookmarks, useSharedNotifications } from './useSharedAccountLists';
const clients:QueryClient[]=[];
function wrapper(){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});clients.push(client);return ({children}:any)=><QueryClientProvider client={client}>{children}</QueryClientProvider>;}
beforeEach(()=>{state.user='a';state.accounts=[{id:'a',needsLogin:false},{id:'b',needsLogin:false},{id:'expired',needsLogin:true}];state.client.mockReset().mockImplementation(async id=>({owner:id}));state.bookmarks.mockReset().mockImplementation(async id=>({entries:[{post:{id:'same'},savedAt:id==='b'?'2026-10-11':'2026-10-10',bookmarkId:id}]}));state.notifications.mockReset().mockImplementation(async id=>[{id:'event-'+id,user_id:id,created_at:id==='b'?'2026-10-11':'2026-10-10'}]);});
afterEach(()=>{cleanup();clients.forEach(c=>c.clear());clients.length=0;});
it('aggregates and deduplicates bookmarks using each logged-in owner, and excludes expired accounts',async()=>{
 const view=renderHook(()=>useSharedBookmarks(true),{wrapper:wrapper()});
 await waitFor(()=>expect(view.result.current.isSuccess).toBe(true));
 expect(view.result.current.data?.pages[0].items.map(e=>e.post.id)).toEqual(['same']);
 expect(state.client.mock.calls.map(c=>c[0]).sort()).toEqual(['a','b']);
 for(const call of state.bookmarks.mock.calls)expect(call[3]).toMatchObject({userId:call[0],client:{owner:call[0]}});
});
it('does not request other account data when sharing is off',async()=>{
 const view=renderHook(()=>useSharedNotifications(false),{wrapper:wrapper()});
 expect(view.result.current.fetchStatus).toBe('idle');expect(state.client).not.toHaveBeenCalled();expect(state.notifications).not.toHaveBeenCalled();
});
it('merges notifications chronologically and removes an account immediately after it is forgotten',async()=>{
 const view=renderHook(()=>useSharedNotifications(true),{wrapper:wrapper()});
 await waitFor(()=>expect(view.result.current.isSuccess).toBe(true));
 expect(view.result.current.data?.pages[0].items.map(n=>n.user_id)).toEqual(['b','a']);
 state.accounts=[{id:'a',needsLogin:false}];view.rerender();
 await waitFor(()=>expect(view.result.current.isSuccess).toBe(true));
 expect(view.result.current.data?.pages[0].items.map(n=>n.user_id)).toEqual(['a']);
});
