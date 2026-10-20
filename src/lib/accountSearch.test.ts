import {it,expect,vi,beforeEach} from 'vitest';
const mocks=vi.hoisted(()=>({external:vi.fn(),native:vi.fn(),filter:vi.fn()}));
vi.mock('./bluesky',()=>({searchExternalUsers:mocks.external}));
vi.mock('./supabase',()=>({supabase:{from:()=>({select:()=>({or:(filter:string)=>{mocks.filter(filter);return {limit:()=>({abortSignal:mocks.native})};}})})}}));
import { searchAccounts, searchProfileUser } from "@/api/users";
beforeEach(()=>{vi.clearAllMocks();mocks.native.mockResolvedValue({data:[{id:'native',username:'cat',display_name:'ねこ',is_official:true,is_private:true}],error:null});mocks.external.mockResolvedValue([{id:'did:plc:friend',username:'friend.bsky.social',displayName:'Friend'},{id:'misskey-user:friend',username:'friend@misskey.io',displayName:'友達'}]);});
it('uses the search-page external account search and retains both providers and native badges',async()=>{
 const controller=new AbortController(),users=await searchAccounts('@ねこ',controller.signal);
 expect(users.map(user=>user.id)).toEqual(['native','did:plc:friend','misskey-user:friend']);
 expect(users[0]).toMatchObject({isOfficial:true,isPrivate:true});
 expect(mocks.external).toHaveBeenCalledWith('ねこ',{signal:controller.signal,limit:15});
 expect(mocks.filter.mock.calls[0][0]).toContain('bio.ilike');
});
it('keeps native results when the external account service fails',async()=>{
 mocks.external.mockRejectedValue(new Error('offline'));expect(await searchAccounts('cat')).toHaveLength(1);
 expect(searchProfileUser({id:'a',username:'a',is_official:false,is_private:false})).toMatchObject({isOfficial:false,isPrivate:false});
});

it('does not discard provider verification when normalizing a saved external profile',()=>{
 const verification={provider:'twitter',type:'organization'};
 expect(searchProfileUser({id:'x-user:1',username:'google@twitter.com',providerVerification:verification}).providerVerification).toEqual(verification);
});
