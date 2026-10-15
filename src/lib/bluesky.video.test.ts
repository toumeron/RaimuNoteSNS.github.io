import {expect,it} from 'vitest';
import {mapBlueskyFeedItemToPost} from './bluesky';
import {normalizeTimelineBlueskyPost} from './timelinePaging';
const video={$type:'app.bsky.embed.video#view',playlist:'https://video.bsky.app/watch/abc/playlist.m3u8',thumbnail:'https://video.bsky.app/thumb.jpg',aspectRatio:{width:1080,height:1920},alt:'動画の説明'};
const map=(embed:typeof video|{$type:string;media:typeof video})=>mapBlueskyFeedItemToPost({post:{uri:'at://did:plc:artist/app.bsky.feed.post/video',author:{did:'did:plc:artist',handle:'artist.bsky.social'},record:{text:'動画'},embed}})!;
it('preserves native Bluesky HLS video and dimensions instead of displaying a still image',()=>{
 const post=map(video);expect(post.imageUrls).toEqual([]);expect(post.externalVideo).toEqual({playlist:video.playlist,thumbnail:video.thumbnail,width:1080,height:1920,duration:0,alt:video.alt});
 expect(normalizeTimelineBlueskyPost(post).externalVideo).toEqual(post.externalVideo);
});
it('retains videos attached to quote posts',()=>{expect(map({$type:'app.bsky.embed.recordWithMedia#view',media:video}).externalVideo?.playlist).toBe(video.playlist);});
it('keeps the thumbnail fallback when there is no usable playlist',()=>{const post=map({...video,playlist:'javascript:alert(1)'});expect(post.externalVideo).toBeUndefined();expect(post.imageUrls).toEqual([video.thumbnail]);});
