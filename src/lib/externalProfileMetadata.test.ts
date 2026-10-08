import {beforeEach,expect,it,vi} from 'vitest';
const reader=vi.hoisted(()=>vi.fn());
vi.mock('./bluesky',()=>({fetchBlueskyProfile:reader}));
import {completeExternalPostAuthors} from './externalProfileMetadata';
beforeEach(()=>{reader.mockReset();});
it('fills missing external author metadata, coalesces an author and preserves native posts',async()=>{
 reader.mockResolvedValue({id:'did:artist',username:'metadata-artist.bsky.social',displayName:'作者',avatarUrl:'https://images.example/avatar',bio:'作品'});
 const native={id:'native',userId:'native-author',author:{username:'native'}};
 const missing={id:'bsky:one',userId:'did:artist',author:{username:'metadata-artist.bsky.social'}};
 const rows=await completeExternalPostAuthors([native,missing,{...missing,id:'bsky:two'}]);
 expect(reader).toHaveBeenCalledTimes(1);expect(rows[0]).toBe(native);
 expect(rows[1].author).toMatchObject({displayName:'作者',avatarUrl:'https://images.example/avatar'});
 expect(rows[2].author).toMatchObject({display_name:'作者',avatar_url:'https://images.example/avatar'});
});
it('retains the saved snapshot when the external profile is unavailable',async()=>{
 reader.mockRejectedValue(new Error('unavailable'));
 const saved={id:'misskey:one',userId:'misskey-user:artist',author:{username:'unavailable@misskey.io',displayName:'保存済み名'}};
 expect(await completeExternalPostAuthors([saved])).toEqual([saved]);
});
it('does not fetch complete snapshots',async()=>{
 const saved={id:'bsky:complete',userId:'did:complete',author:{username:'complete',displayName:'作者',avatarUrl:'avatar'}};
 expect((await completeExternalPostAuthors([saved]))[0]).toBe(saved);expect(reader).not.toHaveBeenCalled();
});

it('does not trigger an update loop for accounts that have no avatar',async()=>{
 reader.mockResolvedValue({id:'did:no-avatar',username:'no-avatar.bsky.social',displayName:'作者',avatarUrl:''});
 const saved={id:'bsky:no-avatar',userId:'did:no-avatar',author:{username:'no-avatar.bsky.social',displayName:'作者',avatarUrl:''}};
 expect((await completeExternalPostAuthors([saved]))[0]).toBe(saved);
 expect((await completeExternalPostAuthors([saved]))[0]).toBe(saved);
 expect(reader).toHaveBeenCalledTimes(1);
});
it('does not start queued profile reads after leaving the page',async()=>{
 const controller=new AbortController();controller.abort();
 const saved={id:'bsky:cancelled',userId:'did:cancelled',author:{username:'cancelled.bsky.social'}};
 expect((await completeExternalPostAuthors([saved],controller.signal))[0]).toBe(saved);
 expect(reader).not.toHaveBeenCalled();
});
