import { Input, BufferSource, ALL_FORMATS } from "mediabunny";
import { AwsClient } from "aws4fetch";

// worker.mjs
export const MAX_BYTES=36*1024*1024;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function inspectVideo(bytes){
 const input=new Input({source:new BufferSource(bytes),formats:ALL_FORMATS});
 try{const track=await input.getPrimaryVideoTrack();const duration=await input.computeDuration();
  if(!track||!Number.isFinite(duration)||duration<=0||duration>90)throw new Error('動画は90秒以内にしてください');
  const width=track.displayWidth,height=track.displayHeight;
  if(Math.max(width,height)>1920||Math.min(width,height)>1080||width<2||height<2)throw new Error('動画は1080p以下に圧縮してください');
  if((await track.getCodec())!=='avc')throw new Error('動画はH.264のMP4形式にしてください');
  const format=await input.getFormat();if(format.name!=='MP4')throw new Error('MP4形式にしてください');
  return {duration,width,height,size:bytes.byteLength,mimeType:'video/mp4'};
 }finally{input.dispose();}
}
async function boundedBytes(request){
 const length=Number(request.headers.get('content-length'));if(length>MAX_BYTES+160000)throw new Error('動画のサイズが大きすぎます');
 const reader=request.body?.getReader();if(!reader)throw new Error('動画がありません');const chunks=[];let size=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES+160000)throw new Error('動画のサイズが大きすぎます');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
export function createVideoWorker({getStorage=storage,inspect=inspectVideo,transport=fetch}={}){
 return {async fetch(request,env){
  const origin=request.headers.get('Origin'),allowed=(env.ALLOWED_ORIGINS||'').split(',');
  const cors={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(origin&&allowed.includes(origin)?{'Access-Control-Allow-Origin':origin,Vary:'Origin'}:{})};
  const reply=(body,status=200)=>Response.json(body,{status,headers:cors});
  if(origin&&!allowed.includes(origin))return reply({error:'許可されていないアクセスです'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET,HEAD,POST,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type,Range','Access-Control-Expose-Headers':'Content-Length,Content-Range,Accept-Ranges','Access-Control-Max-Age':'600'}});
  const authorization=request.headers.get('Authorization');
  const rest=async(path,auth=authorization)=>transport(`${env.SUPABASE_URL}/rest/v1/${path}`,{headers:{apikey:env.SUPABASE_ANON_KEY,...(auth?{Authorization:auth}:{})},redirect:'manual',cache:'no-store'});
  const readPost=async(id,auth=authorization)=>{const response=await rest(`posts?id=eq.${id}&select=id,user_id,video`,auth);if(!response.ok)throw new Error('投稿の閲覧権限を確認できませんでした');return (await response.json())[0];};
  try{
   const parts=new URL(request.url).pathname.split('/').filter(Boolean),action=parts[0],id=parts[1];
   if(action==='health'&&parts.length===1&&request.method==='GET'){
    const [database,object]=await Promise.all([rest('posts?select=id&limit=0',null),getStorage(env).get('__video_storage_probe__',null,true)]);
    const ok=database.ok&&[200,404].includes(object.status);return reply({ready:ok},ok?200:503);
   }
   if(['media','poster','access'].includes(action)&&uuid.test(id||'')&&parts.length===2&&['GET','HEAD'].includes(request.method)){
    const post=await readPost(id);if(!post?.video)return reply({error:'動画を閲覧できません'},404);
    if(action==='access'){const publicPost=await readPost(id,null);return reply({public:!!publicPost?.video});}
    const key=action==='poster'?post.video.posterKey:post.video.key;
    if(!key||!key.startsWith(`${post.user_id}/${id}/`))return reply({error:'動画を閲覧できません'},404);
    const object=await getStorage(env).get(key,request.headers.get('Range'),request.method==='HEAD');
    const headers=new Headers(cors);for(const name of ['Content-Type','Content-Length','Content-Range','Accept-Ranges','ETag'])if(object.headers.has(name))headers.set(name,object.headers.get(name));
    return new Response(request.method==='HEAD'?null:object.body,{status:object.status,headers});
   }
   const deletingPost=action==='posts'&&request.method==='DELETE'&&parts.length===2&&uuid.test(id||'');
   if((action!=='uploads'&&!deletingPost)||!authorization)return reply({error:'ログインしてください'},401);
   const userResponse=await transport(`${env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:authorization},redirect:'manual'});
   if(!userResponse.ok)return reply({error:'ログインしてください'},401);const user=await userResponse.json();if(!uuid.test(user.id))return reply({error:'ログインしてください'},401);
   const suspended=await transport(`${env.SUPABASE_URL}/rest/v1/rpc/is_account_suspended`,{method:'POST',headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({account_id:user.id}),redirect:'manual'});
   if(!suspended.ok||await suspended.json()!==false)return reply({error:'凍結中は動画を投稿できません'},403);
   if(deletingPost){
    const post=await readPost(id);
    if(!post)return reply({ok:true}); // A completed deletion can be retried safely.
    if(post.user_id!==user.id)return reply({error:'自分の投稿だけを削除できます'},403);
    const prefix=`${user.id}/${id}/`,key=post.video?.key,poster=post.video?.posterKey;
    const validKey=(value,extension)=>typeof value==='string'&&value.startsWith(prefix)&&value.slice(prefix.length).endsWith(extension)&&uuid.test(value.slice(prefix.length,-extension.length));
    if(!validKey(key,'.mp4')||(poster&&!validKey(poster,'.jpg')))return reply({error:'動画の保存先を確認できませんでした'},400);
    const keys=[...new Set([key,key.replace(/\.mp4$/,'.jpg'),...(poster?[poster]:[])])],store=getStorage(env);
    // Keep posts.video until every file is gone, so a failed cleanup remains retryable.
    const removed=await Promise.allSettled(keys.map(key=>store.delete(key)));
    if(removed.some(result=>result.status==='rejected'))return reply({error:'動画ファイルを削除できませんでした。もう一度削除をお試しください'},502);
    const response=await transport(`${env.SUPABASE_URL}/rest/v1/posts?id=eq.${id}&user_id=eq.${user.id}&select=id`,{method:'DELETE',headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:authorization,Prefer:'return=representation'},redirect:'manual',cache:'no-store'});
    if(!response.ok)return reply({error:'投稿を削除できませんでした。もう一度削除をお試しください'},502);
    const rows=await response.json();
    if(!Array.isArray(rows)||(!rows.some(row=>row.id===id)&&await readPost(id)))return reply({error:'投稿を削除できませんでした。もう一度削除をお試しください'},502);
    return reply({ok:true});
   }
   if(request.method==='POST'&&uuid.test(id||'')&&parts.length===2){
    const existing=await readPost(id);if(existing)return reply({error:'既存の投稿にはアップロードできません'},409);
    const bytes=await boundedBytes(request);
    let videoBytes=bytes,poster;
    if(request.headers.get('Content-Type')?.startsWith('multipart/form-data')){const form=await new Response(bytes,{headers:{'Content-Type':request.headers.get('Content-Type')}}).formData();const file=form.get('video'),image=form.get('poster');if(!(file instanceof Blob))return reply({error:'動画がありません'},400);videoBytes=new Uint8Array(await file.arrayBuffer());if(image instanceof Blob&&image.size<=150000){const raw=new Uint8Array(await image.arrayBuffer());if(raw[0]===255&&raw[1]===216&&raw[2]===255)poster=raw;}}
    if(videoBytes.byteLength>MAX_BYTES)return reply({error:'動画のサイズが大きすぎます'},413);
    const video=await inspect(videoBytes);const key=`${user.id}/${id}/${crypto.randomUUID()}.mp4`;const store=getStorage(env);await store.put(key,videoBytes,'video/mp4');
    try{if(poster){video.posterKey=key.replace(/\.mp4$/,'.jpg');await store.put(video.posterKey,poster,'image/jpeg');}}catch(error){await store.delete(key);throw error;}
    return reply({video:{...video,key}},201);
   }
   if(request.method==='DELETE'&&parts.length===4&&parts[1]===user.id&&uuid.test(parts[2])&&/^[0-9a-f-]{36}\.mp4$/i.test(parts[3])){
    if(await readPost(parts[2]))return reply({error:'投稿済みの動画は削除できません'},409);
    const key=parts.slice(1).join('/'),store=getStorage(env);await store.delete(key);await store.delete(key.replace(/\.mp4$/,'.jpg'));return reply({ok:true});
   }
   return reply({error:'見つかりません'},404);
  }catch(error){return reply({error:error instanceof Error?error.message:'動画の処理に失敗しました'},400);}
 }};
}
export default createVideoWorker();


// storage.mjs
// B2 uses its S3-compatible API. A private R2 binding can be used alternatively.
export function storage(env){
 if(env.VIDEOS)return {
  put:async(key,body,type)=>env.VIDEOS.put(key,body,{httpMetadata:{contentType:type,cacheControl:'private, no-store'}}),
  get:async(key,range,head)=>{const object=head?await env.VIDEOS.head(key):await env.VIDEOS.get(key,range?{range:new Headers({Range:range})}:undefined);if(!object)return new Response(null,{status:404});const headers=new Headers({'Content-Type':object.httpMetadata?.contentType||'video/mp4','Content-Length':String(object.range?.length??object.size),ETag:object.httpEtag,'Accept-Ranges':'bytes'});if(object.range)headers.set('Content-Range',`bytes ${object.range.offset}-${object.range.offset+object.range.length-1}/${object.size}`);return new Response(head?null:object.body,{status:object.range?206:200,headers});},
  delete:key=>env.VIDEOS.delete(key)
 };
 const endpoint=new URL(env.S3_ENDPOINT);if(endpoint.protocol!=='https:'||!/^s3\.[a-z0-9-]+\.backblazeb2\.com$/.test(endpoint.hostname))throw new Error('Backblaze B2 endpoint is not configured');
 if(!/^[a-zA-Z0-9.-]{3,63}$/.test(env.S3_BUCKET||''))throw new Error('Video bucket is not configured');
 const client=new AwsClient({accessKeyId:env.S3_ACCESS_KEY_ID,secretAccessKey:env.S3_SECRET_ACCESS_KEY,service:'s3',region:env.S3_REGION});
 const url=key=>`${endpoint.origin}/${env.S3_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
 return {
  put:async(key,body,type)=>{const response=await client.fetch(url(key),{method:'PUT',redirect:'manual',headers:{'Content-Type':type,'Cache-Control':'private, no-store'},body});if(!response.ok)throw new Error('動画をクラウドに保存できませんでした');},
  get:(key,range,head)=>client.fetch(url(key),{method:head?'HEAD':'GET',redirect:'manual',headers:range?{Range:range}:{}}),
  delete:async key=>{const head=await client.fetch(url(key),{method:'HEAD',redirect:'manual'});if(head.status===404)return;if(!head.ok)throw new Error('動画を削除できませんでした');const version=head.headers.get('x-amz-version-id');if(!version)throw new Error('動画の保存バージョンを確認できませんでした');const target=new URL(url(key));target.searchParams.set('versionId',version);const response=await client.fetch(target,{method:'DELETE',redirect:'manual'});if(!response.ok&&response.status!==404)throw new Error('動画を削除できませんでした');}
 };
}
