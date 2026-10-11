import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {authenticate,boundedRequest,quota} from '../_shared/security.ts';
import {cloudinarySignature,cloudinaryDownloadUrl} from '../direct-media/signing.ts';
async function providerFetch(url:string,options:RequestInit){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30000);try{return await fetch(url,{...options,signal:controller.signal});}finally{clearTimeout(timer);}}
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};
export async function handleListMedia(request:Request):Promise<Response> {
 if(request.method==='OPTIONS')return new Response(null,{headers});
 if(request.method!=='POST')return Response.json({error:'Method not allowed'},{status:405,headers});
 try{
 const cloud=Deno.env.get('CLOUDINARY_CLOUD_NAME'),key=Deno.env.get('CLOUDINARY_API_KEY'),secret=Deno.env.get('CLOUDINARY_API_SECRET');
 if(!cloud||!key||!secret)return Response.json({error:'画像サービスが設定されていません'},{status:503,headers});
 const uuid=/^[0-9a-f-]{36}$/i;
 if(request.headers.get('content-type')?.includes('multipart/form-data')){
  const actor=await authenticate(request,headers);if(actor instanceof Response)return actor;
  const limited=await quota(actor.userId,'upload',headers);if(limited)return limited;
  const form=await(await boundedRequest(request,8*1024*1024+65536)).formData(),file=form.get('file'),listId=String(form.get('listId'));
  if(!uuid.test(listId)||!(file instanceof File)||!file.size||file.size>8*1024*1024||!['image/png','image/jpeg','image/webp','image/gif','image/avif'].includes(file.type))return Response.json({error:'画像は対応形式で8MB以内にしてください'},{status:400,headers});
  const viewer=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:request.headers.get('authorization')??''}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:existing,error:readError}=await viewer.from('user_lists').select('owner_id').eq('id',listId).maybeSingle();if(readError)throw readError;if(existing&&existing.owner_id!==actor.userId)return Response.json({error:'Not owner'},{status:403,headers});
  const publicId=`lists/${actor.userId}/${listId}/${crypto.randomUUID()}`;
  const params={overwrite:'false',public_id:publicId,timestamp:String(Math.floor(Date.now()/1000)),type:'authenticated'};
  const body=new FormData();body.set('file',file);for(const [name,value]of Object.entries(params))body.set(name,value);body.set('api_key',key);body.set('signature',await cloudinarySignature(params,secret));
  const result=await providerFetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/upload`,{method:'POST',body,redirect:'error'});
  if(!result.ok)throw new Error('Upload failed');const asset=await result.json();if(asset.public_id!==publicId||!['png','jpg','webp','gif','avif'].includes(asset.format))throw new Error('Invalid asset');
  return Response.json({ref:`cloudinary:${publicId}.${asset.format}`},{headers});
 }
 const body=await(await boundedRequest(request,16384)).json();
 if(body.action==='resolve'){
  if(!Array.isArray(body.listIds)||body.listIds.length>100||body.listIds.some((id:unknown)=>typeof id!=='string'||!uuid.test(id)))return Response.json({error:'Invalid lists'},{status:400,headers});
  const viewer=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:request.headers.get('authorization')??''}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await viewer.from('user_lists').select('id,owner_id,cover_ref').in('id',body.listIds);if(error)throw error;
  const urls:Record<string,string>={};for(const list of data??[]){const ref=list.cover_ref;if(typeof ref!=='string'||!ref.startsWith(`cloudinary:lists/${list.owner_id}/${list.id}/`))continue;const asset=ref.slice(11).match(/^(.*)\.(png|jpg|webp|gif|avif)$/);if(asset)urls[ref]=await cloudinaryDownloadUrl(cloud,key,secret,asset[1],asset[2]);}
  return Response.json({urls},{headers});
 }
 if(body.action==='discard'){
  const actor=await authenticate(request,headers);if(actor instanceof Response)return actor;
  if(!Array.isArray(body.refs)||body.refs.length>4)return Response.json({error:'Invalid assets'},{status:400,headers});
  const service=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  for(const ref of body.refs){const match=typeof ref==='string'?ref.match(/^cloudinary:lists\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(png|jpg|webp|gif|avif)$/i):null;if(!match||match[1]!==actor.userId)return Response.json({error:'Not owner'},{status:403,headers});
   const {data,error}=await service.from('user_lists').select('cover_ref').eq('id',match[2]).maybeSingle();if(error)throw error;if(data?.cover_ref===ref)continue;
   const params={public_id:ref.slice(11).replace(/\.[^.]+$/,''),timestamp:String(Math.floor(Date.now()/1000)),type:'authenticated'};const form=new FormData();for(const [name,value]of Object.entries(params))form.set(name,value);form.set('api_key',key);form.set('signature',await cloudinarySignature(params,secret));
   const response=await providerFetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/destroy`,{method:'POST',body:form,redirect:'error'});if(!response.ok)throw new Error('Cleanup failed');
  }return Response.json({ok:true},{headers});
 }
 return Response.json({error:'Invalid action'},{status:400,headers});
 }catch{return Response.json({error:'リスト画像を処理できませんでした'},{status:400,headers});}
}
if(import.meta.main)Deno.serve(handleListMedia);
