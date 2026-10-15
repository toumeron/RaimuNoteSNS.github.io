import {supabase} from '@/lib/supabase';
import {allowAccountWrite} from '@/lib/accountSuspension';
import type {PostVideo,PreparedVideo} from './postVideo';
export function videoServiceUrl():string {
 const value=import.meta.env.VITE_VIDEO_WORKER_URL?.replace(/\/$/,'');
 if(!value)throw new Error('動画保存サービスがまだ設定されていません');
 const url=new URL(value);if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw new Error('動画保存先の設定が無効です');
 return value;
}
async function headers(){const {data}=await supabase.auth.getSession();return data.session?{Authorization:`Bearer ${data.session.access_token}`} : {};}
export async function uploadPostVideo(video:PreparedVideo,postId:string):Promise<PostVideo> {
 if(!allowAccountWrite())throw new Error('凍結中は動画を投稿できません');
 const form=new FormData();form.set('video',video.file);if(video.poster)form.set('poster',video.poster,'poster.jpg');
 const response=await fetch(`${videoServiceUrl()}/uploads/${postId}`,{method:'POST',headers:await headers(),body:form});
 const body=await response.json();if(!response.ok)throw new Error(body.error||'動画を保存できませんでした');return body.video;
}
export async function discardPostVideo(video:PostVideo):Promise<void>{
 await fetch(`${videoServiceUrl()}/uploads/${video.key}`,{method:'DELETE',headers:await headers()}).catch(()=>{});
}
/** The worker verifies ownership, removes both objects, then deletes the post using user RLS. */
export async function deleteVideoPost(postId:string):Promise<void>{
 const response=await fetch(`${videoServiceUrl()}/posts/${encodeURIComponent(postId)}`,{method:'DELETE',headers:await headers()});
 const body=await response.json().catch(()=>null);
 if(!response.ok||body?.ok!==true)throw new Error(body?.error||'動画付き投稿を削除できませんでした');
}

/** Public media streams with Range. Restricted media remains a local blob, never a public URL. */
export async function resolvePostVideo(postId:string,signal:AbortSignal):Promise<{url:string;local:boolean}>{
 const base=videoServiceUrl(),auth=await headers();
 const access=await fetch(`${base}/access/${encodeURIComponent(postId)}`,{headers:auth,signal,cache:'no-store'});
 if(!access.ok)throw new Error('この動画を閲覧できません');
 const {public:publicAccess}=await access.json();
 const url=`${base}/media/${encodeURIComponent(postId)}`;
 if(publicAccess)return {url,local:false};
 const response=await fetch(url,{headers:auth,signal,cache:'no-store'});
 if(!response.ok)throw new Error('動画を読み込めませんでした');
 return {url:URL.createObjectURL(await response.blob()),local:true};
}

export async function resolvePostVideoPoster(postId:string,signal:AbortSignal):Promise<string>{
 const response=await fetch(`${videoServiceUrl()}/poster/${encodeURIComponent(postId)}`,{headers:await headers(),signal,cache:'no-store'});
 if(!response.ok)throw new Error('動画のプレビューを読み込めません');
 return URL.createObjectURL(await response.blob());
}
