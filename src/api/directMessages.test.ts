import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({invoke:vi.fn(),signed:vi.fn(),from:vi.fn(),storage:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabase:{functions:{invoke:mocks.invoke},from:mocks.from,storage:{from:mocks.storage}}}));
import {uploadDirectMedia,getDirectMessages} from './directMessages';
beforeEach(()=>{vi.clearAllMocks();mocks.storage.mockReturnValue({createSignedUrls:mocks.signed});});
describe('DM Cloudinary media',()=>{
 it('uploads to the authenticated handler without a Supabase storage upload',async()=>{
  mocks.invoke.mockResolvedValue({data:{ref:'cloudinary:direct_messages/conversation/user/asset'},error:null});
  const file=new File(['image'],'a.png',{type:'image/png'});
  expect(await uploadDirectMedia('conversation','user',[file])).toEqual(['cloudinary:direct_messages/conversation/user/asset']);
  const [name,args]=mocks.invoke.mock.calls[0];expect(name).toBe('direct-media');expect(args.body.get('conversationId')).toBe('conversation');expect(args.body.get('file')).toBe(file);expect(mocks.storage).not.toHaveBeenCalled();
 });
 it('cleans up successful files when a later file fails',async()=>{
  mocks.invoke.mockResolvedValueOnce({data:{ref:'cloudinary:asset'}}).mockResolvedValueOnce({error:new Error('upload failure')}).mockResolvedValueOnce({data:{ok:true}});
  await expect(uploadDirectMedia('conversation','user',[new File(['a'],'a.png',{type:'image/png'}),new File(['b'],'b.png',{type:'image/png'})])).rejects.toThrow('アップロード');
  expect(mocks.invoke).toHaveBeenLastCalledWith('direct-media',{body:{action:'discard',refs:['cloudinary:asset']}});
 });
 it('authorizes Cloudinary images by message ID and keeps legacy images in attachment order',async()=>{
  const row={id:'message',attachments:['old/path','cloudinary:asset']};const query:any={};for(const name of ['select','eq','order','limit'])query[name]=vi.fn(()=>query);query.then=(resolve:any)=>Promise.resolve({data:[row],error:null}).then(resolve);mocks.from.mockReturnValue(query);
  mocks.invoke.mockResolvedValue({data:{urls:{'cloudinary:asset':'https://cloudinary.test/signed'}}});mocks.signed.mockResolvedValue({data:[{path:'old/path',signedUrl:'https://legacy.test/signed'}]});
  expect((await getDirectMessages('conversation'))[0].mediaUrls).toEqual(['https://legacy.test/signed','https://cloudinary.test/signed']);
  expect(mocks.invoke).toHaveBeenCalledWith('direct-media',{body:{action:'read',messageIds:['message']}});expect(mocks.signed).toHaveBeenCalledWith(['old/path'],3600);
 });
 it('rejects unsupported media before calling a service',async()=>{await expect(uploadDirectMedia('c','u',[new File(['a'],'a.gif',{type:'image/gif'})])).rejects.toThrow('JPEG');expect(mocks.invoke).not.toHaveBeenCalled();});
});
