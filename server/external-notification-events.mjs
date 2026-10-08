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
