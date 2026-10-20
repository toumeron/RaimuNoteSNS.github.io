import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NotificationRow } from '@/api/users';
const state=vi.hoisted(()=>({read:vi.fn(),get:vi.fn(),sharing:false,account:vi.fn(),sharedRows:[] as NotificationRow[],counts:{a:1,b:1} as Record<string,number>}));
vi.mock('@/api/users',async original=>({...await original<typeof import('@/api/users')>(),getNotifications:state.get,markAllNotificationsRead:state.read}));
vi.mock('@/lib/externalAccounts',async original=>({...await original<typeof import('@/lib/externalAccounts')>(),useSharedDisplay:()=>state.sharing}));
vi.mock('@/lib/accountReadClient',async original=>({...await original<typeof import('@/lib/accountReadClient')>(),getAccountReadClient:state.account}));
vi.mock('@/hooks/useSharedAccountLists',async original=>({...await original<typeof import('@/hooks/useSharedAccountLists')>(),useSharedNotifications:(enabled:boolean)=>useInfiniteQuery({queryKey:['notifications','shared','a'],enabled,initialPageParam:0,queryFn:async()=>({items:state.sharedRows}),getNextPageParam:()=>undefined})}));
vi.mock('@/hooks/useAuth',async original=>({...await original<typeof import('@/hooks/useAuth')>(),useAuth:()=>({user:{id:'a'},accounts:[{id:'b'}]})}));
vi.mock('@/lib/supabase',()=>({supabase:{channel:()=>{const c={on:()=>c,subscribe:()=>c};return c;},removeChannel:vi.fn()}}));
import { Notifications } from '@/pages/Topics';
let client:QueryClient;
const row=(owner:string,type:NotificationRow['type']='new_post'):NotificationRow=>({id:`${owner}-${type}`,user_id:owner,actor_name:owner==='a'?'Own':'Other',actor_id:'actor',actor_avatar_url:null,post_id:'post',type,created_at:'2026-10-11',is_read:false,content_preview:null});
function Count({owner}:{owner:string}){const query=useQuery({queryKey:['notification-unread-count',owner],queryFn:async()=>state.counts[owner]});return query.data?<span data-testid={`badge-${owner}`}>{query.data}</span>:null;}
const tree=(path='/notifications')=><MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}><Count owner="a"/><Count owner="b"/><Notifications/></QueryClientProvider></MemoryRouter>;
beforeEach(()=>{
 state.sharing=true;state.sharedRows=[row('a'),row('b')];state.counts={a:1,b:1};
 state.account.mockReset().mockResolvedValue({account:'b'});
 state.read.mockReset().mockImplementation(async(owner:string)=>{state.counts[owner]=0;});
 state.get.mockReset().mockResolvedValue([row('a')]);
 client=new QueryClient({defaultOptions:{queries:{retry:false}}});
});
afterEach(()=>{cleanup();client.clear();});
it('marks shared notifications with each receiving account and clears both unread badges',async()=>{
 render(tree());
 await screen.findByText('Other');
 await waitFor(()=>expect(state.read).toHaveBeenCalledWith('a',undefined));
 await waitFor(()=>expect(state.read).toHaveBeenCalledWith('b',{client:{account:'b'},userId:'b'}));
 await waitFor(()=>{expect(screen.queryByTestId('badge-a')).not.toBeInTheDocument();expect(screen.queryByTestId('badge-b')).not.toBeInTheDocument();});
 expect(state.account).toHaveBeenCalledWith('b');expect(state.account.mock.calls.every(call=>call[0]==='b')).toBe(true);expect(state.get).not.toHaveBeenCalled();
 expect(client.getQueryData<any>(['notifications','shared','a']).pages[0].items.every((n:NotificationRow)=>n.is_read)).toBe(true);
 expect(new Set(state.read.mock.calls.map(call=>call[0]))).toEqual(new Set(['a','b']));
});
it('keeps own-account read behavior when shared display is off',async()=>{
 state.sharing=false;render(tree());await screen.findByText('Own');
 await waitFor(()=>expect(state.read).toHaveBeenCalledWith('a',undefined));
 await waitFor(()=>expect(screen.queryByTestId('badge-a')).not.toBeInTheDocument());
 expect(screen.getByTestId('badge-b')).toHaveTextContent('1');expect(state.account).not.toHaveBeenCalled();
});
it('marks every kind on entry even on the mention tab and preserves failed reads',async()=>{
 state.sharedRows=[row('a','mention'),row('a','like'),row('b','mention')];state.read.mockImplementation(async(owner:string)=>{if(owner==='b')throw new Error('offline');});
 render(tree('/notifications?tab=mention'));
 await screen.findByText('Other');
 await waitFor(()=>expect(new Set(state.read.mock.calls.map(call=>call[0]))).toEqual(new Set(['a','b'])));
 expect([...new Set(state.read.mock.calls.map(call=>call[0]))].sort()).toEqual(['a','b']);
 await waitFor(()=>expect(client.getQueryData<any>(['notifications','shared','a']).pages[0].items[0].is_read).toBe(true));
 const rows=client.getQueryData<any>(['notifications','shared','a']).pages[0].items;
 expect(rows[1].is_read).toBe(true);expect(rows[2].is_read).toBe(false);expect(screen.getByTestId('badge-b')).toHaveTextContent('1');
});
it('does not duplicate a pending read when the shared list rerenders',async()=>{
 let finish!:()=>void;state.read.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));state.sharedRows=[row('a')];
 state.sharing=false;const view=render(tree());await waitFor(()=>expect(state.read).toHaveBeenCalledTimes(1));
 act(()=>{client.setQueryData<any>(['notifications','a'],(data:any)=>data?({...data,pages:data.pages.map((page:NotificationRow[])=>page.map(n=>({...n})))}):data);view.rerender(tree());});
 expect(state.read).toHaveBeenCalledTimes(1);await act(async()=>finish());
});

it('bulk reads on page entry before a notification page loads, including older unloaded pages',async()=>{
 state.sharing=false;state.counts.a=126;state.get.mockImplementation(()=>new Promise(()=>{}));
 render(tree());
 await waitFor(()=>expect(state.read).toHaveBeenCalledExactlyOnceWith('a',undefined));
 await waitFor(()=>expect(screen.queryByTestId('badge-a')).not.toBeInTheDocument());
 expect(screen.getByText('読み込み中...')).toBeInTheDocument();
});
