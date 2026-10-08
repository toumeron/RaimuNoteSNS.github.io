import {test} from 'node:test';import assert from 'node:assert/strict';
import {startExternalNotificationListener} from './external-notification-listener.mjs';
function fixture(rows){
 let changes,status;const calls=[],streams=[];const db={
  from(){return {select(){return this;},neq(){return this;},order(){return this;},range:async()=>({data:rows,error:null})};},
  rpc:async(name,body)=>{calls.push({name,body});return {error:null};},
  channel(){return {on(event,filter,fn){changes=fn;return this;},subscribe(fn){status=fn;return this;}};},removeChannel:async()=>{},
 };
 return {db,calls,streams,change:payload=>changes(payload),subscribed:()=>status('SUBSCRIBED'),options:{db,publicJson:async(url,body)=>url.includes('bsky')?{did:'did:plc:alice'}:{id:'misskey-alice'},fetchEvents:async()=>[],connect:(url,received,callbacks)=>{const stream={url:url(),received,callbacks,closed:false};streams.push(stream);return ()=>stream.closed=true;}}};
}
const row={id:'bsky-sub',provider:'bluesky',external_actor:'alice.bsky.social',created_at:'2026-10-08T00:00:00Z',external_cursor:{seen:['existing']}};
const event={kind:'commit',did:'did:plc:alice',commit:{operation:'create',collection:'app.bsky.feed.post',rkey:'new',record:{createdAt:'2026-10-08T01:00:00Z',text:'live'}}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('live Bluesky events immediately call the existing RPC and preserve the cursor',async()=>{
 const f=fixture([row]);const stop=await startExternalNotificationListener(f.options);
 assert.equal(f.streams.length,1);assert.match(f.streams[0].url,/wantedDids=did%3Aplc%3Aalice/);
 await f.streams[0].received({...event,did:'did:plc:other'});assert.equal(f.calls.length,0);
 await f.streams[0].received(event);assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].name,'record_external_post_notifications');assert.equal(f.calls[0].body.subscription,row.id);
 assert.deepEqual(f.calls[0].body.cursor.seen,['bsky:at://did:plc:alice/app.bsky.feed.post/new','existing']);
 await stop();assert.equal(f.streams[0].closed,true);
});
test('Misskey uses channel events; subscription deletion stops streams without a polling timer',async()=>{
 const rows=[{...row,id:'misskey-sub',provider:'misskey',external_actor:'alice@misskey.io'}];const f=fixture(rows);const stop=await startExternalNotificationListener(f.options);
 const sent=[];f.streams[0].callbacks.opened({send:frame=>sent.push(JSON.parse(frame))});assert.equal(sent[0].body.channel,'globalTimeline');
 await f.streams[0].received({type:'channel',body:{id:'lime-new-posts',type:'note',body:{id:'new',userId:'misskey-alice',visibility:'public',createdAt:'2026-10-08T01:00:00Z',text:'live'}}});assert.equal(f.calls.length,1);
 rows.splice(0);f.change({eventType:'DELETE',old:{id:'misskey-sub'}});await tick();assert.equal(f.streams[0].closed,true);
 await stop();
});
test('slow recovery does not block live events behind a feed request',async()=>{
 const f=fixture([row]);let release;f.options.fetchEvents=()=>new Promise(resolve=>{release=resolve;});
 const stop=await startExternalNotificationListener(f.options);await f.streams[0].received(event);assert.equal(f.calls.length,1);release([]);await tick();await stop();
});
