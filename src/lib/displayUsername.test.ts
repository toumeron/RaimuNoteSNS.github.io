import {expect,it} from 'vitest';
import {displayUsername} from './displayUsername';
it('removes twitter suffixes from display without modifying the stored handle',()=>{
 const username='Google@Twitter.com';expect(displayUsername(username)).toBe('Google');expect(username).toBe('Google@Twitter.com');expect(displayUsername('Google@x.com')).toBe('Google');
});
it('preserves native, Bluesky, and Misskey handles',()=>{
 for(const value of ['local','artist.bsky.social','artist@misskey.io'])expect(displayUsername(value)).toBe(value);
});
