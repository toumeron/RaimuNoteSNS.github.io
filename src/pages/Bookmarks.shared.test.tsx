vi.mock("@/components/feed/PostCard", async importOriginal => ({...await importOriginal<typeof import("@/components/feed/PostCard")>(), PostCard:({post}:any)=><p>{post.content}</p>}));
vi.mock("@/api/users", async importOriginal => {
 const actual = await importOriginal<typeof import("@/api/users")>();
 return {...actual, ...await (async importOriginal => ({...await importOriginal<typeof import("@/api/users")>(), getBookmarkPage:state.get}))(importOriginal)};
});
vi.mock("@/components/post/CommentList", async importOriginal => ({...await importOriginal<typeof import("@/components/post/CommentList")>(), RepostedReplyCard:()=>null}));
vi.mock("@/lib/externalAccounts", async importOriginal => ({...await importOriginal<typeof import("@/lib/externalAccounts")>(), useSharedDisplay:()=>state.sharing}));
vi.mock("@/hooks/useSharedAccountLists", async importOriginal => {
 const actual = await importOriginal<typeof import("@/hooks/useSharedAccountLists")>();
 const overrides = [
  await (()=>({useSharedOfflineBookmarks:()=>({posts:[],context:null,checking:false}),useSharedBookmarks:()=>({data:{pages:[{items:[{post:{id:'b',content:'Other bookmark',author:{}}}]}]},isPending:false,isError:false})}))(),
  await (()=>({useOfflineBookmarks:()=>({pwa:false,online:true})}))()
 ];
 return Object.assign({}, actual, ...overrides.map(values => Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== actual[key]))));
});

vi.mock("@/hooks/useAuth", async importOriginal => ({...await importOriginal<typeof import("@/hooks/useAuth")>(), useAuth:()=>({user:{id:'a'}})}));


import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({sharing:true,get:vi.fn()}));







import Bookmarks from './Bookmarks';
afterEach(cleanup);
it('switches between the combined view and the original own-account view',async()=>{
 state.sharing=true;state.get.mockReset().mockResolvedValue({posts:[{id:'a',content:'Own bookmark',author:{}}],unavailable:0});
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const tree=()=> <MemoryRouter><QueryClientProvider client={client}><Bookmarks/></QueryClientProvider></MemoryRouter>;
 const view=render(tree());expect(screen.getByText('Other bookmark')).toBeInTheDocument();expect(state.get).not.toHaveBeenCalled();
 act(()=>{state.sharing=false;view.rerender(tree());});
 await waitFor(()=>expect(screen.getByText('Own bookmark')).toBeInTheDocument());
 expect(screen.queryByText('Other bookmark')).not.toBeInTheDocument();expect(state.get).toHaveBeenCalledWith('a',0);client.clear();
});
