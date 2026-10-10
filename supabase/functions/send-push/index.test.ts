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
