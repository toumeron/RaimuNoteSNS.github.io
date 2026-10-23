import {expect,it} from 'vitest';
import {profileIdentity} from './profileIdentity';
it('recognizes the own profile from the current session while user metadata reloads',()=>{
 expect(profileIdentity('me',{sessionId:'me'})).toEqual({viewerId:'me',isMe:true,canInteract:false});
 expect(profileIdentity('me',{userId:'me',sessionId:'me'}).canInteract).toBe(false);
});
it.each([{loading:true},{switching:true},{userId:'old',sessionId:'me'},{}])('does not show relationship actions during an unresolved identity %j',auth=>{
 expect(profileIdentity('me',auth).canInteract).toBe(false);
});
it('does not hide legitimate other-account actions after a completed account switch',()=>{
 expect(profileIdentity('old',{userId:'new',sessionId:'new'})).toEqual({viewerId:'new',isMe:false,canInteract:true});
});
