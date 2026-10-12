import {handleGenerateNews} from './index.ts';
function assert(value:unknown){if(!value)throw Error('Assertion failed');}
const names=['NEWS_CRON_SECRET','GEMINI_API_KEY','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','PRIVATE_SERVICE_KEY'];
async function fixture(options:{empty?:boolean;upstreamFailure?:boolean;relevant?:boolean;many?:boolean}={}){
 const env=names.map(name=>Deno.env.get(name)),oldFetch=globalThis.fetch;
 const writes:string[]=[],releases:Record<string,unknown>[]=[];
 for(const name of names)Deno.env.set(name,name==='NEWS_CRON_SECRET'?'test-news-secret':'fixture');
 const recent=new Date().toISOString();
 const db={rpc:()=>Promise.resolve({data:'lease',error:null}),from:(table:string)=>{
  const result={data:table==='posts'&&!options.empty?Array.from({length:options.many?10:1},(_,i)=>({id:options.many?'native'+i:'native',content:'公開発表',created_at:recent})):[],error:null};
  const q:any={then:(resolve:any)=>Promise.resolve(result).then(resolve)};
  for(const method of ['select','eq','gte','lte','ilike','in','order','limit'])q[method]=()=>q;
  if(options.many)q.ilike=()=>{result.data=[];return q;};
  q.insert=()=>{writes.push(table);return q;};q.update=(value:Record<string,unknown>)=>{releases.push(value);return q;};return q;
 }};
 globalThis.fetch=(input,init)=>{
  const url=String(input);
  if(url.includes('bsky.app'))return Promise.resolve(Response.json(options.upstreamFailure?{}:{posts:options.empty?[]:[{uri:'at://did:plc:test/app.bsky.feed.post/1',record:{text:'公開発表',createdAt:recent},likeCount:1}]},{status:options.upstreamFailure?503:200}));
  const prompt=JSON.parse(String(init?.body)).contents[0].parts[0].text;
  const inputPosts=JSON.parse(prompt.split(prompt.includes('related_post_ids')?'\n根拠: ':'\n候補: ')[1].split('\n「')[0]);
  const ids=inputPosts.map((p:any)=>p.id);
  const nativePool=ids[0]?.startsWith('native');
  const picked=options.many&&nativePool?(prompt.includes('選ぶ話題は「')?ids:ids.slice(0,1)):options.relevant?ids:[];
  const result=prompt.includes('related_post_ids')?{title:'新作を公開',content:'新作の公開が発表されました。',related_post_ids:ids}:{topic:'公開発表',post_ids:picked,...(options.many&&nativePool?{query:'作品名'}:{})};
  return Promise.resolve(Response.json({candidates:[{content:{parts:[{text:JSON.stringify(result)}]}}]}));
 };
 try{
  const makeClient=(()=>db) as unknown as Parameters<typeof handleGenerateNews>[1];
  const response=await handleGenerateNews(new Request('https://fixture.invalid',{method:'POST',headers:{'x-news-secret':'test-news-secret'},body:'{}'}),makeClient);
  return {status:response.status,data:await response.json(),writes,releases};
 }finally{globalThis.fetch=oldFetch;names.forEach((name,i)=>env[i]===undefined?Deno.env.delete(name):Deno.env.set(name,env[i]!));}
}
Deno.test('insufficient relevant sources skip publication and release both leases without recording failures',async()=>{
 const {status,data,writes,releases}=await fixture();assert(status===200);assert(data.results.length===2);
 assert(data.results.every((r:any)=>r.skipped&&r.reason==='insufficient_sources'&&!r.error));assert(!writes.length);
 assert(releases.length===2&&releases.every(r=>r.lease_token===null&&r.last_error===null&&!r.last_completed_at));
});
Deno.test('an empty public source pool is a successful skip, without generating an article',async()=>{
 const {status,data,writes}=await fixture({empty:true});assert(status===200);assert(data.results.every((r:any)=>r.skipped&&r.sourcePostsCount===0));assert(!writes.length);
});
Deno.test('upstream discovery outages remain errors rather than successful skips',async()=>{
 const {data}=await fixture({upstreamFailure:true});const result=data.results.find((r:any)=>r.source==='bluesky');assert(result.error==='Bluesky popular search unavailable'&&!result.skipped);
});

Deno.test('LimeNote publishes one verified recent source while Bluesky still requires five',async()=>{
 const {status,data,writes,releases}=await fixture({relevant:true});assert(status===200);
 const native=data.results.find((r:any)=>r.source==='limenote'),external=data.results.find((r:any)=>r.source==='bluesky');
 assert(native.sourcePostsCount===1&&native.citedPostsCount===1&&!native.skipped&&!native.error);
 assert(external.skipped&&external.reason==='insufficient_sources');assert(writes.length===1&&writes[0]==='news_summaries');
 assert(releases.filter(r=>r.last_completed_at).length===1);
});

Deno.test('topic expansion preserves ten original relevant posts even when supplementary search finds none',async()=>{
 const {data,writes}=await fixture({many:true,relevant:true});const native=data.results.find((r:any)=>r.source==='limenote');
 assert(native.sourcePostsCount===10&&native.citedPostsCount===10&&!native.skipped&&!native.error);assert(writes.length===1);
});
