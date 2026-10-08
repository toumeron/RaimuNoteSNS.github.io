import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('./supabase',()=>({supabase:{functions:{invoke:state.invoke}}}));
import {uploadProfileMedia} from './uploadProfileMedia';
beforeEach(()=>state.invoke.mockReset());
it('uploads settings images through an authenticated server function',async()=>{
 state.invoke.mockResolvedValue({data:{secure_url:'https://image.example/safe',public_id:'owned-id',format:'png'},error:null});
 const file=new File(['image'],'test.png',{type:'image/png'});
 await uploadProfileMedia(file,'emoji');
 const [name,{body}]=state.invoke.mock.calls[0];expect(name).toBe('upload-profile-media');expect(body.get('kind')).toBe('emoji');expect(body.get('file')).toBe(file);expect(body.has('upload_preset')).toBe(false);
});
it('rejects failed uploads before settings can persist a fake media URL',async()=>{
 state.invoke.mockResolvedValue({data:null,error:Error('Unauthorized')});
 await expect(uploadProfileMedia(new File(['image'],'test.png'),'timeline-background')).rejects.toThrow('アップロード');
});
