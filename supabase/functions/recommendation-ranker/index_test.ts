import {handleRecommendationRanker} from './index.ts';
import {FEATURE_NAMES} from "../_shared/chatContext.ts";
function assert(value:unknown,message='Assertion failed'):asserts value {if(!value)throw new Error(message);}
const model={version:1,featureNames:FEATURE_NAMES,trainedAt:new Date().toISOString(),metrics:{baselineNdcg:.3,modelNdcg:.5,validationGroups:6},trees:[{split_feature:0,threshold:.5,default_left:true,decision_type:'<=',left_child:{leaf_value:-1},right_child:{leaf_value:1}}]};
Deno.test('rank endpoint checks JWT; training checks dedicated secret; export contains only numerical observations',async()=>{
 const original=globalThis.fetch;
 const names=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','RECOMMENDATION_TRAINING_SECRET'];
 const previous=names.map(name=>Deno.env.get(name));
 names.forEach((name,index)=>Deno.env.set(name,index===0?'https://example.supabase.co':index===3?'test-training-secret':'test-key'));
 globalThis.fetch=(async(input:RequestInfo|URL)=>{
  const url=String(input instanceof Request?input.url:input);
  if(url.includes('/auth/v1/user'))return Response.json({id:'viewer',aud:'authenticated',role:'authenticated'});
  if(url.includes('/rpc/consume_security_quota'))return Response.json(true);
  if(url.includes('/storage/v1/object/'))return Response.json(model);
  if(url.includes('/rest/v1/profile_private_settings'))return Response.json([{user_id:'private-user',recommendation_training:[{id:'private-post',qid:'random-group',features:Array(15).fill(0),label:2,at:new Date(Date.now()-2*86400000).toISOString()},...[0,1,3,4].map(label=>({qid:`signal-${label}`,label,features:Array(15).fill(0),at:new Date(Date.now()-2*86400000).toISOString()})),{qid:'invalid',label:5,features:Array(15).fill(0),at:new Date(Date.now()-2*86400000).toISOString()},{qid:'fresh',features:Array(15).fill(0),label:0,at:new Date().toISOString()}]}]);
  throw new Error('Unexpected request');
 }) as typeof fetch;
 const request=(body:unknown,extra:Record<string,string>={})=>new Request('https://example.test/ranker',{method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
 try {
  assert((await handleRecommendationRanker(request({action:'export'}))).status===401);
  assert((await handleRecommendationRanker(request({action:'rank',candidates:[]}))).status===401);
  const ranked=await handleRecommendationRanker(request({action:'rank',candidates:[{id:'a',features:Array(15).fill(0)},{id:'b',features:Array(15).fill(1)}]},{Authorization:'Bearer test-user-token'}));
  assert(ranked.status===200);const result=await ranked.json();assert(result.scores.a===-1&&result.scores.b===1);
  const exported=await handleRecommendationRanker(request({action:'export'},{'x-recommendation-training-secret':'test-training-secret'}));
  const data=await exported.json();assert(data.rows.length===5);assert(data.rows.map((row:{label:number})=>row.label).sort().join()==='0,1,2,3,4');assert(!JSON.stringify(data).includes('private-user'));assert(!JSON.stringify(data).includes('private-post'));assert(data.rows[0].qid==='random-group');
  assert((await handleRecommendationRanker(request({action:'upload',model:{...model,metrics:{...model.metrics,modelNdcg:.2}}},{'x-recommendation-training-secret':'test-training-secret'}))).status===400);
 }finally{globalThis.fetch=original;names.forEach((name,index)=>{if(previous[index]===undefined)Deno.env.delete(name);else Deno.env.set(name,previous[index]!);});}
});
