import {test} from 'node:test';import assert from 'node:assert/strict';import {createVideoWorker,MAX_BYTES,inspectVideo} from './worker.mjs';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',key=`${owner}/${id}/33333333-3333-4333-8333-333333333333.mp4`;
function fixture({visible=true,publicVisible=true,suspended=false,postOwner=owner,video={key},objectFailure=false,databaseFailsOnce=false}={}){
 let present=visible,dbAttempts=0;const operations=[];
 const stored=[],deleted=[];let range;
 const worker=createVideoWorker({getStorage:()=>({put:async(...args)=>stored.push(args),delete:async key=>{deleted.push(key);operations.push('object:'+key);if(objectFailure&&key.endsWith('.mp4'))throw new Error('storage offline');},get:async(key,requested)=>{range=requested;return new Response('bytes',{status:requested?206:200,headers:{'Content-Type':'video/mp4','Content-Range':'bytes 0-4/5'}});}}),inspect:async()=>({duration:2,width:1920,height:1080,size:5,mimeType:'video/mp4'}),transport:async(url,options)=>{
 if(url.endsWith('/auth/v1/user'))return Response.json({id:owner});if(url.endsWith('/is_account_suspended')){assert.deepEqual(JSON.parse(options.body),{account_id:owner});return Response.json(suspended);}
 if(url.includes('/posts?')){
  if(options.method==='DELETE'){operations.push('database');dbAttempts++;assert.equal(options.headers.Authorization,'Bearer user');assert.equal(options.headers.Prefer,'return=representation');assert.match(url,new RegExp('user_id=eq.'+owner));if(databaseFailsOnce&&dbAttempts===1)return Response.json({error:'offline'},{status:503});present=false;return Response.json([{id}]);}
  return Response.json(present&&(publicVisible||options.headers.Authorization==='Bearer user')?[{id,user_id:postOwner,video}]:[]);
 }throw new Error('unexpected');
 }});
 const env={ALLOWED_ORIGINS:'http://localhost:8080',SUPABASE_URL:'https://db.example',SUPABASE_ANON_KEY:'anon'};
 return {stored,deleted,operations,get present(){return present;},get range(){return range;},request:(path,init={})=>worker.fetch(new Request('https://video.example'+path,init),env)};
}
test('streaming revalidates post visibility and forwards byte ranges',async()=>{const f=fixture();const response=await f.request('/media/'+id,{headers:{Range:'bytes=0-4'}});assert.equal(response.status,206);assert.equal(f.range,'bytes=0-4');assert.equal(response.headers.get('Cache-Control'),'no-store');});
test('private, deleted and suspended-author posts cannot be read anonymously',async()=>{const f=fixture({publicVisible:false});assert.equal((await f.request('/media/'+id)).status,404);assert.equal((await f.request('/media/'+id,{headers:{Authorization:'Bearer user'}})).status,200);const gone=fixture({visible:false});assert.equal((await gone.request('/media/'+id,{headers:{Authorization:'Bearer user'}})).status,404);});
test('rejects unauthenticated, suspended and cross-origin uploads before storing bytes',async()=>{for(const [options,headers] of [[{},{}],[{suspended:true},{Authorization:'Bearer user'}],[{},{Origin:'https://evil.example',Authorization:'Bearer user'}]]){const f=fixture(options);const response=await f.request('/uploads/'+id,{method:'POST',body:'data',headers});assert.ok([401,403].includes(response.status));assert.equal(f.stored.length,0);}});
test('does not overwrite an existing post or remove its video',async()=>{const f=fixture();assert.equal((await f.request('/uploads/'+id,{method:'POST',headers:{Authorization:'Bearer user'},body:'data'})).status,409);assert.equal((await f.request('/uploads/'+key,{method:'DELETE',headers:{Authorization:'Bearer user'}})).status,409);assert.equal(f.deleted.length,0);});
test('uploads only inspected video under the authenticated owner and unique post',async()=>{const f=fixture({visible:false});const response=await f.request('/uploads/'+id,{method:'POST',headers:{Authorization:'Bearer user','Content-Type':'video/mp4'},body:'bytes'});assert.equal(response.status,201);const {video}=await response.json();assert.ok(video.key.startsWith(`${owner}/${id}/`));assert.equal(video.duration,2);assert.equal(f.stored.length,1);});
test('rejects a declared oversized upload before reading its body',async()=>{const f=fixture({visible:false});const response=await f.request('/uploads/'+id,{method:'POST',headers:{Authorization:'Bearer user','Content-Length':String(MAX_BYTES+200000)},body:'x'});assert.equal(response.status,400);assert.equal(f.stored.length,0);});
test('media parser rejects disguised non-video files',async()=>{await assert.rejects(inspectVideo(new TextEncoder().encode('<svg>not a movie</svg>')));});
test('multipart video and JPEG poster are inspected and stored as separate objects',async()=>{const f=fixture({visible:false});const form=new FormData();form.set('video',new Blob(['bytes'],{type:'video/mp4'}),'video.mp4');form.set('poster',new Blob([new Uint8Array([255,216,255,224,1])],{type:'image/jpeg'}),'poster.jpg');const response=await f.request('/uploads/'+id,{method:'POST',headers:{Authorization:'Bearer user'},body:form});assert.equal(response.status,201);const {video}=await response.json();assert.equal(f.stored.length,2);assert.equal(video.posterKey,video.key.replace(/\.mp4$/,'.jpg'));});
test('health probe checks dependencies without exposing credentials',async()=>{const f=fixture();const response=await f.request('/health');assert.equal(response.status,200);assert.deepEqual(await response.json(),{ready:true});});

test('deleting an owned video post removes video and poster before deleting its row through user RLS',async()=>{
 const f=fixture({video:{key,posterKey:key.replace(/\.mp4$/,'.jpg')}});
 const response=await f.request('/posts/'+id,{method:'DELETE',headers:{Authorization:'Bearer user'}});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
 assert.deepEqual(f.deleted,[key,key.replace(/\.mp4$/,'.jpg')]);assert.equal(f.operations.at(-1),'database');assert.equal(f.present,false);
 assert.equal((await f.request('/posts/'+id,{method:'DELETE',headers:{Authorization:'Bearer user'}})).status,200);assert.equal(f.deleted.length,2);
});
test('post deletion rejects unauthenticated, suspended and other-owner requests without touching storage',async()=>{
 for(const [options,headers] of [[{},{}],[{suspended:true},{Authorization:'Bearer user'}],[{postOwner:'44444444-4444-4444-8444-444444444444'},{Authorization:'Bearer user'}]]){
  const f=fixture(options);const response=await f.request('/posts/'+id,{method:'DELETE',headers});assert.ok([401,403].includes(response.status));assert.deepEqual(f.deleted,[]);assert.equal(f.present,true);
 }
});
test('metadata cannot redirect post deletion to another owner or another post folder',async()=>{
 for(const video of [{key:key.replace(owner,id)},{key,posterKey:key.replace(id,owner).replace(/\.mp4$/,'.jpg')},{key:key.replace('.mp4','/../file.mp4')}]){
  const f=fixture({video});assert.equal((await f.request('/posts/'+id,{method:'DELETE',headers:{Authorization:'Bearer user'}})).status,400);assert.deepEqual(f.deleted,[]);assert.equal(f.present,true);
 }
});
test('a storage failure keeps the post metadata and never submits the database deletion',async()=>{
 const f=fixture({objectFailure:true});const response=await f.request('/posts/'+id,{method:'DELETE',headers:{Authorization:'Bearer user'}});
 assert.equal(response.status,502);assert.equal(f.deleted.length,2);assert.equal(f.present,true);assert.ok(!f.operations.includes('database'));
});
test('a database failure remains retryable after the files have already been removed',async()=>{
 const f=fixture({databaseFailsOnce:true});const request=()=>f.request('/posts/'+id,{method:'DELETE',headers:{Authorization:'Bearer user'}});
 assert.equal((await request()).status,502);assert.equal(f.present,true);assert.equal((await request()).status,200);assert.equal(f.present,false);
});
