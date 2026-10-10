import {describe,it,expect} from 'vitest';
import {findChatPostLink} from './chatPostLink';
const id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
describe('chat post links',()=>{
 it('recognizes deployed and local LimeNote post links within text',()=>{
  for(const base of ['https://toumeron.github.io/RaimuNoteSNS.github.io','http://localhost:8080/RaimuNoteSNS.github.io','http://127.0.0.1:8080'])expect(findChatPostLink(`見てください ${base}/post/${id}。`)?.id).toBe(id);
 });
 it('ignores external hosts, profile URLs and malformed post IDs',()=>{
  for(const url of [`https://example.com/post/${id}`,`https://toumeron.github.io.evil.example/post/${id}`,'https://toumeron.github.io/RaimuNoteSNS.github.io/u/cat','https://toumeron.github.io/post/bad-id'])expect(findChatPostLink(url)).toBeNull();
 });
});
