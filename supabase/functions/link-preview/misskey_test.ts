import { loadMisskey } from './load.ts';
Deno.test('forwards the boolean reply filter for a complete author feed', async () => {
 const original=globalThis.fetch;
 globalThis.fetch=async(_input,init)=>{const body=JSON.parse(String(init?.body));if(body.withReplies!==true||body.limit!==100)throw new Error('Reply filter lost');return Response.json([]);};
 try {
  await loadMisskey('users/notes',{userId:'creator',limit:100,withReplies:true});
  let rejected=false;try{await loadMisskey('users/notes',{userId:'creator',withReplies:'true'});}catch{rejected=true;}
  if(!rejected)throw new Error('Invalid filter accepted');
 } finally {globalThis.fetch=original;}
});
Deno.test('reads direct replies through the fixed-server relay and removes private data', async () => {
 const original=globalThis.fetch;let called='';
 globalThis.fetch=async(input,init)=>{called=String(input);const body=JSON.parse(String(init?.body));if(body.noteId!=='root123'||body.limit!==100)throw new Error('Invalid forwarding');return Response.json([{id:'reply123',visibility:'public',text:'返信',user:{id:'author',username:'author',token:'secret'}},{id:'private123',visibility:'followers',text:'private'}]);};
 try {
  const result=await loadMisskey('notes/replies',{noteId:'root123',limit:100}) as any[];
  if(called!=='https://misskey.io/api/notes/replies'||result[0].user.token||result[1].text)throw new Error('Unsafe reply read');
 } finally {globalThis.fetch=original;}
});
Deno.test('still refuses provider writes and credentials', async()=>{
 for(const [endpoint,params] of [['notes/reactions/create',{noteId:'root123'}],['notes/replies',{noteId:'root123',i:'secret'}]] as const){
  let rejected=false;try{await loadMisskey(endpoint,params);}catch{rejected=true;}
  if(!rejected)throw new Error('Unsafe operation accepted');
 }
});
