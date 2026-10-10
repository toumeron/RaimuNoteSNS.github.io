import {supabase} from '@/lib/supabase';
import {fetchBlueskyFollowers,fetchBlueskyFollows,isBlueskyProfileId} from '@/lib/bluesky';
import type {User} from '@/types';
export type FollowListTab='known'|'followers'|'following';
export type FollowListPage={users:User[];cursor:string|null};
const mapProfile=(p:any):User=>({id:p.id,username:p.username,displayName:p.display_name||p.displayName||p.username,avatarUrl:p.avatar_url||p.avatarUrl||'',bio:p.bio||'',coverUrl:p.cover_url||'',createdAt:p.created_at||'',isOfficial:p.is_official??false,isPrivate:p.is_private??false});
export async function fetchFollowListPage(target:User,tab:FollowListTab,viewerId:string,cursor:string|null,signal?:AbortSignal):Promise<FollowListPage>{
 const known=tab==='known',following=tab==='following';
 let knownIds=new Set<string>(),knownHandles=new Set<string>();
 if(known){
  for(let offset=0;;offset+=1000){
   const {data,error}=await supabase.from('follows').select('followee_id,external_handle').eq('follower_id',viewerId).eq('approved',true).order('created_at',{ascending:false}).range(offset,offset+999).abortSignal(signal!);
   if(error)throw error;for(const row of data??[]){if(row.followee_id)knownIds.add(row.followee_id);if(row.external_handle)knownHandles.add(row.external_handle.toLowerCase());}if((data?.length??0)<1000)break;
  }
 }
 if(isBlueskyProfileId(target.id)){
  const page=await (following?fetchBlueskyFollows:fetchBlueskyFollowers)({actor:target.username,cursor,limit:50,signal});
  return {users:page.users.map(profile=>profile as User).filter(profile=>!known||knownHandles.has(profile.username.toLowerCase())),cursor:page.cursor};
 }
 const offset=Number(cursor??0);
 const {data,error}=await supabase.from('follows').select(`${following?'followee_id,external_provider,external_handle,external_profile':'follower_id'},profile:profiles!${following?'follows_followee_id_fkey':'follows_follower_id_fkey'}(id,username,display_name,avatar_url,bio,is_official,is_private,created_at)`).eq(following?'follower_id':'followee_id',target.id).eq('approved',true).order('created_at',{ascending:false}).range(offset,offset+49).abortSignal(signal!);
 if(error)throw error;
 const users=(data??[]).map((row:any)=>{
  const profile=Array.isArray(row.profile)?row.profile[0]:row.profile;
  if(profile)return !known||knownIds.has(profile.id)?mapProfile(profile):null;
  if(!following||!row.external_provider)return null;
  const p=row.external_profile??{};
  return mapProfile({id:p.id??(row.external_provider==='misskey'?'misskey-user:':'did:handle:')+row.external_handle,username:row.external_handle,...p});
 });
 return {users:users.filter((profile):profile is User=>!!profile),cursor:data?.length===50?String(offset+50):null};
}
