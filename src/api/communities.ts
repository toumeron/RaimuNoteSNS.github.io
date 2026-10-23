import {supabase} from '@/lib/supabase';
import {getCurrentUserId} from '@/lib/currentUser';
import type {User} from '@/types';
export type Community={id:string;owner_id:string;name:string;description:string;cover_url:string;join_mode:'open'|'approval';member_count:number;created_at:string};
export type CommunityMembership={community_id:string;user_id:string;role:'owner'|'moderator'|'member';status:'active'|'pending'|'invited'|'banned';pinned:boolean;spotlight:boolean;notifications:boolean};
type MemberProfile={id:string;username:string;display_name:string;avatar_url:string;cover_url:string;bio:string;created_at:string;is_private:boolean;is_official:boolean};
export type CommunityMember={user:User;role:CommunityMembership['role'];status:CommunityMembership['status']};
export const communityKeys={all:['communities'] as const,detail:(id:string)=>['communities','detail',id],mine:(uid:string)=>['communities','mine',uid]};
function check(error:{message?:string}|null){if(error)throw new Error(error.message||'コミュニティの操作に失敗しました。');}
export function isCloudinaryImage(url:string){try{const value=new URL(url);return value.protocol==='https:'&&value.hostname==='res.cloudinary.com'&&/^\/[^/]+\/image\/upload\//.test(value.pathname)}catch{return false}}
export async function uploadCommunityImage(file:File,ownerId:string,kind:'community-cover'|'community-post'){
 if(!['image/png','image/jpeg','image/webp','image/gif','image/avif'].includes(file.type)||!file.size||file.size>8*1024*1024)throw new Error('画像はPNG・JPEG・WebP・GIF・AVIF形式、8MB以内で選択してください。');
 const {uploadProfileMedia}=await import('@/lib/mediaThumbnail');const result=await uploadProfileMedia(file,kind,ownerId);if(!isCloudinaryImage(result.secure_url))throw new Error('画像の保存先を確認できませんでした。');return result.secure_url;
}
export async function uploadCommunityImages(urls:string[],ownerId:string){
 if(urls.length>4)throw new Error('画像は4枚まで添付できます。');
 if(urls.some(url=>!url.startsWith('blob:')&&!isCloudinaryImage(url)))throw new Error('端末の画像またはCloudinaryの画像を選択してください。');
 const result:string[]=[];for(const url of urls){if(isCloudinaryImage(url)){result.push(url);continue;}const response=await fetch(url);if(!response.ok)throw new Error('画像を読み込めませんでした。');const blob=await response.blob();result.push(await uploadCommunityImage(new File([blob],'community-image',{type:blob.type}),ownerId,'community-post'));}return result;
}
export async function getCommunity(id:string,signal?:AbortSignal):Promise<Community|null>{const {data,error}=await supabase.from('communities').select('*').eq('id',id).abortSignal(signal!).maybeSingle();check(error);return data;}
export async function findCommunities(search='',page=0,signal?:AbortSignal):Promise<Community[]>{
 let query=supabase.from('communities').select('*').order('created_at',{ascending:false}).order('id').range(page*30,page*30+29);
 if(search.trim())query=query.ilike('name',`%${search.trim().replace(/[%_\\]/g,'\\$&')}%`);
 const {data,error}=await query.abortSignal(signal!);check(error);return data??[];
}
export async function getMyCommunities():Promise<{memberships:CommunityMembership[];communities:Community[]}>{
 const {data,error}=await supabase.rpc('my_community_memberships');check(error);const memberships=(data??[]) as CommunityMembership[];
 const ids=memberships.filter(m=>m.status!=='banned').map(m=>m.community_id);if(!ids.length)return {memberships,communities:[]};
 const result=await supabase.from('communities').select('*').in('id',ids).order('created_at',{ascending:false});check(result.error);return {memberships,communities:result.data??[]};
}
export async function saveCommunity(input:Pick<Community,'name'|'description'|'join_mode'|'cover_url'>,id?:string):Promise<Community>{
 const uid=await getCurrentUserId();const payload={...input,name:input.name.trim(),description:input.description.trim()};
 if(!payload.name||payload.name.length>80||payload.description.length>2000||payload.cover_url&&!isCloudinaryImage(payload.cover_url))throw new Error('名前・説明・画像を確認してください。');
 const result=id?await supabase.from('communities').update(payload).eq('id',id).select('*').single():await supabase.from('communities').insert({...payload,owner_id:uid}).select('*').single();check(result.error);return result.data;
}
export async function communityAction(id:string,operation:'join'|'leave'|'pin'|'spotlight'|'notifications'|'invite'|'approve'|'reject'|'remove'|'promote'|'demote',target?:string,enabled=false){const {error}=await supabase.rpc('community_action',{cid:id,operation,target:target??null,enabled});check(error);}
export async function deleteCommunity(id:string){const {data,error}=await supabase.from('communities').delete().eq('id',id).select('id').maybeSingle();check(error);if(!data)throw new Error('コミュニティを削除する権限がありません。');}
export async function getCommunityMembers(id:string,page=0,mode:'all'|'moderators'|'pending'='all',search='',signal?:AbortSignal):Promise<CommunityMember[]>{
 let query=supabase.from('community_members').select('role,status,user:profiles!inner(id,username,display_name,avatar_url,cover_url,bio,created_at,is_private,is_official)').eq('community_id',id).order('created_at').range(page*40,page*40+39);
 if(mode==='pending')query=query.in('status',['pending','invited']);else query=query.eq('status','active');if(mode==='moderators')query=query.in('role',['owner','moderator']);
 if(search.trim())query=query.ilike('user.username',`%${search.trim().replace(/[%_\\]/g,'\\$&')}%`);
 const {data,error}=await query.abortSignal(signal!);check(error);
 return (data as unknown as {role:CommunityMember['role'];status:CommunityMember['status'];user:MemberProfile|MemberProfile[]}[]??[]).flatMap(row=>{const p=Array.isArray(row.user)?row.user[0]:row.user;if(!p)return [];return [{role:row.role,status:row.status,user:{id:p.id,username:p.username,displayName:p.display_name||p.username,avatarUrl:p.avatar_url||'',coverUrl:p.cover_url||'',bio:p.bio||'',createdAt:p.created_at,isPrivate:p.is_private,isOfficial:p.is_official}}]});
}
export async function getCommunitySpotlight(uid:string):Promise<Community|null>{const {data,error}=await supabase.rpc('community_spotlight',{profile_id:uid});check(error);return data?.[0]??null;}

export async function removeCommunityPost(postId:string){const {error}=await supabase.rpc('remove_community_post',{post_id:postId});check(error);}
