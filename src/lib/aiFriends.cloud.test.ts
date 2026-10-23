import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({user:'owner',remote:{} as Record<string,unknown>,fail:false,rpc:vi.fn(),upload:vi.fn()}));
vi.mock('@/lib/supabase',()=>({notifySuspendedAction:vi.fn(),supabase:{auth:{getUser:async()=>({data:{user:{id:mocks.user}}})},rpc:mocks.rpc}}));
vi.mock('@/lib/mediaThumbnail',()=>({uploadProfileMedia:mocks.upload,readChatImage:vi.fn(),writeChatImage:vi.fn()}));
import { syncFriends, writeFriendSetting, loadAvatars, saveAvatars, loadCustomAssistants, deleteCustomAssistant } from './aiFriends';
beforeEach(()=>{
 localStorage.clear();mocks.user='owner';mocks.remote={};mocks.fail=false;mocks.upload.mockReset();
 mocks.rpc.mockReset().mockImplementation(async(_name,{p_patch})=>{
  if(mocks.fail)return {error:new Error('offline')};
  mocks.remote={...mocks.remote,...p_patch};return {data:{...mocks.remote},error:null};
 });
});
it('migrates existing friends and uploads embedded images only to Cloudinary',async()=>{
 localStorage.setItem('limeai:owner:assistants',JSON.stringify([{id:'old',name:'既存',coverUrl:'data:image/png;base64,YQ=='}]));
 localStorage.setItem('limeai:owner:avatars',JSON.stringify({old:'data:image/png;base64,YQ=='}));
 mocks.upload.mockResolvedValue({secure_url:'https://res.cloudinary.com/cloud/image/upload/test.png'});
 await syncFriends('owner');
 expect(mocks.upload).toHaveBeenCalledTimes(2);
 expect(loadAvatars('owner').old).toContain('res.cloudinary.com');
 expect(JSON.stringify(mocks.remote)).not.toContain('data:image');
 expect(loadCustomAssistants('owner')[0].name).toBe('既存');
});
it('hydrates a new device and keeps deleted friends deleted when an old device migrates',async()=>{
 mocks.remote={'assistants/deleted':null,'avatars/deleted':null,'assistants/new':{id:'new',name:'別の端末'}};
 localStorage.setItem('limeai:owner:assistants',JSON.stringify([{id:'deleted',name:'古いキャッシュ'}]));
 await syncFriends('owner');
 expect(loadCustomAssistants('owner').map(item=>item.id)).toEqual(['new']);
 deleteCustomAssistant('owner','new');await syncFriends('owner');
 expect(mocks.remote['assistants/new']).toBeNull();
});
it('merges independent edits without erasing the other device and synchronizes removals',async()=>{
 mocks.remote={'avatars/one':'https://res.cloudinary.com/c/one'};
 await syncFriends('owner');
 mocks.remote['avatars/two']='https://res.cloudinary.com/c/two';
 saveAvatars('owner',{...loadAvatars('owner'),one:'https://res.cloudinary.com/c/edit'});
 await syncFriends('owner');
 expect(loadAvatars('owner')).toEqual({one:'https://res.cloudinary.com/c/edit',two:'https://res.cloudinary.com/c/two'});
 saveAvatars('owner',{two:loadAvatars('owner').two});await syncFriends('owner');
 expect(mocks.remote['avatars/one']).toBeNull();
});
it('retains an offline outbox and resends after reconnecting',async()=>{
 await syncFriends('owner');mocks.fail=true;
 writeFriendSetting('owner','session-meta',{chat:{assistantId:'friend',pinned:true}});
 await expect(syncFriends('owner')).rejects.toThrow('offline');
 expect(localStorage.getItem('limeai:owner:cloud-pending')).toContain('friend');
 mocks.fail=false;await syncFriends('owner');
 expect(mocks.remote['session-meta/chat']).toEqual({assistantId:'friend',pinned:true});
 expect(localStorage.getItem('limeai:owner:cloud-pending')).toBe('{}');
});
it('never sends another account cache when authentication changes',async()=>{
 mocks.user='other';localStorage.setItem('limeai:owner:assistants','[{"id":"private"}]');
 await expect(syncFriends('owner')).rejects.toThrow();expect(mocks.rpc).not.toHaveBeenCalled();
});
it('keeps images in the outbox when Cloudinary fails and retries without losing the friend',async()=>{
 await syncFriends('owner');mocks.upload.mockRejectedValueOnce(new Error('upload failed'));
 saveAvatars('owner',{friend:'data:image/png;base64,YQ=='});
 await expect(syncFriends('owner')).rejects.toThrow('upload failed');
 expect(mocks.remote['avatars/friend']).toBeUndefined();
 expect(localStorage.getItem('limeai:owner:cloud-pending')).toContain('data:image');
 mocks.upload.mockResolvedValue({secure_url:'https://res.cloudinary.com/c/recovered'});
 await syncFriends('owner');expect(loadAvatars('owner').friend).toBe('https://res.cloudinary.com/c/recovered');
});
it('preserves changes made while an earlier image upload is in progress',async()=>{
 await syncFriends('owner');let release!:(value:unknown)=>void;
 mocks.upload.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve}));
 saveAvatars('owner',{friend:'data:image/png;base64,YQ=='});
 const job=syncFriends('owner');
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
 saveAvatars('owner',{friend:'https://res.cloudinary.com/c/newer'});
 release({secure_url:'https://res.cloudinary.com/c/old-upload'});await job;
 expect(loadAvatars('owner').friend).toBe('https://res.cloudinary.com/c/newer');
 expect(mocks.remote['avatars/friend']).toBe('https://res.cloudinary.com/c/newer');
});
