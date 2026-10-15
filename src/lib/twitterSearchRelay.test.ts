import{beforeEach,it,expect,vi}from'vitest';
const mocks=vi.hoisted(()=>({session:vi.fn(),invoke:vi.fn()}));
vi.mock('./supabase',()=>({supabase:{auth:{getSession:mocks.session},functions:{invoke:mocks.invoke}}}));
import{relayTwitterSearch}from'./twitterSearchRelay';
beforeEach(()=>{vi.clearAllMocks();mocks.session.mockResolvedValue({data:{session:{user:{id:'viewer'}}}});});
it('sends only search parameters to the existing authenticated reader',async()=>{mocks.invoke.mockResolvedValue({data:{ids:['123','bad','456'],cursor:12},error:null});const signal=new AbortController().signal;expect(await relayTwitterSearch('JR東日本','latest',6,signal)).toEqual({ids:['123','456'],cursor:12});expect(mocks.invoke).toHaveBeenCalledWith('link-preview',{body:{mode:'twitter-search',query:'JR東日本',feed:'latest',offset:6},signal});});
it('does not attempt anonymous relay access',async()=>{mocks.session.mockResolvedValue({data:{session:null}});await expect(relayTwitterSearch('cat','top',0)).rejects.toThrow('ログイン');expect(mocks.invoke).not.toHaveBeenCalled();});
it('does not treat a failed relay as an empty search result',async()=>{mocks.invoke.mockResolvedValue({data:null,error:new Error('unavailable')});await expect(relayTwitterSearch('cat','top',0)).rejects.toThrow('検索結果');});
