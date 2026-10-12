import { isAccountReadOnly } from '@/lib/accountSuspension';
import {supabase} from './supabase';
import {searchExternalUsers} from './bluesky';
import type {User} from '@/types';
/** Shared with the search page and list member search. */
export function searchProfileUser(row:Record<string,any>):User {
 return {id:row.id,username:row.username,displayName:row.display_name||row.displayName||'User',avatarUrl:row.avatar_url||row.avatarUrl||'',coverUrl:row.cover_url||'',createdAt:row.created_at||'',bio:row.bio||'',isOfficial:!!(row.is_official||row.isOfficial),isPrivate:!!(row.is_private||row.isPrivate)};
}
export async function searchAccounts(query:string,signal?:AbortSignal):Promise<User[]> {
 if (isAccountReadOnly()) return [];
 const q=query.trim().replace(/^@+/, '');if(!q)return [];
 const safe=q.replace(/[%_,().\\]/g,'').slice(0,100);
 const native=supabase.from('profiles').select('id,username,display_name,avatar_url,bio,is_official,is_private').or(`username.ilike.%${safe}%,display_name.ilike.%${safe}%,bio.ilike.%${safe}%`).limit(15).abortSignal(signal??new AbortController().signal);
 const results=await Promise.allSettled([native,searchExternalUsers(q,{signal,limit:15})]);if(signal?.aborted)throw signal.reason;
 const local=results[0].status==='fulfilled'?results[0].value:null;if(local?.error)throw local.error;
 if(results.every(item=>item.status==='rejected'))throw new Error('ユーザーを検索できませんでした');
 return [...new Map([...(local?.data??[]).map(searchProfileUser),...(results[1].status==='fulfilled'?results[1].value:[])].map(user=>[user.id,user])).values()];
}
