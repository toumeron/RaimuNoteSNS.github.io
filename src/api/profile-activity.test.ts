import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ data: 15 as unknown, error: null as Error | null, rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: state.rpc } }));
import { getProfileActivityCount } from './profile-activity';
beforeEach(() => { state.data = 15; state.error = null; state.rpc.mockReset(); state.rpc.mockImplementation(async()=>({data:state.data,error:state.error})); });
it('uses only the aggregate RPC so audience policies do not reduce the total', async () => {
  expect(await getProfileActivityCount('author')).toBe(15);
  expect(state.rpc).toHaveBeenCalledWith('get_profile_activity_count',{target_user_id:'author'});
});
it('accepts bigint strings and a legitimate zero', async () => {
  state.data='18';expect(await getProfileActivityCount('author')).toBe(18);
  state.data=0;expect(await getProfileActivityCount('author')).toBe(0);
});
it('does not show a fabricated zero when the query fails or the result is invalid', async () => {
  state.error = new Error('unavailable');
  await expect(getProfileActivityCount('author')).rejects.toThrow('unavailable');
  state.error=null;
  for(const value of [null,[],{},-1,'invalid']) {state.data=value;await expect(getProfileActivityCount('author')).rejects.toThrow('Invalid profile activity count');}
});
