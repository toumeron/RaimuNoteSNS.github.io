import {parseFriendResponse} from './friendReaction.ts';
Deno.test('friend reaction parsing hides partial streamed metadata and rejects invalid emojis',()=>{
 for(const text of ['<','<react','<reaction>👍</react'])if(parseFriendResponse(text).reply)throw Error('Leaked reaction tag');
 const valid=parseFriendResponse('<reaction>👍</reaction>\nいいね！');if(valid.reply!=='いいね！'||valid.reaction!=='👍')throw Error('Wrong parse');
 const invalid=parseFriendResponse('<reaction>unknown</reaction>\n本文');if(invalid.reaction!==null||invalid.reply!=='本文')throw Error('Invalid reaction accepted');
 if(parseFriendResponse('普通の返答').reply!=='普通の返答')throw Error('Legacy reply hidden');
});
