import {AwsClient} from 'aws4fetch';
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
