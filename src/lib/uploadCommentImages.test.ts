import {beforeEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({user:'owner' as string|null,upload:vi.fn()}));
vi.mock('./currentUser',()=>({getCurrentUserId:async()=>state.user}));
vi.mock('./uploadPostMedia',()=>({uploadPostMedia:state.upload}));
import {uploadCommentImages} from './uploadCommentImages';
beforeEach(()=>{state.user='owner';state.upload.mockReset().mockResolvedValue(['storage://post-media/private']);});
describe('reply image compatibility helper',()=>{
 it('delegates to private storage instead of an unsigned public upload preset',async()=>{
  expect(await uploadCommentImages(['blob:preview'])).toEqual(['storage://post-media/private']);
  expect(state.upload).toHaveBeenCalledWith(['blob:preview'],'owner',expect.any(String),true);
 });
 it('requires a signed-in owner',async()=>{state.user=null;await expect(uploadCommentImages(['blob:preview'])).rejects.toThrow('ログイン');expect(state.upload).not.toHaveBeenCalled();});
 it('propagates failed uploads',async()=>{state.upload.mockRejectedValue(new Error('アップロード失敗'));await expect(uploadCommentImages(['blob:preview'])).rejects.toThrow('アップロード');});
 it('rejects more than four attachments before sending requests',async()=>{await expect(uploadCommentImages(Array(5).fill('blob:preview'))).rejects.toThrow('4枚');expect(state.upload).not.toHaveBeenCalled();});
});
