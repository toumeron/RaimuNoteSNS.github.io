import {beforeEach,describe,expect,it,vi} from 'vitest';
const rpc=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/currentUser',()=>({getCurrentUserId:async()=> 'viewer'}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc}}));
import {externalLikeSnapshot,getExternalLikeState,setExternalLike} from './external-likes';
const post:any={id:'bsky:at://did:plc:artist/app.bsky.feed.post/abc',userId:'bsky:did:plc:artist',visibility:'public',content:'',imageUrls:['https://example.com/art.jpg'],createdAt:'2026-10-09',likesCount:3,author:{id:'artist',username:'artist',isOfficial:true,token:'secret'},token:'secret'};
beforeEach(()=>rpc.mockReset());
describe('cloud external likes',()=>{
 it('stores a public image-only snapshot, excluding credentials and invented badges',async()=>{
  rpc.mockResolvedValue({data:{liked:true,count:1,unmirroredCount:1},error:null});
  expect(await setExternalLike(post,true)).toEqual({liked:true,count:1,unmirroredCount:1});
  const snapshot=rpc.mock.calls[0][1].snapshot;expect(snapshot.imageUrls).toEqual(post.imageUrls);expect(snapshot.token).toBeUndefined();expect(snapshot.author.token).toBeUndefined();expect(snapshot.author.isOfficial).toBe(false);
 });
 it('supports Misskey without provider credentials',async()=>{
  rpc.mockResolvedValue({data:{liked:true,count:1,unmirroredCount:1},error:null});
  await setExternalLike({...post,id:'misskey:https://misskey.io/notes/abc123'},true);expect(rpc).toHaveBeenCalledWith('set_external_like',expect.objectContaining({enabled:true,mirrored:false}));
 });
 it('rejects private or native posts',()=>{expect(()=>externalLikeSnapshot({...post,visibility:'private'})).toThrow();expect(()=>externalLikeSnapshot({...post,id:'native'})).toThrow();});
 it('batches visible hearts into a single read and resolves distinct own states',async()=>{
  rpc.mockResolvedValue({data:[{post_id:'one',liked:true,likes_count:2,unmirrored_count:1},{post_id:'two',liked:false,likes_count:3,unmirrored_count:2}],error:null});
  const states=await Promise.all([getExternalLikeState('one'),getExternalLikeState('two'),getExternalLikeState('one')]);expect(rpc).toHaveBeenCalledTimes(1);expect(states).toEqual([{liked:true,count:2,unmirroredCount:1},{liked:false,count:3,unmirroredCount:2},{liked:true,count:2,unmirroredCount:1}]);
 });
 it('rejects state reads queued for a different signed-in account',async()=>{await expect(getExternalLikeState('post','other-viewer')).rejects.toThrow('Account changed');expect(rpc).not.toHaveBeenCalled();});
 it('propagates failures instead of claiming a successful like',async()=>{rpc.mockResolvedValue({data:null,error:new Error('write failed')});await expect(setExternalLike(post,true)).rejects.toThrow('write failed');});
});
