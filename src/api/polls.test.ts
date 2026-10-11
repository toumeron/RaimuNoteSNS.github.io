import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({invoke:vi.fn(),from:vi.fn(),viewer:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabase:{functions:{invoke:mocks.invoke},from:mocks.from}}));
vi.mock('@/lib/currentUser',()=>({getCurrentUserId:mocks.viewer}));
import {preparePoll,votePoll} from './polls';
beforeEach(()=>{vi.clearAllMocks();mocks.viewer.mockResolvedValue('viewer');});afterEach(()=>vi.unstubAllGlobals());
it('creates text-only polls without invoking any image service',async()=>{
 const draft={options:[{label:' 猫 '},{label:'犬'}],durationMinutes:1440};expect(await preparePoll(draft,'post')).toEqual({...draft,options:[{label:'猫'},{label:'犬'}]});expect(mocks.invoke).not.toHaveBeenCalled();
});
it('uploads answer images only through Cloudinary and preserves the returned references',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>({ok:true,blob:async()=>new Blob(['image'],{type:'image/png'})})));mocks.invoke.mockResolvedValue({data:{ref:'cloudinary:polls/viewer/post/asset.png'}});
 const result=await preparePoll({options:[{label:'猫',image:'blob:cat'},{label:'犬'}],durationMinutes:10},'post');expect(result.options[0].image).toBe('cloudinary:polls/viewer/post/asset.png');
 const [name,{body}]=mocks.invoke.mock.calls[0];expect(name).toBe('poll-media');expect(body).toBeInstanceOf(FormData);expect(body.get('postId')).toBe('post');
});
it('cleans up an earlier answer image if a later upload fails',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>({ok:true,blob:async()=>new Blob(['image'],{type:'image/png'})})));mocks.invoke.mockResolvedValueOnce({data:{ref:'cloudinary:polls/viewer/post/first.png'}}).mockResolvedValueOnce({error:new Error('upload failed')}).mockResolvedValue({data:{ok:true}});
 await expect(preparePoll({options:[{label:'猫',image:'blob:cat'},{label:'犬',image:'blob:dog'}],durationMinutes:10},'post')).rejects.toThrow('アップロード');expect(mocks.invoke).toHaveBeenLastCalledWith('poll-media',{body:{action:'discard',refs:['cloudinary:polls/viewer/post/first.png']}});
});
it('rejects invalid definitions and public URLs before upload',async()=>{
 await expect(preparePoll({options:[{label:''},{label:'犬'}],durationMinutes:10},'post')).rejects.toThrow('回答');await expect(preparePoll({options:[{label:'猫',image:'https://example.test/a.png'},{label:'犬'}],durationMinutes:10},'post')).rejects.toThrow('端末');expect(mocks.invoke).not.toHaveBeenCalled();
});
it('binds voting to the authenticated user and treats a duplicate as already voted',async()=>{
 const insert=vi.fn().mockResolvedValue({error:{code:'23505'}});mocks.from.mockReturnValue({insert});expect(await votePoll('post',1)).toBe('viewer');expect(insert).toHaveBeenCalledWith({post_id:'post',user_id:'viewer',option_index:1});
 mocks.viewer.mockResolvedValue(null);await expect(votePoll('post',0)).rejects.toThrow('ログイン');expect(insert).toHaveBeenCalledTimes(1);
});
