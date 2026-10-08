import {secretMatches} from '../_shared/security.ts';
import {fetchExternalEvents,type ExternalTarget} from './sources.ts';
export async function handleExternalNotifications(request:Request):Promise<Response>{
 if(request.method!=='POST')return new Response('Method not allowed',{status:405});
 if(!await secretMatches(request.headers.get('x-notifications-secret'),Deno.env.get('EXTERNAL_NOTIFICATIONS_CRON_SECRET')))return new Response('Unauthorized',{status:401});
 const root=Deno.env.get('SUPABASE_URL')!;const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
 async function rest(path:string,body?:unknown){const response=await fetch(`${root}/rest/v1/${path}`,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`Database HTTP ${response.status}`);return response.json();}
 try{
  const targets:ExternalTarget[]=await rest('post_notification_subscriptions?select=id,provider,external_actor,created_at,external_cursor&provider=neq.limenote&order=last_checked_at.asc.nullsfirst&limit=40');
  const cache=new Map<string,Promise<Awaited<ReturnType<typeof fetchExternalEvents>>>>();let inserted=0;let failed=0;let checked=0;const started=Date.now();
  const queue=[...targets];
  await Promise.all(Array.from({length:4},async()=>{for(let target=queue.shift();target;target=queue.shift()){
   if(Date.now()-started>50000)break;checked++;
   try{
    // Per subscription timestamps/cursors must be honored independently.
    const cacheKey=`${target.provider}:${target.external_actor}:${target.created_at}:${JSON.stringify(target.external_cursor)}`;
    if(!cache.has(cacheKey))cache.set(cacheKey,fetchExternalEvents(target));
    const events=await cache.get(cacheKey)!;
    const seen=[...new Set([...events.map(event=>event.id).reverse(),...(target.external_cursor?.seen??[])])].slice(0,1000);
    inserted+=await rest('rpc/record_external_post_notifications',{subscription:target.id,events,cursor:{seen}});
   }catch{failed++; // Back off failing actors so one outage cannot starve other subscriptions.
    await fetch(`${root}/rest/v1/post_notification_subscriptions?id=eq.${target.id}`,{method:'PATCH',headers,body:JSON.stringify({last_checked_at:new Date().toISOString()}),signal:AbortSignal.timeout(10000)}).catch(()=>{});
   }
  }}));
  return Response.json({checked,inserted,failed},{status:failed===checked&&failed>0?502:200});
 }catch(error){
  // Log only the status we generate, never database bodies, tokens or user data.
  const status=error instanceof Error?error.message.match(/^Database HTTP (\d{3})$/)?.[1]:undefined;
  return Response.json({error:'External notification check failed',...(status?{database_status:Number(status)}:{})},{status:500});
 }
}

