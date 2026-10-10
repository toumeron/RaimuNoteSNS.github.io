import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {authenticate,boundedRequest,quota} from '../_shared/security.ts';
import {cloudinarySignature,cloudinaryDownloadUrl} from './signing.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};
const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export async function handleDirectMedia(request:Request):Promise<Response>{
 if(request.method==='OPTIONS')return new Response(null,{headers});
 if(request.method!=='POST')return Response.json({error:'Method not allowed'},{status:405,headers});
 const actor=await authenticate(request,headers);if(actor instanceof Response)return actor;
 const cloud=Deno.env.get('CLOUDINARY_CLOUD_NAME'),key=Deno.env.get('CLOUDINARY_API_KEY'),secret=Deno.env.get('CLOUDINARY_API_SECRET');
 if(!cloud||!key||!secret)return Response.json({error:'画像サービスが設定されていません'},{status:503,headers});
 const service=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const viewer=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:request.headers.get('authorization')!}},auth:{persistSession:false,autoRefreshToken:false}});
 const destroy=async(ref:string)=>{const publicId=ref.slice('cloudinary:'.length),params={public_id:publicId,timestamp:String(Math.floor(Date.now()/1000)),type:'authenticated'};const body=new FormData();for(const [k,v] of Object.entries(params))body.set(k,v);body.set('api_key',key);body.set('signature',await cloudinarySignature(params,secret));const response=await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/destroy`,{method:'POST',body,redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Media cleanup failed');};
 try{
  const bounded=await boundedRequest(request,10*1024*1024+65536);
  if(request.headers.get('content-type')?.includes('multipart/form-data')){
   const limited=await quota(actor.userId,'upload',headers);if(limited)return limited;
   const form=await bounded.formData(),file=form.get('file'),conversationId=String(form.get('conversationId')??'');
   if(!uuid.test(conversationId)||!(file instanceof File)||!file.size||file.size>10*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type))return Response.json({error:'画像の形式またはサイズが正しくありません'},{status:400,headers});
   const {data:c,error:ce}=await service.from('direct_conversations').select('user_low,user_high,status,initiated_by,is_group,group_members').eq('id',conversationId).single();
   if(ce||!c||!(c.is_group?c.group_members?.[actor.userId]?.status==='accepted':[c.user_low,c.user_high].includes(actor.userId))||c.status==='declined')return Response.json({error:'この会話には添付できません'},{status:403,headers});
   if(c.status==='pending'){const {count,error}=await service.from('direct_messages').select('id',{count:'exact',head:true}).eq('conversation_id',conversationId);if(error||c.initiated_by!==actor.userId||count!==0)return Response.json({error:'リクエストの承認をお待ちください'},{status:403,headers});}
   const publicId=`direct_messages/${conversationId}/${actor.userId}/${crypto.randomUUID()}`,ref=`cloudinary:${publicId}`;
   const params={overwrite:'false',public_id:publicId,timestamp:String(Math.floor(Date.now()/1000)),type:'authenticated'};const upstream=new FormData();upstream.set('file',file);for(const [k,v]of Object.entries(params))upstream.set(k,v);upstream.set('api_key',key);upstream.set('signature',await cloudinarySignature(params,secret));
   const response=await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/upload`,{method:'POST',body:upstream,redirect:'error',signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw new Error('Upload failed');const result=await response.json();
   if(result.public_id!==publicId||result.type!=='authenticated'||!['jpg','jpeg','png','webp'].includes(result.format)){await destroy(ref);throw new Error('Invalid provider response');}
   const {error}=await service.rpc('register_direct_media',{target:conversationId,actor:actor.userId,ref,format:result.format});
   if(error){await destroy(ref);throw error;}
   return Response.json({ref},{headers});
  }
  const body=await bounded.json();
  if(body.action==='read'){
   const ids=body.messageIds;if(!Array.isArray(ids)||ids.length>50||!ids.length||ids.some(id=>typeof id!=='string'||!uuid.test(id)))return Response.json({error:'Invalid messages'},{status:400,headers});
   const {data:messages,error}=await viewer.from('direct_messages').select('id,conversation_id,attachments').in('id',ids);
   if(error||messages?.length!==new Set(ids).size)return Response.json({error:'画像を表示できません'},{status:403,headers});
   const conversationIds=[...new Set(messages.map(m=>m.conversation_id))];const {data:conversations,error:ce}=await service.from('direct_conversations').select('id,media_assets').in('id',conversationIds);if(ce)throw ce;
   const urls:Record<string,string>={};for(const message of messages){const assets=conversations?.find(c=>c.id===message.conversation_id)?.media_assets??{};for(const ref of message.attachments??[]){if(!ref.startsWith('cloudinary:'))continue;const asset=assets[ref];if(!asset)throw new Error('Missing asset');urls[ref]=await cloudinaryDownloadUrl(cloud,key,secret,ref.slice(11),asset.format);}}
   return Response.json({urls},{headers});
  }
  if(body.action==='discard'){
   if(!Array.isArray(body.refs)||body.refs.length>4)return Response.json({error:'Invalid assets'},{status:400,headers});
   for(const ref of body.refs){if(typeof ref!=='string')return Response.json({error:'Invalid asset'},{status:400,headers});const match=ref.match(/^cloudinary:direct_messages\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/i);if(!match||match[2]!==actor.userId)return Response.json({error:'Not the owner'},{status:403,headers});const {data:released,error}=await service.rpc('release_direct_media',{target:match[1],actor:actor.userId,ref});if(error)throw error;if(released)await destroy(ref);}
   return Response.json({ok:true},{headers});
  }
  return Response.json({error:'Invalid action'},{status:400,headers});
 }catch{return Response.json({error:'DM画像の処理に失敗しました'},{status:400,headers});}
}
if(import.meta.main)Deno.serve(handleDirectMedia);
