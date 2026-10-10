import {handleGroupFriends} from './index.ts';
const actor='11111111-1111-4111-8111-111111111111',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',message='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
for(const [key,value]of Object.entries({SUPABASE_URL:'https://db.test',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'}))Deno.env.set(key,value);
const request=()=>new Request('https://edge.test',{method:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({conversationId:id,messageId:message})});
async function mock(run:()=>Promise<void>,handler:(url:URL,init?:RequestInit)=>Response){const original=fetch;globalThis.fetch=((input:Request|string|URL,init?:RequestInit)=>Promise.resolve(handler(new URL(input instanceof Request?input.url:String(input)),init))) as typeof fetch;try{await run()}finally{globalThis.fetch=original}}
Deno.test('pending members cannot generate group friend replies',()=>mock(async()=>{const result=await handleGroupFriends(request());if(result.status!==403)throw Error('Pending member allowed')},url=>url.pathname==='/auth/v1/user'?Response.json({id:actor}):Response.json({is_group:true,group_members:{[actor]:{status:'pending'}}})));
Deno.test('multiple friends use bounded context, preserve history order and save server generated attribution',()=>{const saved:string[]=[],history:string[]=[];return mock(async()=>{const response=await handleGroupFriends(request());const body=await response.json();if(response.status!==200||body.failures.length||saved.length!==2||history.some(s=>s!=='参加者: One、Two、教えてください'))throw Error(JSON.stringify(body))},(url,init)=>{
 if(url.pathname==='/auth/v1/user')return Response.json({id:actor});
 if(url.pathname.endsWith('/direct_conversations'))return Response.json({is_group:true,group_members:{[actor]:{status:'accepted'}},group_friends:{one:{name:'One',prompt:'Friendly'.repeat(1000)},two:{name:'Two',prompt:'Quiet'}}});
 if(url.pathname.endsWith('/direct_messages')){if(url.searchParams.has('reply_to'))return Response.json([]);if(url.searchParams.has('id'))return Response.json({id:message,sender_id:actor,created_at:'2026-10-10T01:00:00Z'});return Response.json([{content:'One、Two、教えてください'},{content:'older'}])}
 if(url.pathname.endsWith('/chat-gemma')){const body=JSON.parse(String(init?.body));if(!body.contents[0].parts[0].text.includes('<reaction>絵文字</reaction>'))throw Error('Reaction instruction was truncated');history.push(body.contents.at(-1).parts[0].text);return new Response('data: {"choices":[{"delta":{"content":"<reaction>👍</reaction>\\nHello"}}]}\n\ndata: [DONE]\n\n')}
 if(url.pathname.endsWith('/save_group_friend_reply')){const body=JSON.parse(String(init?.body));if(body.actor!==actor||body.trigger_message!==message||body.body!=='Hello'||body.reaction!=='👍')throw Error('Incorrect reply');saved.push(body.friend);return Response.json(null)}throw Error(url.pathname);
})});
Deno.test('a friend may remain silent in a group without saving a reply or reaction',()=>mock(async()=>{
 const response=await handleGroupFriends(request());const result=await response.json();if(response.status!==200||result.failures.length)throw Error('Silence treated as error');
},(url,init)=>{
 if(url.pathname==='/auth/v1/user')return Response.json({id:actor});
 if(url.pathname.endsWith('/direct_conversations'))return Response.json({is_group:true,group_members:{[actor]:{status:'accepted'}},group_friends:{one:{name:'One',prompt:'Quiet'}}});
 if(url.pathname.endsWith('/direct_messages')){if(url.searchParams.has('reply_to'))return Response.json([]);if(url.searchParams.has('id'))return Response.json({id:message,sender_id:actor,created_at:'2026-10-10T01:00:00Z'});return Response.json([{content:'One、今日はどう思う？'}]);}
 if(url.pathname.endsWith('/chat-gemma')){if(!JSON.parse(String(init?.body)).contents[0].parts[0].text.includes('<skip/>'))throw Error('Missing participation instruction');return new Response('data: {"choices":[{"delta":{"content":"<skip/>"}}]}\n\ndata: [DONE]\n\n');}
 if(url.pathname.endsWith('/save_group_friend_reply'))throw Error('Silent friend saved a reply');
 throw Error(url.pathname);
}));
for(const text of ['あーーーー眠すぎる','あ、醤油を買うのを忘れたかも'])Deno.test(`unnecessary group reply is blocked before model generation: ${text}`,()=>mock(async()=>{
 const response=await handleGroupFriends(request());const result=await response.json();if(response.status!==200||result.failures.length)throw Error('Statement treated as error');
},url=>{
 if(url.pathname==='/auth/v1/user')return Response.json({id:actor});
 if(url.pathname.endsWith('/direct_conversations'))return Response.json({is_group:true,group_members:{[actor]:{status:'accepted'}},group_friends:{one:{name:'かなめなか',prompt:'Always respond helpfully'}}});
 if(url.pathname.endsWith('/direct_messages')){if(url.searchParams.has('reply_to'))return Response.json([]);if(url.searchParams.has('id'))return Response.json({id:message,sender_id:actor,content:text,created_at:'2026-10-10T01:00:00Z'});return Response.json([{content:text}]);}
 throw Error(`Unnecessary generation or save: ${url.pathname}`);
}));
