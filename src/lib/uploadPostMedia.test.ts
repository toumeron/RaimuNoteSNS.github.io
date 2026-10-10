import {beforeEach, expect, it, vi} from 'vitest';
const storage=vi.hoisted(()=>({upload:vi.fn(),remove:vi.fn()}));
vi.mock('./supabase',()=>({supabase:{storage:{from:()=>storage}}}));
import {uploadPostMedia} from './uploadPostMedia';
beforeEach(()=>{storage.upload.mockReset().mockResolvedValue({error:null});storage.remove.mockReset().mockResolvedValue({error:null});vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,blob:async()=>new Blob(['image'],{type:'image/png'})}));});
it('uploads restricted images to private storage with owner and resource paths',async()=>{
 const refs=await uploadPostMedia(['blob:device'],'owner','post',true);
 expect(refs[0]).toMatch(/^storage:\/\/post-media\/owner\/post\/.*\.png$/);
 expect(storage.upload.mock.calls[0][2]).toMatchObject({upsert:false,cacheControl:'0'});
});
it('rejects public URLs in a restricted attachment batch before any upload',async()=>{
 await expect(uploadPostMedia(['blob:device','https://public.example/image.png'],'owner','post',true)).rejects.toThrow('公開URL');
 expect(fetch).not.toHaveBeenCalled();expect(storage.upload).not.toHaveBeenCalled();
});
it('rejects executable SVG attachments',async()=>{
 vi.mocked(fetch).mockResolvedValueOnce({ok:true,blob:async()=>new Blob(['<svg/>'],{type:'image/svg+xml'})} as Response);
 await expect(uploadPostMedia(['blob:device'],'owner','post',true)).rejects.toThrow('形式');expect(storage.upload).not.toHaveBeenCalled();
});
it('cleans up staged objects when the next upload fails',async()=>{
 storage.upload.mockResolvedValueOnce({error:null}).mockResolvedValueOnce({error:new Error('failed')});
 await expect(uploadPostMedia(['blob:one','blob:two'],'owner','post',true)).rejects.toThrow('アップロード');
 expect(storage.remove).toHaveBeenCalledWith([storage.upload.mock.calls[0][0]]);
});

it('preserves the storage error reason instead of hiding a missing bucket',async()=>{
 storage.upload.mockResolvedValueOnce({error:{message:'Bucket not found',statusCode:'404'}});
 await expect(uploadPostMedia(['blob:device'],'owner','post',false)).rejects.toThrow('Bucket not found');
});
