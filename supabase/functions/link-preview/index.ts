import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {loadPreview} from './load.ts';
import {metadata,publicUrl} from './metadata.ts';
const baseHeaders={'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'};
const cache=new Map<string,{expires:number;preview:ReturnType<typeof metadata>}>();
Deno.serve(async request=>{
  const origin=request.headers.get('origin')??'';
  const allowed=origin==='https://toumeron.github.io'||/^http:\/\/(localhost|127\.0\.0\.1):(8080|4173)$/.test(origin);
  const headers={...baseHeaders,...(allowed?{'Access-Control-Allow-Origin':origin}:{}),Vary:'Origin'};
  if(origin&&!allowed)return new Response('{}',{status:403,headers});
  if(request.method==='OPTIONS')return new Response('ok',{headers});
  if(request.method!=='POST')return new Response('{}',{status:405,headers});
  try{
    const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
    if(!token)return new Response('{}',{status:401,headers});
    const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!);
    const {data:auth,error}=await client.auth.getUser(token);
    if(error||!auth.user)return new Response('{}',{status:401,headers});
    const body=await request.text();if(body.length>4096)throw new Error('Too large');
    const original=publicUrl(JSON.parse(body).url).href;
    const stored=cache.get(original);if(stored&&stored.expires>Date.now())return Response.json({preview:stored.preview},{headers});
    const preview=await loadPreview(original);
    if(cache.size>=500)cache.delete(cache.keys().next().value!);
    cache.set(original,{expires:Date.now()+(preview?3600000:300000),preview});
    return Response.json({preview},{headers});
  }catch(error){console.error('Link preview fetch failed',error instanceof Error?error.message:'failed');return Response.json({preview:null},{headers});}
});
