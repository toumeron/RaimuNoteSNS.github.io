import { beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({currentId:'viewer' as string|null,calls:[] as string[]}));
vi.mock('@/lib/currentUser',()=>({getCurrentUserId:async()=>fixture.currentId}));
vi.mock('@/lib/supabase',()=>({supabase:{from:(table:string)=>{
 fixture.calls.push(table);let counting=false;
 const query={select:(_columns:string,options?:{count?:string})=>{counting=!!options?.count;return query;},eq:()=>query,maybeSingle:()=>query,then:(resolve:(value:unknown)=>void)=>Promise.resolve({data:counting?null:{follower_id:'viewer'},count:counting?5:null,error:null}).then(resolve)};
 return query;
}}}));
import {getFollowStats} from './follows';
beforeEach(()=>{fixture.currentId='viewer';fixture.calls=[];});
it.each(['misskey-user:local-id','did:plc:actor'])('does not query Lime follows for external profile %s',async id=>{
 expect(await getFollowStats(id)).toEqual({followers:0,following:0,followedByMe:false});
 expect(fixture.calls).toEqual([]);
});
it('keeps the native follow statistics and viewer state',async()=>{
 expect(await getFollowStats('author')).toEqual({followers:5,following:5,followedByMe:true});
 expect(fixture.calls).toHaveLength(3);
});
it('does not send a null viewer ID to the follows lookup',async()=>{
 fixture.currentId=null;
 expect(await getFollowStats('author')).toEqual({followers:5,following:5,followedByMe:false});
 expect(fixture.calls).toHaveLength(2);
});
