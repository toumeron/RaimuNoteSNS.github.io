import {invitedGroupFriends} from './groupFriendParticipation.ts';
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
