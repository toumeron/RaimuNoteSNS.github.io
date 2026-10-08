import {expect,it} from 'vitest';
import {normalizePreferences,groupNotifications,notificationLink,type NotificationRow} from './notifications';
const row:NotificationRow={id:'1',user_id:'me',actor_id:'actor',post_id:'post',type:'like',actor_name:'Alice',actor_avatar_url:null,content_preview:'post',is_read:false,created_at:'2026-10-08T10:00:00Z'};
it('defaults existing accounts to enabled while preserving explicit disabled preferences',()=>{expect(normalizePreferences({like:false,push:false})).toMatchObject({like:false,push:false,reply:true,follow:true});});
it('groups matching events without merging different posts, emoji or dates',()=>{
 const groups=groupNotifications([row,{...row,id:'2',actor_id:'other'},{...row,id:'3',post_id:'different'},{...row,id:'4',type:'reaction',emoji:'❤️'},{...row,id:'5',type:'reaction',emoji:'👍'},{...row,id:'6',created_at:'2026-10-07T10:00:00Z'}]);expect(groups).toHaveLength(5);expect(groups[0].rows).toHaveLength(2);
});
it('links to external posts safely and follows to the actor profile',()=>{expect(notificationLink({...row,post_id:null,external_post_id:'bsky:at://did:plc:x/app.bsky.feed.post/a'})).toBe('/post/bsky%3Aat%3A%2F%2Fdid%3Aplc%3Ax%2Fapp.bsky.feed.post%2Fa');expect(notificationLink({...row,type:'follow',post_id:null,actor_username:'alice'})).toBe('/u/alice');expect(notificationLink({...row,comment_id:'reply'})).toBe('/post/reply%3Areply');});
