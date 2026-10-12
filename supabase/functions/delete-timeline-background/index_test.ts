import {handleDeleteBackground} from './index.ts';
const actor='11111111-1111-4111-8111-111111111111';
for(const [name,value] of Object.entries({SUPABASE_URL:'https://db.test',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',CLOUDINARY_CLOUD_NAME:'cloud',CLOUDINARY_API_KEY:'key',CLOUDINARY_API_SECRET:'secret'}))Deno.env.set(name,value);
function assert(value:unknown){if(!value)throw Error('Assertion failed');}
const request=(body:string)=>new Request('https://edge.test',{method:'POST',headers:{authorization:'Bearer test','content-type':'application/json'},body});
async function mocked(run:()=>Promise<void>,handler:(url:URL,init?:RequestInit)=>Response){
 const original=fetch;
 globalThis.fetch=((input:Request|string|URL,init?:RequestInit)=>{
  const url=new URL(input instanceof Request?input.url:String(input));
  if(url.pathname==='/auth/v1/user')return Promise.resolve(Response.json({id:actor}));
  return Promise.resolve(handler(url,init));
 }) as typeof fetch;
 try{await run();}finally{globalThis.fetch=original;}
}
Deno.test('background deletion stops at quota and never calls the provider',()=>mocked(async()=>{
 assert((await handleDeleteBackground(request('{}'))).status===429);
},url=>{assert(url.pathname.endsWith('/consume_security_quota'));return Response.json(false);}));
Deno.test('background deletion rejects oversized requests before profile/provider work',()=>mocked(async()=>{
 assert((await handleDeleteBackground(request('x'.repeat(5000)))).status===400);
},url=>{assert(url.pathname.endsWith('/consume_security_quota'));return Response.json(true);}));
Deno.test('background deletion cannot clear a concurrently replaced background',()=>{
 const publicId=`timeline_backgrounds/${actor}/old`;let patched=false,deleted=false;
 return mocked(async()=>{
  assert((await handleDeleteBackground(request(JSON.stringify({publicId})))).status===200);
  assert(deleted&&patched);
 },(url,init)=>{
  if(url.pathname.endsWith('/consume_security_quota'))return Response.json(true);
  if(url.pathname.endsWith('/image/destroy')){assert(init?.redirect==='error'&&init.signal);deleted=true;return Response.json({result:'ok'});}
  assert(url.pathname.endsWith('/profiles'));
  if(init?.method==='PATCH'){
   assert(url.searchParams.get('id')===`eq.${actor}`);
   assert(url.searchParams.get('timeline_background_public_id')===`eq.${publicId}`);
   patched=true;return new Response(null,{status:204});
  }
  return Response.json({timeline_background_public_id:publicId});
 });
});
