import { fetchExternalEvents } from "../supabase/functions/check-external-notifications/sources.ts";

// external-notification-listener.mjs
async function requestJson(url,body){const response=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('External actor resolution failed');return response.json();}
export async function startExternalNotificationListener({db,publicJson=requestJson,fetchEvents=fetchExternalEvents,connect=connectStream}){
const targets=new Map(),actors=new Map(),resolutions=new Map(),queues=new Map();
let stopBluesky,stopMisskey,blueskyFilter='',misskeyActive=false,stopping=false;
async function resolve(target){
 const actorKey=`${target.provider}:${target.external_actor}`;
 if(!resolutions.has(actorKey))resolutions.set(actorKey,(async()=>{
  if(target.provider==='bluesky')return (await publicJson(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(target.external_actor)}`)).did;
  const [username,...domain]=target.external_actor.replace(/^@/,'').split('@');const host=domain.join('@');
  return (await publicJson('https://misskey.io/api/users/show',{username,host:!host||host==='misskey.io'?null:host})).id;
 })());
 try{return await resolutions.get(actorKey);}catch(error){resolutions.delete(actorKey);throw error;}
}
async function enqueue(id,work){
 const previous=queues.get(id)??Promise.resolve();const next=previous.catch(()=>{}).then(work);queues.set(id,next);
 try{await next;}finally{if(queues.get(id)===next)queues.delete(id);}
}
async function record(id,events){
 const target=targets.get(id);if(!target||!events.length)return;
 const seen=[...new Set([...events.map(event=>event.id).reverse(),...(target.external_cursor?.seen??[])])].slice(0,1000);
 // Retry this received event after a DB outage, rather than polling the SNS.
 let attempt=0;
 while(targets.has(id)&&!stopping){
  const {error}=await db.rpc('record_external_post_notifications',{subscription:id,events,cursor:{seen}});
  if(!error)break;
  await new Promise(resolve=>setTimeout(resolve,Math.min(30000,1000*2**attempt++)));
 }
 if(!targets.has(id)||stopping)return;
 target.external_cursor={seen};
}
async function recover(provider){
 // One catch-up on startup/reconnection, not a timer. Reuses age/dedup rules.
 for(const target of targets.values())if(target.provider===provider){
  try{const events=await fetchEvents(target);await enqueue(target.id,()=>record(target.id,events));}
  catch{console.error('Stream recovery failed');}
 }
}
function configureStreams(){
 const dids=[...new Set([...actors.values()].filter(value=>value.provider==='bluesky').map(value=>value.actor))].sort();
 const filter=dids.join(',');
 if(filter!==blueskyFilter){
  stopBluesky?.();blueskyFilter=filter;
  if(dids.length)stopBluesky=connect(()=>{
   const url=new URL('wss://jetstream2.us-east.bsky.network/subscribe');url.searchParams.set('wantedCollections','app.bsky.feed.post');for(const did of dids)url.searchParams.append('wantedDids',did);
   // Replay a small overlap across disconnects; DB event keys prevent duplicates.
   url.searchParams.set('cursor',String((Date.now()-60000)*1000));return url.href;
  },async message=>{
   await Promise.all([...actors].filter(([,actor])=>actor.provider==='bluesky'&&actor.actor===message.did).map(async([id])=>{const target=targets.get(id);const event=target&&blueskyEvent(message,target);if(event)await enqueue(id,()=>record(id,[event]));}));
  },{opened:()=>{void recover('bluesky');}});
 }
 const needed=[...actors.values()].some(value=>value.provider==='misskey');
 if(needed!==misskeyActive){
  stopMisskey?.();misskeyActive=needed;
  if(needed)stopMisskey=connect(()=>'wss://misskey.io/streaming',async message=>{
   const author=message.body?.body?.userId??message.body?.body?.user?.id;
   await Promise.all([...actors].filter(([,actor])=>actor.provider==='misskey'&&actor.actor===author).map(async([id])=>{const target=targets.get(id);const event=target&&misskeyEvent(message,target);if(event)await enqueue(id,()=>record(id,[event]));}));
  },{opened:socket=>{socket.send(JSON.stringify({type:'connect',body:{channel:'globalTimeline',id:'lime-new-posts',params:{withRenotes:false}}}));void recover('misskey');}});
 }
}
async function loadTargets(){
 const rows=[];
 for(let page=0;;page++){
  const {data,error}=await db.from('post_notification_subscriptions').select('*').neq('provider','limenote').order('id').range(page*1000,page*1000+999);if(error)throw new Error('Subscription read failed');rows.push(...data);if(data.length<1000)break;
 }
 const present=new Set(rows.map(row=>row.id));for(const id of targets.keys())if(!present.has(id)){targets.delete(id);actors.delete(id);}
 await Promise.all(rows.map(async row=>{
  const previous=targets.get(row.id);targets.set(row.id,{...row,external_cursor:previous?.external_cursor??row.external_cursor});
  if(actors.has(row.id))return;
  try{actors.set(row.id,{provider:row.provider,actor:await resolve(row)});void fetchEvents(row).then(events=>enqueue(row.id,()=>record(row.id,events))).catch(()=>console.error('New subscription recovery failed'));}catch{console.error('Subscription actor could not be resolved');}
 }));configureStreams();
}
let refresh=Promise.resolve();
function refreshTargets(){refresh=refresh.catch(()=>{}).then(()=>{if(!stopping)return loadTargets();});return refresh;}
const channel=db.channel('external-notification-subscriptions')
 .on('postgres_changes',{event:'*',schema:'public',table:'post_notification_subscriptions'},payload=>{
  // Own cursor writes are updates; do not restart listeners for those.
  if(payload.eventType==='UPDATE')return;
  void refreshTargets().catch(()=>console.error('Subscription refresh failed'));
 }).subscribe(status=>{
  if(status==='SUBSCRIBED')void refreshTargets().catch(()=>console.error('Subscription refresh failed'));
  if(status==='CHANNEL_ERROR')console.error('Subscription event connection failed; client reconnecting');
 });
await refreshTargets();
console.log('External notification listener started; waiting for events (no polling)');
async function stop(){if(stopping)return;stopping=true;stopBluesky?.();stopMisskey?.();await db.removeChannel(channel);await Promise.allSettled([...queues.values()]);}

return stop;
}


// external-notification-events.mjs
// Pure decoding shared by the permanent listener and its tests.
export function blueskyEvent(message, target) {
 const commit=message?.commit;
 if(message?.kind!=='commit'||commit?.operation!=='create'||commit.collection!=='app.bsky.feed.post'||!commit.rkey||commit.record?.reply)return null;
 const record=commit.record;const created_at=record?.createdAt;
 if(!Number.isFinite(Date.parse(created_at))||Date.parse(created_at)<Date.parse(target.created_at))return null;
 const embed=record.embed?.media??record.embed;
 const images=(embed?.images??[]).map(image=>image.image?.ref?.$link).filter(Boolean).map(cid=>`https://cdn.bsky.app/img/feed_thumbnail/plain/${encodeURIComponent(message.did)}/${encodeURIComponent(cid)}@jpeg`);
 return {id:`bsky:at://${message.did}/app.bsky.feed.post/${commit.rkey}`,created_at,name:target.target_name||target.external_actor,avatar:target.target_avatar_url||'',content:record.text??'',images};
}
export function misskeyEvent(message, target) {
 if(message?.type!=='channel'||message.body?.id!=='lime-new-posts'||message.body.type!=='note')return null;
 const note=message.body.body;
 if(!note?.id||note.visibility!=='public'||note.replyId||note.renoteId&&!note.text&&!note.files?.length)return null;
 if(!Number.isFinite(Date.parse(note.createdAt))||Date.parse(note.createdAt)<Date.parse(target.created_at))return null;
 return {id:`misskey:https://misskey.io/notes/${note.id}`,created_at:note.createdAt,name:note.user?.name||target.target_name||target.external_actor,avatar:note.user?.avatarUrl||target.target_avatar_url||'',content:[note.cw,note.text].filter(Boolean).join('\n\n'),images:(note.files??[]).filter(file=>file.type?.startsWith('image/')).map(file=>file.thumbnailUrl||file.url)};
}
// Timers are used only after connection failure, never to check for posts.
export function connectStream(url, onMessage, {opened=()=>{},socketFactory=url=>new WebSocket(url),schedule=setTimeout,cancel=clearTimeout}={}) {
 let socket,timer,stopped=false,attempt=0;
 const connect=()=>{
  if(stopped)return;
  const current=socketFactory(url());socket=current;let retryScheduled=false;
  const retry=()=>{if(stopped||retryScheduled)return;retryScheduled=true;timer=schedule(connect,Math.min(30000,1000*2**attempt++));};
  current.onopen=()=>{attempt=0;opened(current);};
  current.onmessage=event=>{try{const message=JSON.parse(event.data);Promise.resolve(onMessage(message)).catch(()=>console.error('Stream delivery failed; recovery will reconcile on reconnect'));}catch{/* Ignore malformed public frames. */}};
  current.onerror=()=>{current.close();retry();};current.onclose=retry;
 };
 connect();return ()=>{stopped=true;if(timer)cancel(timer);socket?.close();};
}


// socket.mjs
// Cloudflare's outgoing sockets use an HTTP Upgrade rather than new WebSocket(url).
export function cloudflareSocketClass(fetcher=fetch){
 return class CloudflareSocket extends EventTarget {
  static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
  readyState=0;binaryType='arraybuffer';bufferedAmount=0;extensions='';protocol='';
  onopen=null;onmessage=null;onclose=null;onerror=null;
  constructor(address,protocols){
   super();this.url=String(address);this.socket=null;this.closed=false;
   void this.connect(protocols);
  }
  emit(type,details={}){const event=Object.assign(new Event(type),details);this.dispatchEvent(event);this[`on${type}`]?.(event);}
  async connect(protocols){
   try{
    const url=new URL(this.url);url.protocol=url.protocol==='wss:'?'https:':'http:';
    const headers={Upgrade:'websocket'};if(protocols?.length)headers['Sec-WebSocket-Protocol']=Array.isArray(protocols)?protocols.join(','):protocols;
    const response=await fetcher(url.href,{headers});const socket=response.webSocket;
    if(!socket)throw new Error('WebSocket upgrade failed');this.socket=socket;
    socket.addEventListener('message',event=>this.emit('message',{data:event.data}));
    socket.addEventListener('error',()=>this.emit('error'));
    socket.addEventListener('close',event=>{this.closed=true;this.readyState=3;this.emit('close',{code:event.code,reason:event.reason,wasClean:event.wasClean});});
    socket.accept();if(this.closed){socket.close(1000,'Listener stopped');return;}
    this.readyState=1;this.emit('open');
   }catch{this.readyState=3;this.emit('error');if(!this.closed){this.closed=true;this.emit('close',{code:1006,reason:'Connection failed',wasClean:false});}}
  }
  send(data){if(this.readyState!==1)throw new Error('WebSocket is not open');this.socket.send(data);}
  close(code=1000,reason=''){
   if(this.closed)return;this.closed=true;this.readyState=2;
   if(this.socket)this.socket.close(code,reason);
   else{this.readyState=3;this.emit('close',{code,reason,wasClean:true});}
  }
 };
}
