import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({user:'owner' as string|null,upload:vi.fn(),remove:vi.fn()}));
vi.mock('./currentUser',()=>({getCurrentUserId:async()=>state.user}));
vi.mock('./supabase',()=>({supabase:{storage:{from:()=>({upload:state.upload,remove:state.remove})}}}));
import { uploadCommentImages } from "@/lib/mediaThumbnail";
beforeEach(()=>{vi.stubGlobal('createImageBitmap',vi.fn().mockResolvedValue({width:1200,height:800,close:vi.fn()}));
 state.user='owner';state.upload.mockReset().mockResolvedValue({error:null});state.remove.mockReset().mockResolvedValue({error:null});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,blob:async()=>new Blob(['image'],{type:'image/png'})}));
});
afterEach(()=>vi.unstubAllGlobals());
describe('reply image compatibility helper',()=>{
 it('uploads to private storage instead of an unsigned public upload preset',async()=>{
  const refs=await uploadCommentImages(['blob:preview']);
  expect(refs).toHaveLength(1);expect(refs[0]).toMatch(/^storage:\/\/post-media\/owner\//);
  expect(state.upload).toHaveBeenCalledWith(expect.stringMatching(/^owner\/[^/]+\/[^/]+\.png$/),expect.any(Blob),expect.objectContaining({upsert:false,contentType:'image/png'}));
 });
 it('requires a signed-in owner',async()=>{state.user=null;await expect(uploadCommentImages(['blob:preview'])).rejects.toThrow('ログイン');expect(state.upload).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();});
 it('propagates failed uploads',async()=>{state.upload.mockResolvedValue({error:{message:'アップロード失敗'}});await expect(uploadCommentImages(['blob:preview'])).rejects.toThrow('アップロード');});
 it('rejects more than four attachments before sending requests',async()=>{await expect(uploadCommentImages(Array(5).fill('blob:preview'))).rejects.toThrow('4枚');expect(state.upload).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();});
});
