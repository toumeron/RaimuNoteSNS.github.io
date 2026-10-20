import {afterEach,expect,it,vi} from 'vitest';
import {searchTermSuggestions} from './searchTermSuggestions';
afterEach(()=>vi.unstubAllGlobals());
it('returns up to two related search phrases, distinct from accounts and the entered query',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(['あ',['あ','あいの里','芦田愛菜','あいの里','あいの里3']])));
 expect(await searchTermSuggestions('あ')).toEqual(['あいの里','あいの里3']);
});
it('does not fill empty suggestions with unrelated terms',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(['候補なし',['無関係な候補']])));
 expect(await searchTermSuggestions('候補なし')).toEqual([]);
});
it('does not send account handles or search commands as phrase completions',async()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 expect(await searchTermSuggestions('@cat')).toEqual([]);
 expect(await searchTermSuggestions('from:cat')).toEqual([]);
 expect(fetcher).not.toHaveBeenCalled();
});
