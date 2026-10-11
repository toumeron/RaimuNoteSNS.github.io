import {supabase} from '@/lib/supabase';
import {getCurrentUserId} from '@/lib/currentUser';
import {randomUUID} from '@/lib/randomUUID';
import {searchAccounts,searchProfileUser} from '@/lib/accountSearch';
import type {User} from '@/types';

export type ListMember=Pick<User,'id'|'username'|'displayName'|'avatarUrl'|'bio'|'isOfficial'|'isPrivate'>;
export type UserList={id:string;owner_id:string;name:string;description:string;is_private:boolean;cover_ref:string|null;members:ListMember[];created_at:string;updated_at:string;owner:{username:string;display_name:string;avatar_url:string;is_official?:boolean;is_private?:boolean};coverUrl?:string;followers?:number;saved?:boolean};
const select='*,owner:profiles!owner_id(username,display_name,avatar_url,is_official,is_private)';
export const listsKey=(owner?:string)=>['user-lists',owner??null];
export function listMember(user:ListMember):ListMember{return {id:user.id,username:user.username,displayName:(user.displayName??user.username).slice(0,100),avatarUrl:user.avatarUrl?.startsWith('https://')?user.avatarUrl.slice(0,2000):'',bio:(user.bio??'').slice(0,500),isOfficial:!!user.isOfficial,isPrivate:!!user.isPrivate};}
async function enrich(rows:UserList[],saved:string[]=[]) {
 if(!rows.length)return rows;
 if(rows.length>100){const result:UserList[]=[];for(let start=0;start<rows.length;start+=100)result.push(...await enrich(rows.slice(start,start+100),saved));return result;}
 const [{data:counts,error},media]=await Promise.all([
  supabase.rpc('list_follower_counts',{list_ids:rows.map(row=>row.id)}),
  rows.some(row=>row.cover_ref)?supabase.functions.invoke('list-media',{body:{action:'resolve',listIds:rows.map(row=>row.id)}}):Promise.resolve({data:{urls:{}},error:null}),
 ]);
 if(error)throw error;if(media.error)throw media.error;
 return rows.map(row=>({...row,saved:saved.includes(row.id),followers:counts?.find((item:{id:string})=>item.id===row.id)?.followers??0,coverUrl:row.cover_ref?media.data?.urls?.[row.cover_ref]:undefined}));
}
export async function getLists(owner?:string):Promise<UserList[]> {
 const saved=owner?await supabase.from('profile_private_settings').select('saved_lists').eq('user_id',owner).maybeSingle():{data:null,error:null};if(saved.error)throw saved.error;
 const ids:string[]=saved.data?.saved_lists??[];
 const [mine,discovery,followed]=await Promise.all([
  owner?supabase.from('user_lists').select(select).eq('owner_id',owner).order('created_at',{ascending:false}).limit(100):Promise.resolve({data:[],error:null}),
  supabase.from('user_lists').select(select).eq('is_private',false).order('created_at',{ascending:false}).limit(50),
  ids.length?supabase.from('user_lists').select(select).in('id',ids):Promise.resolve({data:[],error:null}),
 ]);
 for(const result of [mine,discovery,followed])if(result.error)throw result.error;
 return enrich([...new Map([...mine.data??[],...followed.data??[],...discovery.data??[]].map(row=>[row.id,row as UserList])).values()],ids);
}
export async function getList(id:string):Promise<UserList> {const {data,error}=await supabase.from('user_lists').select(select).eq('id',id).single();if(error)throw error;const list=data as UserList;const native=list.members.filter(member=>/^[0-9a-f-]{36}$/i.test(member.id)).map(member=>member.id);
 if(native.length){const profiles=await supabase.from('profiles').select('id,username,display_name,avatar_url,bio,is_official,is_private').in('id',native);if(profiles.error)throw profiles.error;const current=new Map((profiles.data??[]).map(row=>[row.id,listMember(searchProfileUser(row))]));list.members=list.members.map(member=>current.get(member.id)??member);}
 return (await enrich([list]))[0];}
async function uploadCover(file:File,id:string){if(!['image/png','image/jpeg','image/webp','image/gif','image/avif'].includes(file.type)||file.size>8*1024*1024)throw new Error('画像は対応形式で8MB以内にしてください');const form=new FormData();form.set('file',file);form.set('listId',id);const {data,error}=await supabase.functions.invoke('list-media',{body:form});if(error)throw error;return data.ref as string;}
export async function discardListCover(ref:string){const {error}=await supabase.functions.invoke('list-media',{body:{action:'discard',refs:[ref]}});if(error)throw error;}
export async function saveList(input:{id?:string;name:string;description:string;is_private:boolean;cover_ref?:string|null;file?:File}):Promise<UserList>{
 if(!input.name.trim()||Array.from(input.name.trim()).length>50||Array.from(input.description).length>500)throw new Error('名前は1〜50文字、詳細は500文字以内にしてください');
 const owner=await getCurrentUserId();if(!owner)throw new Error('ログインしてください');const id=input.id??randomUUID();const uploaded=input.file?await uploadCover(input.file,id):undefined;
 const patch={name:input.name.trim(),description:input.description,is_private:input.is_private,...(uploaded?{cover_ref:uploaded}:input.cover_ref!==undefined?{cover_ref:input.cover_ref}:{})};
 const query=input.id?supabase.from('user_lists').update(patch).eq('id',id).eq('owner_id',owner):supabase.from('user_lists').insert({...patch,id,owner_id:owner});
 const {data,error}=await query.select(select).single();if(error){if(uploaded)await discardListCover(uploaded).catch(()=>{});throw error;}return data as UserList;
}
export async function deleteList(id:string){const {error}=await supabase.from('user_lists').delete().eq('id',id).eq('owner_id',await getCurrentUserId());if(error)throw error;}
export async function setListMember(id:string,user:ListMember,included:boolean){const {error}=await supabase.rpc('set_list_member',{list_id:id,member:listMember(user),included});if(error)throw error;}
export async function setSavedList(id:string,included:boolean){const {error}=await supabase.rpc('set_saved_list',{list_id:id,included});if(error)throw error;}
export async function searchListUsers(query:string,signal?:AbortSignal):Promise<ListMember[]>{return (await searchAccounts(query,signal)).map(listMember);}

export async function searchLists(query:string):Promise<UserList[]> {const {data,error}=await supabase.from('user_lists').select(select).ilike('name',`%${query.replace(/[%_]/g,'')}%`).order('created_at',{ascending:false}).limit(30);if(error)throw error;return enrich(data as UserList[]);}

// The TL catalog only needs labels; avoid signing/downloading covers on every page.
export async function getListCatalog(owner:string):Promise<{id:string;name:string}[]> {
 const {data:settings,error:settingsError}=await supabase.from('profile_private_settings').select('saved_lists').eq('user_id',owner).maybeSingle();if(settingsError)throw settingsError;const ids:string[]=settings?.saved_lists??[];
 const results=await Promise.all([
  supabase.from('user_lists').select('id,name').eq('owner_id',owner).order('created_at',{ascending:false}).limit(100),
  supabase.from('user_lists').select('id,name').eq('is_private',false).order('created_at',{ascending:false}).limit(50),
  ids.length?supabase.from('user_lists').select('id,name').in('id',ids):Promise.resolve({data:[],error:null}),
 ]);for(const result of results)if(result.error)throw result.error;return [...new Map(results.flatMap(result=>result.data??[]).map(list=>[list.id,list])).values()];
}
