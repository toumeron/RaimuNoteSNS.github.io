import {loadGeoMapPins,geoMapJobs,loadGeoMapDetail} from './geoMaps.ts';
import { quota, boundedBody } from '../_shared/security.ts';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {loadPreview,loadImage,loadMisskey} from './load.ts';
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
  let mode:string|undefined;
  try{
    const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
    if(!token)return new Response('{}',{status:401,headers});
    const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!);
    const {data:auth,error}=await client.auth.getUser(token);
    if(error||!auth.user)return new Response('{}',{status:401,headers});
    const limited = await quota(auth.user.id, 'preview', headers); if (limited) return limited;
    const body=await boundedBody(request,4096);
    const input=JSON.parse(body);mode=input?.mode;
    // Retire inferred locations even for older clients still sending map-pins.
    if(mode==='map-pins')return Response.json({pins:[],next:[]},{headers});
    if(mode==='map-geo-pins'){
      const jobs=input.jobs ?? geoMapJobs(input.bounds,input.search ?? '');
      if(!Array.isArray(jobs)||jobs.length>4)throw new Error('Invalid geo map jobs');
      return Response.json(await loadGeoMapPins(jobs,Deno.env.get('FLICKR_API_KEY')),{headers});
    }
    if(mode==='map-geo-detail')return Response.json({post:await loadGeoMapDetail(input.id,Deno.env.get('FLICKR_API_KEY'))},{headers});
    if(mode==='misskey')return Response.json({data:await loadMisskey(input.endpoint,input.params)},{headers});
    if(input.mode==='image'){
      const image=await loadImage(input.url,new URL(Deno.env.get('SUPABASE_URL')!).hostname);
      return new Response(image,{headers:{...headers,'Content-Type':'application/octet-stream','X-Lime-Image-Type':image.type,'Access-Control-Expose-Headers':'X-Lime-Image-Type','Cache-Control':'no-store'}});
    }
    const original=publicUrl(input.url).href;
    const stored=cache.get(original);if(stored&&stored.expires>Date.now())return Response.json({preview:stored.preview},{headers});
    const preview=await loadPreview(original);
    if(cache.size>=500)cache.delete(cache.keys().next().value!);
    cache.set(original,{expires:Date.now()+(preview?3600000:300000),preview});
    return Response.json({preview},{headers});
  }catch(error){console.error('External reader failed',error instanceof Error?error.message:'failed');return ['map-pins','map-geo-pins','map-geo-detail'].includes(mode??'') ? Response.json({error:'地図の投稿位置を取得できませんでした'},{status:502,headers}) : mode==='misskey' ? Response.json({error:'Misskeyの取得に失敗しました'},{status:502,headers}) : Response.json({preview:null,retryable:true,reason:error instanceof Error&&(/^(Page HTTP \d{3}|Timeout|Private address|Amazon product unavailable)$/.test(error.message))?error.message:error instanceof Error?error.name:'Fetch failure'},{headers});}
});
