import {supabase} from './supabase';
import {externalRead} from './utils';
export async function relayBlueskySearch(endpoint:string,params:URLSearchParams,signal?:AbortSignal):Promise<Response|null>{
 const {data:{session}}=await supabase.auth.getSession();
 if(!session)return null;
 const result=await externalRead(()=>supabase.functions.invoke('link-preview',{body:{mode:'bluesky',endpoint,params:Object.fromEntries(params)},signal}),signal,'interactive');
 if(result.error||!result.data||!Object.prototype.hasOwnProperty.call(result.data,'data'))throw new Error('Bluesky検索を取得できませんでした');
 return new Response(JSON.stringify(result.data.data),{status:200,headers:{'Content-Type':'application/json'}});
}
