import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('@/lib/supabase',()=>({supabase:{auth:{getSession:async()=>({data:{session:{access_token:'synthetic-test-token'}}})}}}));
import {deleteVideoPost} from './postVideoStorage';
beforeEach(()=>{vi.stubEnv('VITE_VIDEO_WORKER_URL','https://video.example');});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('requests authenticated server-side video and post deletion',async()=>{
 const fetch=vi.fn().mockResolvedValue(Response.json({ok:true}));vi.stubGlobal('fetch',fetch);await deleteVideoPost('post-id');
 expect(fetch).toHaveBeenCalledWith('https://video.example/posts/post-id',{method:'DELETE',headers:{Authorization:'Bearer synthetic-test-token'}});
});
it('surfaces storage failures rather than reporting successful post deletion',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({error:'動画ファイルを削除できませんでした'},{status:502})));
 await expect(deleteVideoPost('post-id')).rejects.toThrow('動画ファイルを削除できませんでした');
});
