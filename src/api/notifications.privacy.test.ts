import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({rows:[] as Record<string,unknown>[],actors:[] as Record<string,unknown>[],actorQueries:[] as string[][]}));
vi.mock('@/lib/supabase',()=>({supabase:{from:(table:string)=>{
 const query={select:()=>query,eq:()=>query,order:()=>query,range:async()=>({data:state.rows,error:null}),in:async(_:string,ids:string[])=>{state.actorQueries.push(ids);return {data:state.actors,error:null};}};
 return query;
}}}));
vi.mock('@/lib/notificationBadge',()=>({refreshNotificationBadge:vi.fn()}));
vi.mock('@/lib/notificationToast',()=>({dismissNotificationToasts:vi.fn()}));
import {getNotifications} from './notifications';
beforeEach(()=>{state.rows=[];state.actors=[];state.actorQueries=[];});
it('uses current account protection for old notifications and batches duplicate actors',async()=>{
 state.rows=[{id:'1',actor_id:'private',actor_is_official:true},{id:'2',actor_id:'private'},{id:'3',actor_id:'public',actor_is_private:true},{id:'4',actor_id:null}];
 state.actors=[{id:'private',is_private:true},{id:'public',is_private:false}];
 const rows=await getNotifications('viewer');
 expect(rows.map(row=>row.actor_is_private)).toEqual([true,true,false,false]);
 expect(rows[0].actor_is_official).toBe(true);
 expect(state.actorQueries).toEqual([['private','public']]);
});
it('skips actor lookups when there are no notifications',async()=>{
 expect(await getNotifications('viewer')).toEqual([]);expect(state.actorQueries).toEqual([]);
});
