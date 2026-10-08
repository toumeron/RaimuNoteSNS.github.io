import {authenticate, boundedRequest, quota} from '../_shared/security.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{headers});
 if(request.method!=='POST')return Response.json({error:'Method not allowed'},{status:405,headers});
 const actor=await authenticate(request,headers);if(actor instanceof Response)return actor;
 const limited=await quota(actor.userId,'upload',headers);if(limited)return limited;
 try{
  const form=await (await boundedRequest(request,8*1024*1024+65536)).formData();
  const file=form.get('file'),kind=form.get('kind');
  if(!(file instanceof File)||file.size===0||file.size>8*1024*1024||!['image/png','image/jpeg','image/webp','image/gif','image/avif'].includes(file.type)||!['timeline-background','emoji'].includes(String(kind)))return Response.json({error:'画像の形式またはサイズが正しくありません'},{status:400,headers});
  const cloud=Deno.env.get('CLOUDINARY_CLOUD_NAME'),apiKey=Deno.env.get('CLOUDINARY_API_KEY'),secret=Deno.env.get('CLOUDINARY_API_SECRET');
  if(!cloud||!apiKey||!secret)return Response.json({error:'画像サービスが設定されていません'},{status:503,headers});
  const timestamp=String(Math.floor(Date.now()/1000));
  const publicId=`${kind==='emoji'?'custom_emojis':'timeline_backgrounds'}/${actor.userId}/${crypto.randomUUID()}`;
  const sign=`overwrite=false&public_id=${publicId}&timestamp=${timestamp}${secret}`;
  const digest=await crypto.subtle.digest('SHA-1',new TextEncoder().encode(sign));
  const signature=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  const upstream=new FormData();
  upstream.set('file',file);upstream.set('api_key',apiKey);upstream.set('timestamp',timestamp);upstream.set('public_id',publicId);upstream.set('overwrite','false');upstream.set('signature',signature);
  const response=await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/upload`,{method:'POST',body:upstream,redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('Upload failed');
  const result=await response.json();
  if(result.public_id!==publicId||typeof result.secure_url!=='string'||!result.secure_url.startsWith(`https://res.cloudinary.com/${cloud}/`))throw new Error('Invalid provider response');
  return Response.json({secure_url:result.secure_url,public_id:result.public_id,format:result.format},{headers});
 }catch{return Response.json({error:'画像のアップロードに失敗しました'},{status:400,headers});}
});
