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
