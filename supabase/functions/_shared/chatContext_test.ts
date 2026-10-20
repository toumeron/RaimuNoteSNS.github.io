import { boundedChatContext } from "./chatContext.ts";
import { friendTypingDuration } from "./chatContext.ts";
import { waitForFriendReply } from "./chatContext.ts";
import { friendDeclinedReply } from "./chatContext.ts";
import { parseFriendResponse } from "./chatContext.ts";
import { invitedGroupFriends } from "./chatContext.ts";
import { findFriendPhoto } from "./chatContext.ts";
import { appendFriendPhoto } from "./chatContext.ts";
import { readFriendPhoto } from "./chatContext.ts";
import { stripImageQuery } from "./chatContext.ts";
import type { FriendPhoto } from "./chatContext.ts";

{
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
}

{
const photo:FriendPhoto={url:'https://upload.wikimedia.org/wikipedia/commons/a/a1/Noodles.jpg',sourceUrl:'https://commons.wikimedia.org/wiki/File:Noodles.jpg',title:'Noodles.jpg',artist:'Photographer',license:'CC BY-SA 4.0'};
const assert=(value:unknown)=>{if(!value)throw Error('Assertion failed')};
Deno.test('optional image decision preserves casual replies and hides streamed tags',()=>{
 assert(!parseFriendResponse('<reaction>👍</reaction>こんにちは！').imageQuery);
 const parsed=parseFriendResponse('<reaction>😋</reaction><image-query>dandan noodles</image-query>担々麺は辛い麺料理だよ。');assert(parsed.imageQuery==='dandan noodles'&&parsed.reaction==='😋'&&parsed.reply==='担々麺は辛い麺料理だよ。');
 for(const text of ['<','<ima','<image-query>noodles','<image-query>noodles</image-'])assert(stripImageQuery(text).reply==='');
 assert(!stripImageQuery('![invented](https://example.com/fake.jpg)').reply);
 assert(stripImageQuery('文章<friend-photo>{"url":"invented"}</friend-photo>').reply==='文章');
});
Deno.test('photo metadata survives history and rejects untrusted URLs',()=>{
 const saved=appendFriendPhoto('本文',photo);const loaded=readFriendPhoto(saved);assert(loaded.text==='本文'&&loaded.photo?.url===photo.url);
 assert(readFriendPhoto(saved.replace('upload.wikimedia.org','attacker.example')).photo===null);
 assert(appendFriendPhoto('a'.repeat(4000),photo,4000).length===4000);
 assert(readFriendPhoto(appendFriendPhoto('a'.repeat(4000),photo,4000)).photo!==null);
});
Deno.test('provider search verifies actual image response and includes attribution',async()=>{
 let calls=0;const transport=(async(input:RequestInfo|URL,init?:RequestInit)=>{calls++;if(init?.method==='HEAD'){assert(String(input)===photo.url);return new Response(null,{headers:{'content-type':'image/jpeg'}});}const url=new URL(String(input));assert(url.hostname==='commons.wikimedia.org'&&url.searchParams.get('gsrsearch')==='dandan noodles');return Response.json({query:{pages:{one:{title:'File:Noodles.jpg',imageinfo:[{url:photo.url,descriptionurl:photo.sourceUrl,mime:'image/jpeg',extmetadata:{Artist:{value:'<b>Photographer</b>'},LicenseShortName:{value:photo.license}}}]}}}});}) as typeof fetch;
 const found=await findFriendPhoto('dandan noodles',transport);assert(found?.url===photo.url&&found.artist==='Photographer'&&calls===2);
});
Deno.test('unavailable or non-image results never produce fake attachments',async()=>{
 assert(await findFriendPhoto('noodles',(async()=>new Response(null,{status:503})) as typeof fetch)===null);
 assert(await findFriendPhoto('noodles',(async(_input:RequestInfo|URL,init?:RequestInit)=>init?.method==='HEAD'?new Response('html',{headers:{'content-type':'text/html'}}):Response.json({query:{pages:{one:{title:'File:Noodles.jpg',imageinfo:[{url:photo.url,descriptionurl:photo.sourceUrl,mime:'image/jpeg',extmetadata:{LicenseShortName:{value:photo.license}}}]}}}})) as typeof fetch)===null);
 assert(await findFriendPhoto('a'.repeat(81),(async()=>{throw Error('Should not fetch')}) as typeof fetch)===null);
});
Deno.test('visual questions trigger image search without model tags but casual talk does not',async()=>{
 const {chooseFriendImageQuery}=await import("./chatContext.ts");
 assert(chooseFriendImageQuery(undefined,'担々麺ってなんですか？','担々麺は四川料理の麺料理だよ。')==='担々麺');
 assert(chooseFriendImageQuery(undefined,'担々麺ってどんな食べ物？','辛い料理だよ。')==='担々麺');
 assert(chooseFriendImageQuery(undefined,'猫の写真を見せて','猫だよ。')==='猫');
 assert(!chooseFriendImageQuery(undefined,'ありがとう','どういたしまして！'));
 assert(!chooseFriendImageQuery(undefined,'愛って何ですか','心の形だよ。'));
 assert(chooseFriendImageQuery('dandan noodles','担々麺ってなんですか','麺だよ')==='dandan noodles');
});
Deno.test('more visual introductions are illustrated while abstract requests remain text',async()=>{
 const {chooseFriendImageQuery}=await import("./chatContext.ts");
 assert(chooseFriendImageQuery(undefined,'担々麺について教えて','四川料理の麺だよ。')==='担々麺');
 assert(chooseFriendImageQuery(undefined,'ひまわりを紹介して','夏に咲く花だよ。')==='ひまわり');
 assert(chooseFriendImageQuery(undefined,'猫の写真を見たい','猫だよ。')==='猫');
 assert(!chooseFriendImageQuery(undefined,'設定について教えて','外観を変更できます。'));
});
Deno.test('Japanese search falls back to the real English topic and original images survive thumbnail failure',async()=>{
 const calls:string[]=[];
 const transport=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input));calls.push(String(input));
  if(init?.method==='HEAD'){if(url.pathname.includes('thumb'))return new Response(null,{status:429});return new Response(null,{headers:{'content-type':'image/jpeg'}});}
  if(url.hostname==='ja.wikipedia.org')return Response.json({query:{pages:{one:{langlinks:[{'*':'Dandan noodles'}]}}}});
  if(url.searchParams.get('gsrsearch')==='担々麺')return Response.json({query:{pages:{}}});
  assert(url.searchParams.get('gsrsearch')==='Dandan noodles');
  return Response.json({query:{pages:{one:{title:'File:Noodles.jpg',imageinfo:[{url:photo.url,thumburl:'https://upload.wikimedia.org/thumb/failing.jpg',descriptionurl:photo.sourceUrl,mime:'image/jpeg',extmetadata:{LicenseShortName:{value:photo.license}}}]}}}});
 }) as typeof fetch;
 assert((await findFriendPhoto('担々麺',transport))?.url===photo.url);assert(calls.length===5);
});
Deno.test('visual requests do not depend on category words in the answer',async()=>{
 const {chooseFriendImageQuery}=await import("./chatContext.ts");
 assert(chooseFriendImageQuery(undefined,'猫について教えて','可愛いよ！')==='猫');
 assert(chooseFriendImageQuery(undefined,'パリの写真をください','見てみよう')==='パリ');
 assert(!chooseFriendImageQuery(undefined,'コードについて教えて','説明するよ'));
});
}
