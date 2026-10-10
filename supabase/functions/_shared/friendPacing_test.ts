import {friendTypingDuration,waitForFriendReply,friendDeclinedReply} from './friendPacing.ts';
Deno.test('friend typing duration increases with actual Unicode text and stays bounded',()=>{
 if(friendTypingDuration('あ'.repeat(100))<=friendTypingDuration('あ'.repeat(10)))throw Error('Length ignored');
 if(friendTypingDuration('👍')!==friendTypingDuration('あ'))throw Error('Emoji counted as two characters');
 if(friendTypingDuration('長'.repeat(4000))!==12000)throw Error('Unbounded wait');
});
Deno.test('stopping a friend cancels the typing interval immediately',async()=>{
 const controller=new AbortController();const wait=waitForFriendReply('長'.repeat(100),Date.now(),controller.signal);controller.abort();
 try{await wait;throw Error('Not aborted')}catch(error){if(!(error instanceof DOMException)||error.name!=='AbortError')throw error}
 await waitForFriendReply('短い',Date.now()-20000);
});
Deno.test('group silence only accepts the explicit decision protocol',()=>{
 for(const text of ['<skip/>',' \n<skip/>\n'])if(!friendDeclinedReply(text))throw Error('Silence ignored');
 for(const text of ['Hello','Hello <skip/>','<reaction>👍</reaction>'])if(friendDeclinedReply(text))throw Error('Reply discarded');
});
