import {handleExport,paged,withoutCredentials} from './index.ts';
function assert(value:unknown,message='Assertion failed'){if(!value)throw new Error(message);}
const owner='11111111-1111-1111-1111-111111111111';
Deno.env.set('SUPABASE_URL','https://example.supabase.co');Deno.env.set('SUPABASE_ANON_KEY','anon');Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','service');
function fixture(passwordValid=true){
 const calls:string[]=[];let count=0;
 const storage={createSignedUrl:async(path:string)=>{calls.push('download:'+path);return {data:{signedUrl:'https://download.test/archive.zip'},error:null};},list:async()=>({data:[],error:null})};
 const query={select:()=>query,eq:()=>query,update:()=>query,maybeSingle:async()=>({data:{generation:'generation',expires_at:new Date(Date.now()+86400000).toISOString()},error:null}),then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:null,error:null}).then(resolve)};
 const actor={auth:{getUser:async()=>({data:{user:{id:owner,email:'account@example.test'}},error:null})}};
 const db={storage:{from:()=>storage},from:()=>query,rpc:async(name:string)=>{calls.push(name);if(name==='account_export_attempt')return {data:true,error:null};throw new Error('Cached exports must not rescan data');}};
 const verifier={auth:{signInWithPassword:async()=>{calls.push('password');return passwordValid?{data:{user:{id:owner}},error:null}:{data:{user:null},error:{message:'invalid'}};}}};
 const makeClient=(()=>[actor,db,verifier][count++]) as unknown as Parameters<typeof handleExport>[1];
 return {calls,makeClient};
}
Deno.test('cached archive still requires fresh password verification and never rescans data',async()=>{
 const {calls,makeClient}=fixture();const response=await handleExport(new Request('https://api.test',{method:'POST',headers:{Authorization:'Bearer session'},body:JSON.stringify({action:'verify',password:'correct'})}),makeClient);
 assert(response.status===200);assert((await response.json()).verified===true);assert(calls.includes('password'));assert(!calls.some(c=>c.startsWith('download:')));assert(!calls.includes('account_export_tables'));
});
Deno.test('wrong password cannot obtain even an already saved archive',async()=>{
 const {calls,makeClient}=fixture(false);const response=await handleExport(new Request('https://api.test',{method:'POST',headers:{Authorization:'Bearer session'},body:JSON.stringify({action:'verify',password:'wrong'})}),makeClient);
 assert(response.status===403);assert(!calls.includes('begin_account_export'));assert(!calls.some(c=>c.startsWith('download:')));
});
Deno.test('missing JWT or password cannot start an export',async()=>{
 const noToken=await handleExport(new Request('https://api.test',{method:'POST',body:'{}'}));assert(noToken.status===401);
 const {makeClient}=fixture();const missing=await handleExport(new Request('https://api.test',{method:'POST',headers:{Authorization:'Bearer session'},body:'{"action":"collect"}'}),makeClient);assert(missing.status===400);
});
Deno.test('all pages are collected without silently truncating at the server page size',async()=>{
 const rows=await paged(async offset=>Array.from({length:offset<1000?500:17},(_,i)=>({id:offset+i})));
 assert(rows.length===1017);assert(rows[1016].id===1016);
});
Deno.test('server excludes credentials but keeps actual user content',()=>{
 const value=withoutCredentials({content:'my password story',access_token:'private',session:JSON.stringify({accessJwt:'private',handle:'cat'}),settings:{apiKey:'private',language:'ja'}}) as Record<string,unknown>;
 assert(value.content==='my password story');assert(!JSON.stringify(value).includes('private'));
});

Deno.test('first export keeps own legacy reactions without reading the revoked legacy table as the user',async()=>{
 const postId='22222222-2222-2222-2222-222222222222',emojiId='33333333-3333-3333-3333-333333333333';

 const legacy={id:'reaction',user_id:owner,post_id:postId,emoji_id:emojiId};const reads:string[]=[];
 const result=(data:unknown)=>({data,error:null});
 function query(table:string){reads.push(table);const data=table==='reactions'?{data:null,error:{message:'permission denied for table reactions'}}:result(table==='custom_emojis'?[{id:emojiId,name:'old_emoji',public_id:'old_emoji',format:'png'}]:[]);
  const chain={select:()=>chain,in:()=>chain,order:()=>chain,range:()=>chain,then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(data).then(resolve)};return chain;}
 const actor={auth:{getUser:async()=>result({user:{id:owner,email:'account@example.test'}})},from:query};
 const update={update:()=>update,eq:()=>update,neq:()=>update,select:()=>update,maybeSingle:async()=>result(null),then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(result(null)).then(resolve)};
 const bucket={createSignedUrl:async()=>result({signedUrl:'original-url'}),upload:()=>{throw new Error('Export uploads are forbidden');},createSignedUploadUrl:()=>{throw new Error('Upload grants are forbidden');}};
 const ownSpace={id:'own-space',host_id:owner,title:'自分のスペース',created_at:'2026-10-08',heartbeat_at:'internal-heartbeat',waiting_ended_at:'internal-waiting'};
 const foreignSpace={id:'foreign-space',host_id:'another-host',title:'他人のスペース',heartbeat_at:'private-heartbeat'};
 const db={from:(table:string)=>{assert(table!=='spaces','Membership must not fetch another host’s room');return update;},storage:{from:()=>bucket},rpc:async(name:string,args:Record<string,unknown>)=>result(name==='account_export_attempt'?true:name==='account_export_tables'?[{table:'posts'},{table:'profiles'},{table:'reactions'},{table:'spaces'},{table:'space_members'}]:name==='account_export_rows'?(args.p_table==='posts'?[{id:postId,user_id:owner,content:'test'}]:args.p_table==='profiles'?[{id:owner,username:'owner'}]:args.p_table==='spaces'?[ownSpace,foreignSpace]:args.p_table==='space_members'?[{user_id:owner,space_id:'foreign-space',role:'listener'}]:[legacy]):[])};
 const verifier={auth:{signInWithPassword:async()=>result({user:{id:owner}})}};let count=0;
 const response=await handleExport(new Request('https://api.test',{method:'POST',headers:{Authorization:'Bearer session'},body:JSON.stringify({action:'collect',password:'correct'})}),(()=>[actor,db,verifier][count++]) as unknown as Parameters<typeof handleExport>[1]);
 assert(response.status===200,'First generation must finish instead of returning 500');const payload=await response.json();assert(!payload.upload&&!payload.snapshotUrl);const archive=payload.snapshot;
 assert(archive.tables.reactions[0].emoji_id===emojiId,'Own legacy history must remain in the archive');assert(archive.related.custom_emojis[0].id===emojiId,'Referenced custom emoji must be exported');assert(!reads.includes('reactions'),'Do not weaken the revoked table permissions');
 assert(archive.tables.spaces.length===1&&archive.tables.spaces[0].host_id===owner);assert(archive.related.spaces.length===1&&archive.related.spaces[0].id==='own-space');assert(!JSON.stringify(archive).includes('internal-heartbeat'));assert(!JSON.stringify(archive).includes('他人のスペース'));
});

Deno.test('obsolete upload protocol is rejected without issuing storage grants',async()=>{
 for(const action of ['prepare','complete','failed']) {
  const {calls,makeClient}=fixture();const response=await handleExport(new Request('https://api.test',{method:'POST',headers:{Authorization:'Bearer session'},body:JSON.stringify({action,password:'correct'})}),makeClient);
  assert(response.status===409);assert(calls.length===0);
 }
});
