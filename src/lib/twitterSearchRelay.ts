import {supabase} from './supabase';
import {externalRead} from './utils';
export async function relayTwitterSearch(query:string,feed:string,offset:number,signal?:AbortSignal):Promise<{ids:string[];cursor:number|null}>{
 const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('twitterの代替検索にはLimeNoteへのログインが必要です');
 const result=await externalRead(()=>supabase.functions.invoke('link-preview',{body:{mode:'twitter-search',query,feed,offset},signal}),signal,'interactive');
 if(result.error||!Array.isArray(result.data?.ids))throw new Error('twitterの検索結果を取得できませんでした');
 return {ids:result.data.ids.filter((id:unknown):id is string=>typeof id==='string'&&/^\d{2,20}$/.test(id)).slice(0,6),cursor:Number.isInteger(result.data.cursor)&&result.data.cursor>offset?result.data.cursor:null};
}
