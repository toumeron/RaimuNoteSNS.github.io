import {expect,it} from 'vitest';
import {nextTwitterReplyCursor} from './twitterReplyPaging';
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
