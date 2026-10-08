import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({table:'',columns:'',patch:{} as Record<string,unknown>,filters:{} as Record<string,string>,error:null as Error|null,row:{id:'owner',pinned_post_id:'post'} as {id:string;pinned_post_id:string|null}}));
vi.mock('@/lib/supabase',()=>({supabase:{from:(table:string)=>{state.table=table;const q={select:(columns:string)=>{state.columns=columns;return q;},eq:(key:string,value:string)=>{state.filters[key]=value;return q;},update:(patch:Record<string,unknown>)=>{state.patch=patch;return q;},single:async()=>({data:state.row,error:state.error}),maybeSingle:async()=>({data:state.row,error:state.error})};return q;}}}));
import {getProfilePin,setProfilePin} from './profile-pins';
beforeEach(()=>{state.table='';state.columns='';state.patch={};state.filters={};state.error=null;state.row={id:'owner',pinned_post_id:'post'};});
it('uses the existing profiles column to read the pin',async()=>{
 expect(await getProfilePin('owner')).toBe('post');expect(state.table).toBe('profiles');expect(state.columns).toBe('pinned_post_id');expect(state.filters).toEqual({id:'owner'});
});
it('updates only pinned_post_id and clears it with null',async()=>{
 await setProfilePin('owner','new-post');expect(state.patch).toEqual({pinned_post_id:'new-post'});expect(state.filters).toEqual({id:'owner'});
 await setProfilePin('owner',null);expect(state.patch).toEqual({pinned_post_id:null});
});
it('propagates failed or missing-row updates instead of reporting success',async()=>{
 state.error=new Error('not permitted');await expect(setProfilePin('other','post')).rejects.toThrow('not permitted');
});
