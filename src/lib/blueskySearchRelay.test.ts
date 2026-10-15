import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({session:vi.fn(),invoke:vi.fn()}));
vi.mock('./supabase',()=>({supabase:{auth:{getSession:mocks.session},functions:{invoke:mocks.invoke}}}));
import {relayBlueskySearch} from './blueskySearchRelay';
beforeEach(()=>{vi.clearAllMocks();mocks.session.mockResolvedValue({data:{session:{user:{id:'viewer'}}}});});
it('relays the query and cursor through the authenticated function without provider credentials',async()=>{
 mocks.invoke.mockResolvedValue({data:{data:{posts:[],cursor:'next'}},error:null});const signal=new AbortController().signal;
 const response=await relayBlueskySearch('app.bsky.feed.searchPosts',new URLSearchParams({q:'JR東日本',cursor:'before'}),signal);
 expect(await response?.json()).toEqual({posts:[],cursor:'next'});
 expect(mocks.invoke).toHaveBeenCalledWith('link-preview',{body:{mode:'bluesky',endpoint:'app.bsky.feed.searchPosts',params:{q:'JR東日本',cursor:'before'}},signal});
});
it('does not invoke an authenticated relay without a LimeNote session',async()=>{mocks.session.mockResolvedValue({data:{session:null}});expect(await relayBlueskySearch('app.bsky.feed.searchPosts',new URLSearchParams({q:'test'}))).toBeNull();expect(mocks.invoke).not.toHaveBeenCalled();});
it('keeps a relay failure visible instead of claiming an empty result',async()=>{mocks.invoke.mockResolvedValue({data:null,error:new Error('offline')});await expect(relayBlueskySearch('app.bsky.feed.searchPosts',new URLSearchParams({q:'test'}))).rejects.toThrow('Bluesky検索');});
