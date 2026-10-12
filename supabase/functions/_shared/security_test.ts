import { boundedBody, secretMatches } from './security.ts';
function assert(value: boolean) {if(!value) throw new Error('Assertion failed');}
Deno.test('cron and webhook secrets fail closed',async()=>{
 assert(!await secretMatches(null,undefined));assert(!await secretMatches('attacker',undefined));
 assert(!await secretMatches('',''));assert(!await secretMatches('wrong','secret'));assert(await secretMatches('secret','secret'));
});
Deno.test('request limits apply without trusting Content-Length',async()=>{
 const request=new Request('https://test.invalid',{method:'POST',body:'a'.repeat(100)});
 let rejected=false;try{await boundedBody(request,10);}catch{rejected=true;}assert(rejected);
 assert(await boundedBody(new Request('https://test.invalid',{method:'POST',body:'hello'}),10)==='hello');
});

Deno.test('frozen users fail closed before AI, uploads and token issuance; read authentication remains usable',async()=>{
 const {authenticate,quota,rejectSuspended}=await import('./security.ts');
 const keys=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'];const previous=keys.map(key=>Deno.env.get(key));keys.forEach((key,i)=>Deno.env.set(key,i===0?'https://db.test':'test'));
 const original=globalThis.fetch;let failure=false,quotaCalls=0;
 globalThis.fetch=(async(input)=>{
  const url=input instanceof Request?input.url:String(input);
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'11111111-1111-4111-8111-111111111111'});
  if(url.endsWith('/rpc/is_account_suspended'))return failure ? Response.json({message:'unavailable'},{status:500}) : Response.json(true);
  if(url.endsWith('/rpc/consume_security_quota')){quotaCalls++;return Response.json(true);}
  throw Error('Unexpected upstream request');
 }) as typeof fetch;
 try{
  const req=()=>new Request('https://edge.test',{headers:{authorization:'Bearer test'}});
  assert((await authenticate(req(),{})) instanceof Response);
  assert(!(await authenticate(req(),{},true) instanceof Response));
  for(const scope of ['chat','voice','token','upload'] as const)assert((await quota('actor',scope,{}))?.status===403);
  assert(quotaCalls===0);
  assert(await quota('actor','preview',{})===null);
  failure=true;assert((await rejectSuspended('actor',{}))?.status===503);
 }finally{globalThis.fetch=original;keys.forEach((key,i)=>previous[i]===undefined?Deno.env.delete(key):Deno.env.set(key,previous[i]!));}
});
