import {supabase} from './supabase';
import type {BlueskyProfile} from './bluesky';
import {normalizeAccountText} from './accountSearchRanking';

/** Search existing public follow snapshots under their normal RLS permissions. */
export async function searchSavedAccounts(query:string,signal?:AbortSignal):Promise<BlueskyProfile[]>{
 const q=query.normalize('NFKC').trim().replace(/[%_,().\\"]/g,'').slice(0,100);if(!q)return [];
 const variants=[...new Set([q,q.replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60)),q.replace(/[ぁ-ゖ]/g,c=>String.fromCharCode(c.charCodeAt(0)+0x60))])];
 const filters=variants.flatMap(term=>['external_profile->>displayName','external_profile->>display_name','external_handle'].map(field=>`${field}.ilike.%${term}%`)).join(',');
 const readSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(2000)]):AbortSignal.timeout(2000);
 const {data,error}=await supabase.from('follows').select('external_provider,external_handle,external_profile').eq('approved',true).not('external_provider','is',null).or(filters).limit(100).abortSignal(readSignal);
 if(error)throw error;
 const users=(data??[]).flatMap(row=>{
  const p=row.external_profile;if(!p||typeof p!=='object')return [];
  const username=p.username??(row.external_provider==='x'?`${row.external_handle}@twitter.com`:row.external_handle);
  if(!p.id||!username)return [];
  return [{...p,username,displayName:p.displayName||p.display_name||username,avatarUrl:p.avatarUrl||p.avatar_url||'',isOfficial:false} as BlueskyProfile];
 });
 const term=normalizeAccountText(query);
 return users.filter(user=>normalizeAccountText(`${user.displayName} ${user.username}`).includes(term));
}
