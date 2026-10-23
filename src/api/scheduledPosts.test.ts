vi.mock("@/lib/mediaThumbnail", async importOriginal => {
 const actual = await importOriginal<typeof import("@/lib/mediaThumbnail")>();
 return {...actual, ...await (async importOriginal => ({...await importOriginal<typeof import("@/lib/mediaThumbnail")>(), uploadPostMedia:mocks.upload}))(importOriginal)};
});


import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),upload:vi.fn(),communityUpload:vi.fn()}));
vi.mock('@/api/communities',()=>({uploadCommunityImages:mocks.communityUpload}));
vi.mock('@/lib/currentUser',()=>({getCurrentUserId:async()=> 'viewer'}));

vi.mock("@/lib/supabase", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(),
  supabase:{rpc:mocks.rpc,from:mocks.from}
}));
import {createPost} from './posts';
beforeEach(()=>{vi.clearAllMocks();mocks.rpc.mockResolvedValue({data:null,error:null});mocks.upload.mockImplementation(async(_images,owner,id)=>[`storage://post-media/${owner}/${id}/photo.png`]);mocks.from.mockReturnValue({select:()=>({eq:()=>({single:async()=>({data:{is_private:false},error:null})})})});});
it('stores scheduled content privately instead of inserting a public post, and keeps its image private until publication',async()=>{
 const scheduledAt=new Date(Date.now()+3600_000).toISOString();const result=await createPost({content:'予約本文 @someone',imageUrls:['blob:picture'],scheduledAt});
 expect(result.scheduledAt).toBe(scheduledAt);expect(mocks.upload).toHaveBeenCalledWith(['blob:picture'],'viewer',expect.any(String),true);
 expect(mocks.rpc).toHaveBeenCalledWith('save_scheduled_post',expect.objectContaining({send_at:scheduledAt,post_id:result.id,payload:expect.objectContaining({content:'予約本文 @someone',image_urls:result.imageUrls})}));
 expect(mocks.from.mock.calls.map(([table])=>table)).toEqual(['profiles']);
});
it('rejects past dates before uploading media or calling the scheduling RPC',async()=>{
 await expect(createPost({content:'予約',imageUrls:[],scheduledAt:new Date(Date.now()-1000).toISOString()})).rejects.toThrow('予約日時');expect(mocks.upload).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
});

it('keeps the community destination and uses Cloudinary for community attachments when scheduling',async()=>{
 const communityId='11111111-1111-4111-8111-111111111111';const cloudinary='https://res.cloudinary.com/demo/image/upload/communities/viewer/photo.png';mocks.communityUpload.mockResolvedValue([cloudinary]);
 const result=await createPost({content:'写真',communityId,visibility:'public',imageUrls:['blob:picture'],scheduledAt:new Date(Date.now()+3600_000).toISOString()});
 expect(mocks.communityUpload).toHaveBeenCalledWith(['blob:picture'],'viewer');expect(mocks.upload).not.toHaveBeenCalled();expect(mocks.rpc).toHaveBeenCalledWith('save_scheduled_post',expect.objectContaining({payload:expect.objectContaining({community_id:communityId,image_urls:[cloudinary]})}));expect(result.communityId).toBe(communityId);
});
