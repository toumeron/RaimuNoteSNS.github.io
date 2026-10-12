import {handleListMedia} from './index.ts';
function assert(value:unknown,message='Assertion failed'):asserts value {if(!value)throw new Error(message);}
Deno.test('list images authenticate uploads, sign private assets, resolve only visible posts, and reject deleting another owner asset',async()=>{
 const owner='11111111-1111-4111-8111-111111111111',listId='22222222-2222-4222-8222-222222222222';
 const names=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET'];
 const previous=names.map(name=>Deno.env.get(name));names.forEach((name,index)=>Deno.env.set(name,index===0?'https://example.supabase.co':index===3?'test-cloud':'test-value'));
 const original=globalThis.fetch;let uploaded='',visible=true;
 globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=input instanceof Request?input.url:String(input);
  if(url.includes('/auth/v1/user'))return Response.json({id:owner,aud:'authenticated'});
  if(url.includes('/rpc/is_account_suspended'))return Response.json(false);
  if(url.includes('/rpc/consume_security_quota'))return Response.json(true);
  if(url.includes('/image/upload')){const form=init?.body as FormData;assert(form.get('type')==='authenticated');assert(typeof form.get('signature')==='string');uploaded=String(form.get('public_id'));assert(uploaded.startsWith(`lists/${owner}/${listId}/`));return Response.json({public_id:uploaded,format:'png'});}
  if(url.includes('/rest/v1/user_lists'))return Response.json(url.includes('select=owner_id')?[{owner_id:owner}]:visible?[{id:listId,owner_id:owner,cover_ref:`cloudinary:${uploaded}.png`}]:[]);
  throw new Error('Unexpected request');
 }) as typeof fetch;
 const json=(body:unknown)=>new Request('https://example.test/list-media',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer test-user'},body:JSON.stringify(body)});
 try{
  const form=new FormData();form.set('listId',listId);form.set('file',new File(['image'],'image.png',{type:'image/png'}));
  assert((await handleListMedia(new Request('https://example.test/list-media',{method:'POST',body:form}))).status===401);
  const upload=await handleListMedia(new Request('https://example.test/list-media',{method:'POST',headers:{Authorization:'Bearer test-user'},body:form}));assert(upload.status===200);const asset=await upload.json();assert(asset.ref===`cloudinary:${uploaded}.png`);
  const resolved=await(await handleListMedia(json({action:'resolve',listIds:[listId]}))).json();const url=new URL(resolved.urls[asset.ref]);assert(url.searchParams.get('type')==='authenticated');assert(url.searchParams.get('format')==='png');assert(Number(url.searchParams.get('expires_at'))>Date.now()/1000);
  visible=false;assert(Object.keys((await(await handleListMedia(json({action:'resolve',listIds:[listId]}))).json()).urls).length===0);
  assert((await handleListMedia(json({action:'discard',refs:[`cloudinary:lists/33333333-3333-4333-8333-333333333333/${listId}/44444444-4444-4444-8444-444444444444.png`]}))).status===403);
 }finally{globalThis.fetch=original;names.forEach((name,index)=>previous[index]===undefined?Deno.env.delete(name):Deno.env.set(name,previous[index]!));}
});
