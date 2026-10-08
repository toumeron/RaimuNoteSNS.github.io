import {beforeEach,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({session:{} as object|null,invoke:vi.fn()}));
vi.mock('./supabase',()=>({supabase:{auth:{getSession:async()=>({data:{session:fixture.session}})},functions:{invoke:fixture.invoke}}}));
import {misskeyRequest,misskeyProfile} from './misskey';
beforeEach(()=>{fixture.session={};fixture.invoke.mockReset();vi.unstubAllGlobals();});
it('uses the existing authenticated relay without a cross-origin browser request',async()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 fixture.invoke.mockResolvedValue({data:{data:[{id:'local',username:'cat'}]},error:null});
 expect(await misskeyRequest('users/search',{query:'cat',i:'do-not-forward'})).toEqual([{id:'local',username:'cat'}]);
 expect(fetcher).not.toHaveBeenCalled();
 expect(fixture.invoke).toHaveBeenCalledWith('link-preview',expect.objectContaining({body:{mode:'misskey',endpoint:'users/search',params:{query:'cat'}}}));
});
it('treats an absent exact user as a search miss rather than invalid profile data',async()=>{
 fixture.invoke.mockResolvedValue({data:{data:null},error:null});
 await expect(misskeyProfile('missing-relay-test@misskey.io')).rejects.toThrow('見つかりません');
});
it('keeps signed-out public reads available',async()=>{
 fixture.session=null;const fetcher=vi.fn().mockResolvedValue(new Response('[]'));vi.stubGlobal('fetch',fetcher);
 expect(await misskeyRequest('notes/local-timeline')).toEqual([]);
 expect(fetcher).toHaveBeenCalledWith('https://misskey.io/api/notes/local-timeline',expect.anything());
 expect(fixture.invoke).not.toHaveBeenCalled();
});
