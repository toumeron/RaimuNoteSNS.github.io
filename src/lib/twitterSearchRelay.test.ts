import{beforeEach,it,expect,vi}from'vitest';
const mocks=vi.hoisted(()=>({session:vi.fn(),invoke:vi.fn()}));
vi.mock('./supabase',()=>({supabase:{auth:{getSession:mocks.session},functions:{invoke:mocks.invoke}}}));
import { relayTwitterSearch } from "@/api/search-news";
beforeEach(()=>{vi.clearAllMocks();mocks.session.mockResolvedValue({data:{session:{user:{id:'viewer'}}}});});
it('sends only search parameters to the existing authenticated reader',async()=>{mocks.invoke.mockResolvedValue({data:{ids:['123','bad','456'],cursor:12},error:null});const signal=new AbortController().signal;expect(await relayTwitterSearch('JR東日本','latest',6,signal)).toEqual({ids:['123','456'],cursor:12});expect(mocks.invoke).toHaveBeenCalledWith('link-preview',{body:{mode:'twitter-search',query:'JR東日本',feed:'latest',offset:6},signal});});
it('does not attempt anonymous relay access',async()=>{mocks.session.mockResolvedValue({data:{session:null}});await expect(relayTwitterSearch('cat','top',0)).rejects.toThrow('ログイン');expect(mocks.invoke).not.toHaveBeenCalled();});
it('does not treat a failed relay as an empty search result',async()=>{mocks.invoke.mockResolvedValue({data:null,error:new Error('unavailable')});await expect(relayTwitterSearch('cat','top',0)).rejects.toThrow('検索結果');});

it('requests and retains up to twenty IDs for the visible search page',async()=>{
 const ids=Array.from({length:20},(_,i)=>String(7000+i));mocks.invoke.mockResolvedValue({data:{ids,cursor:20},error:null});
 const page=await relayTwitterSearch('キオクシア','top',0,undefined,20);
 expect(page.ids).toEqual(ids);expect(page.cursor).toBe(20);
 expect(mocks.invoke).toHaveBeenCalledWith('link-preview',{body:{mode:'twitter-search',query:'キオクシア',feed:'top',offset:0,limit:20},signal:undefined});
});
