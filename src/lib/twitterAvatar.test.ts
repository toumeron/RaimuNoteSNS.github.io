import {expect,it}from'vitest';
import {twitterAvatarUrl}from'./twitterAvatar';
import {mapXUser}from'./fxTwitter';
it.each(['normal','bigger','mini','200x200','400x400'])('uses the full avatar instead of the %s thumbnail',size=>{const url=`https://pbs.twimg.com/profile_images/123/avatar_${size}.jpg`;expect(twitterAvatarUrl(url)).toBe('https://pbs.twimg.com/profile_images/123/avatar.jpg');expect(mapXUser({id:'123',screen_name:'artist',avatar_url:url}).avatarUrl).toBe('https://pbs.twimg.com/profile_images/123/avatar.jpg');});
it('does not modify other providers, media or lookalike domains',()=>{for(const url of ['https://example.com/profile_images/123/avatar_normal.jpg','https://pbs.twimg.com.evil.test/profile_images/123/avatar_normal.jpg','https://pbs.twimg.com/media/photo_200x200.jpg','https://pbs.twimg.com/profile_images/123/avatar.jpg'])expect(twitterAvatarUrl(url)).toBe(url);});
