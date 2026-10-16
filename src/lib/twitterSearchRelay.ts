import {supabase} from './supabase';
import {externalRead} from './utils';
export async function relayTwitterSearch(query:string,feed:string,offset:number,signal?:AbortSignal,limit=6):Promise<{ids:string[];cursor:number|null}>{
 limit=Math.max(1,Math.min(20,Math.floor(limit)||6));
 const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('twitterの代替検索にはLimeNoteへのログインが必要です');
 const result=await externalRead(()=>supabase.functions.invoke('link-preview',{body:{mode:'twitter-search',query,feed,offset,...(limit!==6?{limit}:{})},signal}),signal,'interactive');
 if(result.error||!Array.isArray(result.data?.ids))throw new Error('twitterの検索結果を取得できませんでした');
 return {ids:result.data.ids.filter((id:unknown):id is string=>typeof id==='string'&&/^\d{2,20}$/.test(id)).slice(0,limit),cursor:Number.isInteger(result.data.cursor)&&result.data.cursor>offset?result.data.cursor:null};
}
