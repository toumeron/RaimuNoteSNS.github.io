vi.mock("@/lib/registerPwa", async importOriginal => {
 const actual = await importOriginal<typeof import("@/lib/registerPwa")>();
 const overrides = [
  await (()=>({refreshNotificationBadge:vi.fn().mockResolvedValue(undefined)}))(),
  await (()=>({dismissNotificationToasts:vi.fn()}))()
 ];
 return Object.assign({}, actual, ...overrides.map(values => Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== actual[key]))));
});
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({rows:[] as Record<string,unknown>[],actors:[] as Record<string,unknown>[],actorQueries:[] as string[][]}));
vi.mock('@/lib/supabase',()=>({supabase:{from:(table:string)=>{
 const query={select:()=>query,eq:()=>query,order:()=>query,range:async()=>({data:state.rows,error:null}),in:async(_:string,ids:string[])=>{state.actorQueries.push(ids);return {data:state.actors,error:null};}};
 return query;
}}}));


import { getNotifications, markNotificationsRead, markAllNotificationsRead } from "@/api/users";
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

it('marks only the receiving account through its own authenticated client',async()=>{
 const write=vi.fn().mockResolvedValue({error:null});
 const eq=vi.fn(()=>({in:write}));const update=vi.fn(()=>({eq}));const from=vi.fn(()=>({update}));
 const context={client:{from}as never,userId:'saved'};
 await markNotificationsRead('saved',['seen'],context);
 expect(from).toHaveBeenCalledWith('notifications');expect(update).toHaveBeenCalledWith({is_read:true});
 expect(eq).toHaveBeenCalledWith('user_id','saved');expect(write).toHaveBeenCalledWith('id',['seen']);
 await expect(markNotificationsRead('different',['seen'],context)).rejects.toThrow('通知のアカウントが一致しません');
 expect(write).toHaveBeenCalledTimes(1);
});
it('preserves a failed read and does not refresh its badge as if it succeeded',async()=>{
 const refresh=(await import('@/lib/registerPwa')).refreshNotificationBadge;vi.mocked(refresh).mockClear();
 const context={client:{from:()=>({update:()=>({eq:()=>({in:async()=>({error:new Error('offline')})})})})}as never,userId:'saved'};
 await expect(markNotificationsRead('saved',['seen'],context)).rejects.toThrow('offline');expect(refresh).not.toHaveBeenCalled();
});

it('bulk read updates all unread rows of one account without an ID list or page limit',async()=>{
 const execute=vi.fn().mockResolvedValue({error:null});
 const owner=vi.fn(()=>({eq:execute}));const update=vi.fn(()=>({eq:owner}));
 const context={client:{from:vi.fn(()=>({update}))}as never,userId:'saved'};
 await markAllNotificationsRead('saved',context);
 expect(update).toHaveBeenCalledWith({is_read:true});expect(owner).toHaveBeenCalledWith('user_id','saved');expect(execute).toHaveBeenCalledWith('is_read',false);
 await expect(markAllNotificationsRead('different',context)).rejects.toThrow('通知のアカウントが一致しません');
 expect(execute).toHaveBeenCalledTimes(1);
});
