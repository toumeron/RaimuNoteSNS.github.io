import {beforeEach,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({select:vi.fn(),eq:vi.fn(),read:vi.fn()}));
vi.mock("@/lib/supabase", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(),
  supabase:{from:(table:string)=>{const query={select:(...args:unknown[])=>{fixture.select(table,...args);return query;},eq:(...args:unknown[])=>{fixture.eq(...args);return query;},abortSignal:fixture.read};return query;}}
}));
import {getPostQuoteCount} from './posts';
beforeEach(()=>{vi.clearAllMocks();fixture.read.mockResolvedValue({count:27,error:null});});
it('counts visible quotes without downloading posts or altering their permissions',async()=>{
 const controller=new AbortController();
 expect(await getPostQuoteCount('native-post',controller.signal)).toBe(27);
 expect(fixture.select).toHaveBeenCalledWith('posts','id',{count:'exact',head:true});
 expect(fixture.eq.mock.calls).toEqual([['parent_id','native-post'],['is_quote',true]]);
 expect(fixture.read).toHaveBeenCalledWith(controller.signal);
});
it('preserves a failed count instead of reporting a false zero',async()=>{
 fixture.read.mockResolvedValue({count:null,error:new Error('unavailable')});
 await expect(getPostQuoteCount('native-post')).rejects.toThrow('unavailable');
});
