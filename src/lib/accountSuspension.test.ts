import {afterEach,describe,expect,it,vi} from 'vitest';
import {createSuspensionFetch,setAccountSuspended,SUSPENSION_EVENT} from './accountSuspension';
afterEach(()=>setAccountSuspended(false));
describe('suspended account transport',()=>{
 it('rejects writes and exposes feedback while preserving timeline, profile and media reads',async()=>{
  setAccountSuspended(true);
  const transport=vi.fn(async()=>Response.json({ok:true}));const request=createSuspensionFetch('https://db.test',transport);
  const feedback=vi.fn();window.addEventListener(SUSPENSION_EVENT,feedback);
  try{
   for(const [path,method,body] of [['/rest/v1/posts','POST','{}'],['/rest/v1/profiles','PATCH','{}'],['/rest/v1/rpc/send_direct_message','POST','{}'],['/storage/v1/object/posts/new','POST','png'],['/functions/v1/chat-gemma','POST','{}']]) expect((await request('https://db.test'+path,{method,body})).status).toBe(403);
   expect(transport).not.toHaveBeenCalled();expect(feedback).toHaveBeenCalledTimes(5);
   for(const [path,method,body] of [['/rest/v1/posts','GET',undefined],['/rest/v1/profiles','GET',undefined],['/rest/v1/rpc/get_direct_inbox','POST','{}'],['/functions/v1/poll-media','POST','{"action":"resolve"}'],['/auth/v1/logout','POST','{}']]) expect((await request('https://db.test'+path,{method,body})).status).toBe(200);
   expect(transport).toHaveBeenCalledTimes(5);
  }finally{window.removeEventListener(SUSPENSION_EVENT,feedback);}
 });
 it('blocks post/profile searches without blocking timeline and direct profile reads',async()=>{
  setAccountSuspended(true);
  const transport=vi.fn(async()=>Response.json([]));const request=createSuspensionFetch('https://db.test',transport);
  for(const path of ['/rest/v1/posts?content=ilike.%cat%','/rest/v1/profiles?or=(username.ilike.%cat%,display_name.ilike.%cat%)']) expect((await request('https://db.test'+path)).status).toBe(403);
  expect((await request('https://db.test/rest/v1/rpc/search_posts',{method:'POST',body:'{}'})).status).toBe(403);
  expect(transport).not.toHaveBeenCalled();
  expect((await request('https://db.test/rest/v1/posts?order=created_at.desc')).status).toBe(200);
  expect((await request('https://db.test/rest/v1/profiles?username=eq.cat')).status).toBe(200);
  setAccountSuspended(false);
  expect((await request('https://db.test/rest/v1/posts?content=ilike.%cat%')).status).toBe(200);
  expect(transport).toHaveBeenCalledTimes(3);
 });
 it('permits writes after unfreezing and reports a newly frozen server response',async()=>{
  const feedback=vi.fn();window.addEventListener(SUSPENSION_EVENT,feedback);
  try{const transport=vi.fn(async()=>Response.json({code:'ACCOUNT_SUSPENDED'},{status:403}));await createSuspensionFetch('https://db.test',transport)('https://db.test/rest/v1/posts',{method:'POST'});expect(transport).toHaveBeenCalledOnce();expect(feedback).toHaveBeenCalledOnce();}finally{window.removeEventListener(SUSPENSION_EVENT,feedback);}
 });
});
