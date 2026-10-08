import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blueskyEvent,misskeyEvent,connectStream} from './external-notification-events.mjs';
const target={created_at:'2026-10-08T00:00:00Z',external_actor:'alice',target_name:'Alice'};
const bsky={kind:'commit',did:'did:plc:alice',commit:{operation:'create',collection:'app.bsky.feed.post',rkey:'new',record:{createdAt:'2026-10-08T01:00:00Z',text:'new post'}}};
const note={type:'channel',body:{id:'lime-new-posts',type:'note',body:{id:'new',userId:'alice',createdAt:'2026-10-08T01:00:00Z',visibility:'public',text:'new post',files:[]}}};
test('Bluesky commits are decoded immediately without a feed API request',()=>{
 assert.equal(blueskyEvent(bsky,target).id,'bsky:at://did:plc:alice/app.bsky.feed.post/new');
 for(const operation of ['update','delete'])assert.equal(blueskyEvent({...bsky,commit:{...bsky.commit,operation}},target),null);
 assert.equal(blueskyEvent({...bsky,commit:{...bsky.commit,record:{...bsky.commit.record,reply:{}}}},target),null);
 assert.equal(blueskyEvent(bsky,{...target,created_at:'2026-10-09'}),null);
});
test('Misskey events keep federated local IDs and exclude replies/private notes/renotes',()=>{
 assert.equal(misskeyEvent(note,target).id,'misskey:https://misskey.io/notes/new');
 for(const change of [{visibility:'followers'},{replyId:'parent'},{renoteId:'source',text:null},{createdAt:'2020-01-01'}])assert.equal(misskeyEvent({...note,body:{...note.body,body:{...note.body.body,...change}}},target),null);
 assert.equal(misskeyEvent({...note,body:{...note.body,id:'other-channel'}},target),null);
});
test('healthy sockets never schedule checks; failures reconnect and stop cancels reconnect',async()=>{
 const sockets=[],timers=[];let received=0,cancelled=0;
 const stop=connectStream(()=>'wss://public.test',()=>{received++;},{socketFactory:()=>{const socket={close(){this.onclose?.();}};sockets.push(socket);return socket;},schedule:(callback,delay)=>{timers.push({callback,delay});return timers.length;},cancel:()=>cancelled++});
 sockets[0].onopen();sockets[0].onmessage({data:JSON.stringify(bsky)});await Promise.resolve();
 assert.equal(received,1);assert.equal(timers.length,0);
 sockets[0].onclose();sockets[0].onerror();assert.equal(timers.length,1);assert.equal(timers[0].delay,1000);
 timers[0].callback();assert.equal(sockets.length,2);stop();assert.equal(cancelled,1);
});
