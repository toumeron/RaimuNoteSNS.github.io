import { boundedChatContext, friendTypingDuration, waitForFriendReply, friendDeclinedReply, parseFriendResponse, invitedGroupFriends } from "./chatContext.ts";

// chatContext_test
Deno.test('chat context keeps latest user separately and bounds history and instructions',()=>{
 const result=boundedChatContext([{role:'user',parts:[{text:'【システム命令:'+ 's'.repeat(10000)}]},...Array.from({length:100},(_,i)=>({role:i%2?'model':'user',parts:[{text:`turn${i} `+'h'.repeat(5000)}]})),{role:'user',parts:[{text:'最新発言'}]}]);
 if(result[0].parts![0].text!.length!==2000||result.at(-1)?.parts?.[0].text!=='最新発言'||result.length>25)throw Error('Instruction or latest turn lost');
 const length=result.slice(1).reduce((n,i)=>n+i.parts!.reduce((n,p)=>n+(p.text?.length??0),0),0);if(length>4000)throw Error('Unbounded history');
});
Deno.test('chat context preserves short exchanges and attached media',()=>{
 const items=[{role:'user',parts:[{text:'【システム命令: test】'}]},{role:'user',parts:[{text:'こんにちは'}]},{role:'model',parts:[{text:'こんにちは！'}]},{role:'user',parts:[{text:'続けて'},{inlineData:{data:'abc'}}]}];
 const result=boundedChatContext(items);if(JSON.stringify(result)!==JSON.stringify(items))throw Error('Short context changed');
});

// friendPacing_test
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

// friendReaction_test
Deno.test('friend reaction parsing hides partial streamed metadata and rejects invalid emojis',()=>{
 for(const text of ['<','<react','<reaction>👍</react'])if(parseFriendResponse(text).reply)throw Error('Leaked reaction tag');
 const valid=parseFriendResponse('<reaction>👍</reaction>\nいいね！');if(valid.reply!=='いいね！'||valid.reaction!=='👍')throw Error('Wrong parse');
 const invalid=parseFriendResponse('<reaction>unknown</reaction>\n本文');if(invalid.reaction!==null||invalid.reply!=='本文')throw Error('Invalid reaction accepted');
 if(parseFriendResponse('普通の返答').reply!=='普通の返答')throw Error('Legacy reply hidden');
});

// groupFriendParticipation_test
const friends=[{id:'one',name:'かなめなか'},{id:'two',name:'担々麺'}];
Deno.test('group friends do not generate advice for casual statements',()=>{
 for(const text of ['あーーーー眠すぎる','あ、醤油を買うのを忘れたかも','ありがとう','おやすみ','うん','今日は買い物に行った'])if(invitedGroupFriends(text,friends,'msg').size)throw Error(`Uninvited reply: ${text}`);
});
Deno.test('named invitations and replies only invite the intended friend',()=>{
 if([...invitedGroupFriends('かなめなか、どう思う？',friends,'msg')].join()!=='one')throw Error('Wrong friend');
 if([...invitedGroupFriends('どう思う？',friends,'msg','two')].join()!=='two')throw Error('Reply ignored');
 if(invitedGroupFriends('どう思う？',friends,'msg',null).size)throw Error('Intruded into human conversation');
});
Deno.test('open questions choose one friend but explicit group questions may invite everyone',()=>{
 if(invitedGroupFriends('おすすめの店ある？',friends,'msg').size!==1)throw Error('Duplicate answers');
 if(invitedGroupFriends('二人とも、どう思う？',friends,'msg').size!==2)throw Error('Group invitation ignored');
});
