import {supabase} from '@/lib/supabase';
import {EMPTY_ANIME_HISTORY,type AnimeHistoryState,type AnimeImportItem,type AnimeWork,type AnimeEpisode} from '../../supabase/functions/_shared/animeHistory';
export {ANIME_SOURCES,animeHttps,parseAnimeImport,normalizeAnimeTitle,fetchAnimeArtwork,fetchAnimeStreamingLinks,preferredAnimeStreamingUrl} from '../../supabase/functions/_shared/animeHistory';
export type {AnimeHistoryEntry,AnimeHistoryState,AnimeImportItem,AnimeWork,AnimeEpisode} from '../../supabase/functions/_shared/animeHistory';
export type AnimeImportResolution={item:AnimeImportItem;work:AnimeWork|null;episode:AnimeEpisode|null;candidates:AnimeWork[];ambiguous:boolean};
export const animeHistoryKey=(owner:string)=>['anime-history',owner] as const;
export const ANIME_HISTORY_CHANGED='lime-anime-history-changed';
async function request<T>(owner:string,path:string,body:unknown,signal?:AbortSignal):Promise<T>{
 const {data:{session}}=await supabase.auth.getSession();
 if(!session||session.user.id!==owner)throw new Error('視聴履歴の更新には本人のログインが必要です');
 const response=await fetch(path==='functions/v1/anime-history'&&import.meta.env.DEV?`${import.meta.env.BASE_URL}__lime-anime-history`:`${import.meta.env.VITE_SUPABASE_URL}/${path}`,{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,apikey:import.meta.env.VITE_SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify(body),signal});
 const data=await response.json().catch(()=>null);
 if(!response.ok){if(['PGRST202','42883'].includes(data?.code))throw new Error('');throw new Error(data?.error||data?.message||'視聴履歴を読み込めませんでした');}
 return data as T;
}
const edge=<T>(owner:string,body:unknown,signal?:AbortSignal)=>request<T>(owner,'functions/v1/anime-history',body,signal);
export async function getAnimeHistory(username:string,signal?:AbortSignal):Promise<AnimeHistoryState>{
 const anon=import.meta.env.VITE_SUPABASE_ANON_KEY;
 const {data:{session}}=await supabase.auth.getSession();
 const response=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/get_anime_history`,{method:'POST',headers:{apikey:anon,Authorization:`Bearer ${session?.access_token??anon}`,'Content-Type':'application/json'},body:JSON.stringify({target_username:username}),signal});
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw new Error(['PGRST202','42883'].includes(data?.code)?'':data?.message||'視聴履歴を読み込めませんでした');
 return data??EMPTY_ANIME_HISTORY;
}
export async function changeAnimeHistory(owner:string,operation:'delete'|'delete_work'|'auto',options:{record_id?:string;enabled?:boolean}):Promise<AnimeHistoryState>{return request(owner,'rest/v1/rpc/update_anime_history',{operation,...options});}
export const searchAnimeWorks=(owner:string,query:string,signal?:AbortSignal)=>edge<{works:AnimeWork[]}>(owner,{op:'search',query},signal);
export const getAnimeEpisodes=(owner:string,workId:number,page:number,signal?:AbortSignal)=>edge<{episodes:AnimeEpisode[];nextPage:number|null}>(owner,{op:'episodes',workId,page},signal);
export const saveAnimeViewing=(owner:string,workId:number,episodeId:number|null,watchedAt:string|null,importItem?:AnimeImportItem)=>edge<{state:AnimeHistoryState}>(owner,{op:'save',workId,episodeId,watchedAt,...(importItem?{importItem}:{})});
export const resolveAnimeImport=(owner:string,items:AnimeImportItem[],signal?:AbortSignal)=>edge<{rows:AnimeImportResolution[]}>(owner,{op:'resolve',items},signal);
export const saveAnimeImport=(owner:string,rows:AnimeImportResolution[])=>edge<{state:AnimeHistoryState}>(owner,{op:'import',items:rows.map(row=>({workId:row.work!.id,episodeId:row.episode?.id??null,item:row.item}))});
export const scanAnimePosts=(owner:string,before?:string,signal?:AbortSignal)=>edge<{state:AnimeHistoryState;scanned:number;nextBefore:string|null}>(owner,{op:'scan',before},signal);
/** Post success must not depend on catalog availability. Catch-up is available on the history page. */
export async function recordAnimePost(owner:string,postId:string):Promise<void>{
 try{const result=await edge<{state:AnimeHistoryState}>(owner,{op:'detect',postId});window.dispatchEvent(new CustomEvent(ANIME_HISTORY_CHANGED,{detail:{owner,state:result.state}}));}
 catch{/* The history page reports catalog/configuration errors and can retry without republishing the post. */}
}
export function groupAnimeHistory(entries:import('../../supabase/functions/_shared/animeHistory').AnimeHistoryEntry[]){
 const groups=new Map<number,{work:AnimeWork;entries:import('../../supabase/functions/_shared/animeHistory').AnimeHistoryEntry[]}>();
 for(const entry of entries){const group=groups.get(entry.work.id);if(group)group.entries.push(entry);else groups.set(entry.work.id,{work:entry.work,entries:[entry]});}
 return [...groups.values()];
}
