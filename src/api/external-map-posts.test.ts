import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabase:{functions:{invoke:state.invoke}}}));
vi.mock('@/lib/utils',()=>({externalRead:async(read:()=>Promise<unknown>)=>read()}));
import {getExternalMapPostPage,filterExternalMapPins} from './external-map-posts';
const pin={id:'flickr:123@N00/456',source:'flickr' as const,createdAt:'2026-10-09T00:00:00Z',mapLocation:{latitude:35,longitude:139}};
beforeEach(()=>{state.invoke.mockReset();sessionStorage.clear();});
it('gets only pin projections from the relay, with no direct SNS body request',async()=>{
 state.invoke.mockResolvedValue({data:{schema:'geo-v1',pins:[pin],next:[]},error:null});
 const bounds={south:30,north:40,west:130,east:145};
 const page=await getExternalMapPostPage(undefined,undefined,bounds,'旅');
 expect(page.pins).toEqual([pin]);expect(page.pins[0]).not.toHaveProperty('content');expect(page.pins[0]).not.toHaveProperty('imageUrls');
 expect(state.invoke).toHaveBeenCalledWith('link-preview',expect.objectContaining({body:{mode:'map-geo-pins',bounds,search:'旅'}}));
 expect(filterExternalMapPins(page.pins,bounds)).toHaveLength(1);
 expect(filterExternalMapPins(page.pins,{...bounds,east:138})).toHaveLength(0);
});
it('preserves every pending search and cursor across bounded requests',async()=>{
 const jobs=Array.from({length:8},(_,index)=>({provider:'flickr' as const,bounds:{south:30,north:40,west:130,east:145},search:'',page:index+1,from:1,until:1700000000}));
 state.invoke.mockResolvedValue({data:{schema:'geo-v1',pins:[],next:[{...jobs[0],page:9}]},error:null});
 const page=await getExternalMapPostPage(jobs);
 expect(state.invoke.mock.calls[0][1].body.jobs).toHaveLength(4);
 expect(page.next).toEqual([...jobs.slice(4),{...jobs[0],page:9}]);
});
it('does not silently treat missing relay support as an empty map',async()=>{
 state.invoke.mockResolvedValue({data:{preview:null},error:null});
 await expect(getExternalMapPostPage(undefined)).rejects.toThrow('読み込めません');
});
it('does not issue a request after cancellation',async()=>{
 const controller=new AbortController();controller.abort();
 await expect(getExternalMapPostPage(undefined,controller.signal)).rejects.toBe(controller.signal.reason);
 expect(state.invoke).not.toHaveBeenCalled();
});

it('resumes cached position pages after a page reload without fetching bodies again',async()=>{
 state.invoke.mockResolvedValue({data:{schema:'geo-v1',pins:[pin],next:[{provider:'flickr',bounds:{south:30,north:40,west:130,east:145},search:'',page:2,from:1,until:1700000000}]},error:null});
 await getExternalMapPostPage(undefined,undefined,undefined,'cache');
 state.invoke.mockClear();
 const page=await getExternalMapPostPage(undefined,undefined,undefined,'cache');
 expect(page.pins).toEqual([pin]);expect(page.next[0].page).toBe(2);expect(state.invoke).not.toHaveBeenCalled();
});
it('keeps rate limiting available for a deferred retry without an error banner',async()=>{
 state.invoke.mockResolvedValue({data:null,error:{context:new Response(null,{status:429,headers:{'Retry-After':'300'}})}});
 await expect(getExternalMapPostPage(undefined)).rejects.toMatchObject({retryAfter:300000});
});

it('rejects the old location-inference response even if it has positions',async()=>{
 state.invoke.mockResolvedValue({data:{pins:[{...pin,source:'bluesky'}],next:[]},error:null});
 await expect(getExternalMapPostPage(undefined)).rejects.toThrow('読み込めません');
});
it('never accepts inferred provider pins in a geo response',async()=>{
 state.invoke.mockResolvedValue({data:{schema:'geo-v1',pins:[pin,{...pin,id:'misskey:old',source:'misskey'}],next:[]},error:null});
 expect((await getExternalMapPostPage(undefined)).pins).toEqual([pin]);
});
