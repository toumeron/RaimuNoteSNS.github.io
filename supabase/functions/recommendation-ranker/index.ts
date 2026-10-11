import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {authenticate,boundedBody,quota,secretMatches} from '../_shared/security.ts';
import {FEATURE_NAMES,validFeatures,validRankModel,predictRank,type RankModel} from '../_shared/recommendationModel.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-recommendation-training-secret','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store'};
const db=()=>createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
let cached:RankModel|null=null,lastRead=0;
async function model() {
 if(Date.now()-lastRead<300000)return cached;
 const {data,error}=await db().storage.from('recommendation-models').download('ranker.json');
 if(error||!data){lastRead=Date.now();return cached;}
 const input=JSON.parse(await data.text());
 if(validRankModel(input)&&Date.parse(input.trainedAt)<=Date.now()+300000)cached=input;
 lastRead=Date.now();return cached;
}
export async function handleRecommendationRanker(req:Request):Promise<Response> {
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(req.method!=='POST')return new Response(null,{status:405,headers});
 try {
  const input=JSON.parse(await boundedBody(req,4194304));
  if(input.action==='export'||input.action==='upload') {
   if(!await secretMatches(req.headers.get('x-recommendation-training-secret'),Deno.env.get('RECOMMENDATION_TRAINING_SECRET')))return Response.json({error:'Unauthorized'},{status:401,headers});
   if(input.action==='upload'){
    if(!validRankModel(input.model)||Date.parse(input.model.trainedAt)<Date.now()-86400000||Date.parse(input.model.trainedAt)>Date.now()+300000)return Response.json({error:'Invalid or unvalidated model'},{status:400,headers});
    const {error}=await db().storage.from('recommendation-models').upload('ranker.json',JSON.stringify(input.model),{contentType:'application/json',upsert:true});
    if(error)throw error;cached=input.model;lastRead=Date.now();return Response.json({saved:true},{headers});
   }
   const rows:{qid:string;features:number[];label:number;at:string}[]=[];
   const now=Date.now();let after:string|undefined;
   for(let page=0;page<250&&rows.length<50000;page++){
    let query=db().from('profile_private_settings').select('user_id,recommendation_training').neq('recommendation_training','[]').order('user_id').limit(20);
    if(after)query=query.gt('user_id',after);
    const {data,error}=await query;if(error)throw error;
    for(const account of data??[])for(const event of account.recommendation_training??[]){
     const age=now-Date.parse(event.at);
     // Wait one day for engagement, including reposts, bookmarks and explicit dismissals.
     if(age>=86400000&&age<=30*86400000&&validFeatures(event.features)&&(Number.isInteger(event.label)&&event.label>=0&&event.label<=4)&&typeof event.qid==='string')rows.push({qid:event.qid,features:event.features,label:event.label,at:event.at});
    }
    if(!data?.length||data.length<20)break;after=data.at(-1)!.user_id;
   }
   return Response.json({featureNames:FEATURE_NAMES,rows:rows.slice(0,50000)},{headers});
  }
  const actor=await authenticate(req,headers);if(actor instanceof Response)return actor;
  const limited=await quota(actor.userId,'preview',headers);if(limited)return limited;
  if(input.action!=='rank'||!Array.isArray(input.candidates)||input.candidates.length>80||!input.candidates.every((candidate:any)=>typeof candidate.id==='string'&&candidate.id.length<=512&&validFeatures(candidate.features)))return Response.json({error:'Invalid candidates'},{status:400,headers});
  let active:RankModel|null=null;try{active=await model();}catch{/* Keep the baseline available during storage outages. */}
  if(active&&Date.now()-Date.parse(active.trainedAt)>7*86400000)active=null;
  const scores=active?Object.fromEntries(input.candidates.map((candidate:any)=>[candidate.id,predictRank(active!,candidate.features)])):{};
  return Response.json({scores,model:active?.trainedAt??null},{headers});
 }catch{return Response.json({error:'Recommendation service unavailable'},{status:503,headers});}
}
if(import.meta.main)Deno.serve(handleRecommendationRanker);
