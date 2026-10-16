import { expect, it } from "vitest";
import { nextTwitterReplyCursor, twitterReplyText } from "@/lib/twitterReplyPaging";

describe("twitterReplyPaging", () => {
const page=(ids:string[],cursor:string|null,totalReplies?:number)=>({post:{id:'x:parent'},replies:ids.map(id=>({id,externalReplyToId:'x:parent'})),cursor,totalReplies});
it('does not offer more replies for empty or complete conversations despite a server cursor',()=>{
 const empty=page([],'phantom',0);expect(nextTwitterReplyCursor(empty,[empty])).toBeUndefined();
 const complete=page(['one','two'],'phantom',2);expect(nextTwitterReplyCursor(complete,[complete])).toBeUndefined();
});
it('stops once the combined pages contain every direct reply',()=>{
 const first=page(['one'],'second',2),last=page(['two'],'third');
 expect(nextTwitterReplyCursor(first,[first])).toBe('second');expect(nextTwitterReplyCursor(last,[first,last],'second',[null,'second'])).toBeUndefined();
});
it('does not confuse nested replies with remaining direct replies',()=>{
 const first=page(['one'],'more',2);first.replies.push({id:'child',externalReplyToId:'one'});
 expect(nextTwitterReplyCursor(first,[first])).toBe('more');
});
it('stops repeated replies and cyclic cursors without further requests',()=>{
 const first=page(['one'],'second'),copy=page(['one'],'third');
 expect(nextTwitterReplyCursor(copy,[first,copy],'second')).toBeUndefined();
 const fresh=page(['two'],'used');expect(nextTwitterReplyCursor(fresh,[first,fresh],'second',[null,'used','second'])).toBeUndefined();
});
it('keeps a proven continuation when the service omits the reply total',()=>{
 const first=page(['one'],'second');expect(nextTwitterReplyCursor(first,[first])).toBe('second');
});
});

describe("twitterReplyText", () => {
it('removes only the leading recipient block on replies',()=>{
 expect(twitterReplyText('@alice @bob_2 本文 @carol に連絡',true)).toBe('本文 @carol に連絡');
 expect(twitterReplyText('@alice\n@bob 本文',true)).toBe('本文');
 expect(twitterReplyText('@alice',true)).toBe('');
});
it('preserves non-replies, intentional later mentions and email-like text',()=>{
 expect(twitterReplyText('@alice 通常投稿',false)).toBe('@alice 通常投稿');
 expect(twitterReplyText('本文 @alice',true)).toBe('本文 @alice');
 expect(twitterReplyText('@alice@example.com',true)).toBe('@alice@example.com');
});
});
