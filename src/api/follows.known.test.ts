import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({calls:[] as {select:string;filters:Record<string,unknown>}[],following:['a','b','c','d','e','a'],matches:['a','b','c','d','e']}));
vi.mock('@/lib/supabase',()=>({supabase:{from:()=>{
 const call={select:'',filters:{} as Record<string,unknown>};state.calls.push(call);
 const query={select:(value:string)=>{call.select=value;return query;},eq:(key:string,value:unknown)=>{call.filters[key]=value;return query;},order:()=>query,in:(key:string,ids:string[])=>{call.filters[key]=ids;return query;},range:async()=>call.select==='followee_id'?{data:state.following.map(followee_id=>({followee_id})),error:null}:{data:state.matches.slice(0,3).map(id=>({profile:{id,username:id,display_name:id.toUpperCase(),avatar_url:''}})),count:state.matches.length,error:null}};
 return query;
}}}));
import {getKnownFollowers} from './follows';
beforeEach(()=>{state.calls=[];state.following=['a','b','c','d','e','a'];});
it('counts the intersection and only loads three avatar profiles, excluding pending requests',async()=>{
 const result=await getKnownFollowers('viewer','target');
 expect(result.total).toBe(5);expect(result.users.map(user=>user.displayName)).toEqual(['A','B','C']);
 expect(state.calls[0].filters).toEqual({follower_id:'viewer',approved:true});
 expect(state.calls[1].filters).toEqual({followee_id:'target',approved:true,follower_id:['a','b','c','d','e']});
});
it.each(['viewer','did:plc:external','misskey-user:external'])('does not query for self or external IDs: %s',async target=>{
 expect(await getKnownFollowers('viewer',target)).toEqual({total:0,users:[]});expect(state.calls).toEqual([]);
});
it('does not query a follower intersection when the viewer follows nobody',async()=>{
 state.following=[];expect(await getKnownFollowers('viewer','target')).toEqual({total:0,users:[]});expect(state.calls).toHaveLength(1);
});
