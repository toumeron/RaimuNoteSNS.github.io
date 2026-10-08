import {handleExternalNotifications} from './handler.ts';
function assert(value:unknown){if(!value)throw new Error('Assertion failed');}
Deno.test('worker rejects missing and incorrect secrets before any privileged database fetch',async()=>{
 const oldSecret=Deno.env.get('EXTERNAL_NOTIFICATIONS_CRON_SECRET');Deno.env.set('EXTERNAL_NOTIFICATIONS_CRON_SECRET','worker-test-secret');const original=globalThis.fetch;let requests=0;
 globalThis.fetch=()=>{requests++;throw new Error('Should not fetch');};
 try{for(const secret of [null,'wrong-secret']){const response=await handleExternalNotifications(new Request('https://worker.test',{method:'POST',headers:secret?{'x-notifications-secret':secret}:{}}));assert(response.status===401);await response.text();}assert(requests===0);}
 finally{globalThis.fetch=original;if(oldSecret)Deno.env.set('EXTERNAL_NOTIFICATIONS_CRON_SECRET',oldSecret);else Deno.env.delete('EXTERNAL_NOTIFICATIONS_CRON_SECRET');}
});
Deno.test('worker records source events for an existing subscription and reports failures independently',async()=>{
 const old={secret:Deno.env.get('EXTERNAL_NOTIFICATIONS_CRON_SECRET'),url:Deno.env.get('SUPABASE_URL'),key:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')};Deno.env.set('EXTERNAL_NOTIFICATIONS_CRON_SECRET','worker-test-secret');Deno.env.set('SUPABASE_URL','https://db.test');Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','private-test-key');const original=globalThis.fetch;let recorded=false;
 globalThis.fetch=async(input,init)=>{const url=String(input);if(url.includes('post_notification_subscriptions?select='))return Response.json([{id:'subscription',provider:'bluesky',external_actor:'alice.bsky.social',created_at:'2026-10-08T00:00:00Z'}]);if(url.startsWith('https://public.api.bsky.app/'))return Response.json({feed:[{post:{uri:'at://did:plc:alice/app.bsky.feed.post/new',indexedAt:'2026-10-08T10:00:00Z',author:{handle:'alice.bsky.social'},record:{text:'new'}}}]});if(url.endsWith('/rpc/record_external_post_notifications')){const body=JSON.parse(String(init?.body));assert(body.subscription==='subscription');assert(body.events[0].id.startsWith('bsky:at://'));assert(body.cursor.seen.length===1);recorded=true;return Response.json(1);}throw new Error('Unexpected fetch');};
 try{const response=await handleExternalNotifications(new Request('https://worker.test',{method:'POST',headers:{'x-notifications-secret':'worker-test-secret'}}));const body=await response.json();assert(recorded&&response.status===200&&body.inserted===1&&body.failed===0);}
 finally{globalThis.fetch=original;for(const [name,value]of [['EXTERNAL_NOTIFICATIONS_CRON_SECRET',old.secret],['SUPABASE_URL',old.url],['SUPABASE_SERVICE_ROLE_KEY',old.key]])if(value)Deno.env.set(name!,value);else Deno.env.delete(name!);}
});
