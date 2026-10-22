import {beforeEach,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({result:vi.fn(),filter:vi.fn()}));
vi.mock("./supabase", async importOriginal => ({
  ...await importOriginal<typeof import("./supabase")>(),
  supabase:{from:()=>({select:()=>({eq:()=>({not:()=>({or:(filter:string)=>{fixture.filter(filter);return {limit:()=>({abortSignal:fixture.result})};}})})})})}
}));
import {searchSavedAccounts} from "@/lib/externalAccounts";
beforeEach(()=>vi.clearAllMocks());
it('finds public saved external profiles by display name without a follower count condition',async()=>{
 fixture.result.mockResolvedValue({data:[{external_provider:'misskey',external_handle:'artist@misskey.io',external_profile:{id:'misskey-user:artist',username:'artist@misskey.io',displayName:'たんたんめん',avatarUrl:'avatar'}}],error:null});
 expect(await searchSavedAccounts('タンタンメン')).toEqual([expect.objectContaining({displayName:'たんたんめん',username:'artist@misskey.io'})]);
 expect(fixture.filter.mock.calls[0][0]).toContain('external_profile->>displayName.ilike.%たんたんめん%');
});
it('does not suggest unrelated snapshots and preserves RLS errors',async()=>{
 fixture.result.mockResolvedValue({data:[{external_provider:'misskey',external_handle:'dog@misskey.io',external_profile:{id:'dog',displayName:'いぬ'}}],error:null});
 expect(await searchSavedAccounts('猫')).toEqual([]);
 fixture.result.mockResolvedValue({data:null,error:new Error('permission denied')});
 await expect(searchSavedAccounts('猫')).rejects.toThrow('permission denied');
});
