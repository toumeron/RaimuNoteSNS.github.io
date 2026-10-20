vi.mock("@/api/users", async importOriginal => {
 const actual = await importOriginal<typeof import("@/api/users")>();
 return {...actual, ...await (async importOriginal => ({...await importOriginal<typeof import("@/api/users")>(), getList:mocks.list, getLists:vi.fn(), listsKey:(id:string)=>['user-lists',id]}))(importOriginal)};
});

vi.mock("@/hooks/useAuth", async importOriginal => ({...await importOriginal<typeof import("@/hooks/useAuth")>(), useAuth:()=>({user:{id:'viewer'}})}));

import {act,renderHook,waitFor,cleanup} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({list:vi.fn(),native:vi.fn(),external:vi.fn()}));


vi.mock('@/api/posts',()=>({getListNativePosts:mocks.native}));
vi.mock('@/lib/bluesky',()=>({fetchBlueskyAuthorFeed:mocks.external}));
import { useListFeed } from "@/hooks/useTopics";
afterEach(cleanup);
it('reads only list members and merges native/external posts in newest-first order',async()=>{
 const nativeId='11111111-1111-4111-8111-111111111111';mocks.list.mockResolvedValue({updated_at:'v1',members:[{id:nativeId,username:'native'},{id:'did:plc:abc',username:'friend.bsky.social'},{id:'misskey-user:xyz',username:'friend@misskey.io'}]});
 mocks.native.mockResolvedValue([{id:'native-post',createdAt:'2026-10-11T01:00:00Z'}]);mocks.external.mockImplementation(async({actor}:{actor:string})=>({posts:[{id:actor,createdAt:actor.startsWith('did:')?'2026-10-12T01:00:00Z':'2026-10-10T01:00:00Z',author:{id:actor,username:actor,displayName:actor}}],cursor:null}));
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const wrapper=({children}:{children:React.ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;const result=renderHook(()=>useListFeed('list-id'),{wrapper});
 await waitFor(()=>expect(result.result.current.data?.pages[0].posts.length).toBe(3));expect(mocks.native).toHaveBeenCalledWith([nativeId],0,10,undefined,expect.any(AbortSignal));expect(mocks.external.mock.calls.map(call=>call[0].actor).sort()).toEqual(['did:plc:abc','friend@misskey.io']);expect(result.result.current.data!.pages[0].posts.map(post=>post.id)).toEqual(['did:plc:abc','native-post','friend@misskey.io']);expect(result.result.current.hasNextPage).toBe(false);
});

it('publishes delayed list members without requiring another scroll or page request',async()=>{
 const nativeId='11111111-1111-4111-8111-111111111111';
 mocks.list.mockResolvedValue({updated_at:'late-test',members:[{id:nativeId,username:'native'},{id:'did:plc:slow',username:'slow.bsky.social'}]});
 mocks.native.mockResolvedValue([{id:'native-ready',createdAt:'2026-10-20T01:00:00Z'}]);
 let finish!:(value:any)=>void;mocks.external.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const wrapper=({children}:{children:React.ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
 const query=renderHook(()=>useListFeed('late-list'),{wrapper});
 await waitFor(()=>expect(query.result.current.data?.pages[0].posts.map(p=>p.id)).toEqual(['native-ready']),{timeout:2500});
 await act(async()=>{finish({posts:[{id:'delayed-member',createdAt:'2026-10-20T02:00:00Z',author:{id:'slow',username:'slow',displayName:'Slow'}}],cursor:null});});
 await waitFor(()=>expect(query.result.current.data?.pages[0].posts.map(p=>p.id)).toContain('delayed-member'));
 expect(query.result.current.hasNextPage).toBe(false);query.unmount();client.clear();
});
