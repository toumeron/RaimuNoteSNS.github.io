import {handlePush,getNotificationTitle,getNotificationBody,getNotificationUrl} from './index.ts';
const recipient='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
const record={id:'notice',user_id:recipient,actor_id:actor,type:'dm',actor_name:'かぎとれ',content_preview:'草',conversation_id:'conversation',direct_message_id:'message'};
Deno.test('DM and requests use sender names, content and a conversation link',()=>{for(const type of ['dm','dm_request']){const item={...record,type};if(getNotificationTitle(item)!=='かぎとれ'||getNotificationBody(item)!=='草'||getNotificationUrl('https://lime.example',item)!=='https://lime.example/RaimuNoteSNS.github.io/messages/conversation')throw Error(type);}});
for(const [name,valid,read]of [['private sender can notify a conversation participant',true,false],['nonparticipant recipient cannot receive private content',false,false],['already viewed message does not send a delayed push',true,true]] as const)Deno.test(name,async()=>{
 for(const [key,value]of Object.entries({PUSH_WEBHOOK_SECRET:'test',SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'service',VAPID_PUBLIC_KEY:'key',VAPID_PRIVATE_KEY:'secret'}))Deno.env.set(key,value);
 const previous=globalThis.fetch;let subscriptions=0;globalThis.fetch=(async(input:Request|URL|string)=>{const url=new URL(input instanceof Request?input.url:String(input));let data:unknown=[];
 if(url.pathname.endsWith('/notifications'))data=[record];
 else if(url.pathname.endsWith('/profile_private_settings'))data=[];
 else if(url.pathname.endsWith('/direct_conversations'))data=[{user_low:valid?recipient:'other',user_high:actor,status:'pending',read_low:read?'2026-10-10T12:00:00Z':'1970-01-01T00:00:00Z',read_high:'1970-01-01T00:00:00Z'}];
 else if(url.pathname.endsWith('/direct_messages'))data=[{sender_id:actor,conversation_id:'conversation',created_at:'2026-10-10T11:00:00Z'}];
 else if(url.pathname.endsWith('/push_subscriptions'))subscriptions++;
 else throw Error('Unexpected public-profile privacy check or push');return Response.json(data);
 }) as typeof fetch;
 try{const response=await handlePush(new Request('https://edge.test',{method:'POST',headers:{'x-push-secret':'test','content-type':'application/json'},body:'{"notification_id":"notice"}'}));if(response.status!==200||subscriptions!==(valid&&!read?1:0))throw Error(JSON.stringify(await response.json()));}finally{globalThis.fetch=previous;}
});
for(const [name,status,muted,request,expiry,allowed]of [
 ['accepted group member gets DM push','accepted',false,false,false,true],
 ['removed group member cannot get DM push','removed',false,false,false,false],
 ['muted group cannot get DM push','accepted',true,false,false,false],
 ['pending group member gets invitation push','pending',false,true,false,true],
 ['pending group member cannot get group content','pending',false,false,false,false],
] as const)Deno.test(name,async()=>{
 for(const [key,value]of Object.entries({PUSH_WEBHOOK_SECRET:'test',SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'service',VAPID_PUBLIC_KEY:'key',VAPID_PRIVATE_KEY:'secret'}))Deno.env.set(key,value);
 const previous=globalThis.fetch;let subscriptions=0;
 globalThis.fetch=(async(input:Request|URL|string)=>{const url=new URL(input instanceof Request?input.url:String(input));let data:unknown=[];
  if(url.pathname.endsWith('/notifications'))data=[{...record,type:request?'dm_request':'dm'}];
  else if(url.pathname.endsWith('/profile_private_settings'))data=[];
  else if(url.pathname.endsWith('/direct_conversations'))data=[{is_group:true,status:'accepted',group_members:{[actor]:{status:'accepted'},[recipient]:{status,muted}}}];
  else if(url.pathname.endsWith('/direct_messages'))data=[{sender_id:actor,conversation_id:'conversation',created_at:'2026-10-10T11:00:00Z',system_event:request?'group_created':null,expires_at:expiry?'1970-01-01T00:00:00Z':null}];
  else if(url.pathname.endsWith('/push_subscriptions'))subscriptions++;
  else throw Error('Unexpected fetch');return Response.json(data);
 }) as typeof fetch;
 try{const response=await handlePush(new Request('https://edge.test',{method:'POST',headers:{'x-push-secret':'test','content-type':'application/json'},body:'{"notification_id":"notice"}'}));if(response.status!==200||subscriptions!==(allowed?1:0))throw Error(JSON.stringify(await response.json()));}finally{globalThis.fetch=previous;}
});
for(const mode of ['deleted','hidden'] as const)Deno.test(`${mode} DM does not send delayed push`,async()=>{
 for(const [key,value]of Object.entries({PUSH_WEBHOOK_SECRET:'test',SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'service',VAPID_PUBLIC_KEY:'key',VAPID_PRIVATE_KEY:'secret'}))Deno.env.set(key,value);
 const previous=globalThis.fetch;let subscriptions=0;
 globalThis.fetch=(async(input:Request|URL|string)=>{const url=new URL(input instanceof Request?input.url:String(input));let data:unknown=[];
 if(url.pathname.endsWith('/notifications'))data=[record];
 else if(url.pathname.endsWith('/profile_private_settings'))data=[];
 else if(url.pathname.endsWith('/direct_conversations'))data=[{user_low:recipient,user_high:actor,status:'accepted'}];
 else if(url.pathname.endsWith('/direct_messages'))data=[{sender_id:actor,conversation_id:'conversation',created_at:'2026-10-10T11:00:00Z',deleted_at:mode==='deleted'?'2026-10-10T12:00:00Z':null,hidden_by:mode==='hidden'?[recipient]:[]}];
 else if(url.pathname.endsWith('/push_subscriptions'))subscriptions++;
 else throw Error('Unexpected fetch');return Response.json(data);
 }) as typeof fetch;
 try{const response=await handlePush(new Request('https://edge.test',{method:'POST',headers:{'x-push-secret':'test','content-type':'application/json'},body:'{"notification_id":"notice"}'}));if(response.status!==200||subscriptions!==0)throw Error('Deleted message was pushed');}finally{globalThis.fetch=previous;}
});
