import {afterEach,expect,it,vi} from 'vitest';
import {searchAccountAliasHandles} from "@/lib/utils";
afterEach(()=>vi.unstubAllGlobals());
it('uses the alias search API and current account claims, excluding ended, deprecated and unsafe handles',async()=>{
 const claim=(value:string,extra={})=>({mainsnak:{datavalue:{value}},...extra});
 const fetcher=vi.fn().mockImplementation(async(raw:string)=>{
  const url=new URL(raw),action=url.searchParams.get('action');
  return new Response(JSON.stringify(action==='wbsearchentities'?{search:[{id:'Q123'},{id:'bad'}]}:action==='query'?{query:{pages:{1:{pageprops:{wikibase_item:'Q123'}}}}}:{entities:{Q123:{claims:{P2002:[claim('OfficialAccount',{rank:'preferred'}),claim('OldAccount',{qualifiers:{P582:[{}]}}),claim('Deprecated',{rank:'deprecated'}),claim('javascript:bad')]}}}}));
 });
 vi.stubGlobal('fetch',fetcher);
 expect(await searchAccountAliasHandles('別名APIテスト')).toEqual(['OfficialAccount']);
 const first=new URL(fetcher.mock.calls[0][0]);expect(first.searchParams.get('action')).toBe('wbsearchentities');expect(first.searchParams.get('search')).toBe('別名APIテスト');
 expect(new URL(fetcher.mock.calls[2][0]).searchParams.get('ids')).toBe('Q123');
 await searchAccountAliasHandles('別名APIテスト');expect(fetcher).toHaveBeenCalledTimes(3);
});
it('does not submit handles, empty terms or search operators to the alias API',async()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 for(const query of ['','a','@known','from:known','https://example.com'])expect(await searchAccountAliasHandles(query)).toEqual([]);
 expect(fetcher).not.toHaveBeenCalled();
});
it('does not break ordinary account searches when the alias API fails',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));
 expect(await searchAccountAliasHandles('別名API障害')).toEqual([]);
});
it('cancels before reading an obsolete query',async()=>{
 const controller=new AbortController();controller.abort();const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 await expect(searchAccountAliasHandles('キャンセル別名',controller.signal)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
});

it('resolves Wikipedia nickname redirects even when Wikidata label search misses them',async()=>{
 const fetcher=vi.fn().mockImplementation(async(raw:string)=>{
  const url=new URL(raw),action=url.searchParams.get('action');
  return new Response(JSON.stringify(action==='wbsearchentities'?{search:[]}:action==='query'?{query:{redirects:[{from:'愛称',to:'正式名称'}],pages:{1:{pageprops:{wikibase_item:'Q999'}}}}}:{entities:{Q999:{claims:{P2002:[{mainsnak:{datavalue:{value:'CanonicalUser'}}}]}}}}));
 });
 vi.stubGlobal('fetch',fetcher);expect(await searchAccountAliasHandles('別名リダイレクト')).toEqual(['CanonicalUser']);
 expect(fetcher.mock.calls.some(([raw])=>new URL(raw).hostname==='ja.wikipedia.org')).toBe(true);
});
