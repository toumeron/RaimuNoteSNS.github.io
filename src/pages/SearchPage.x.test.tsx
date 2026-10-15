import {expect,it} from 'vitest';
import {parseSearchQuery,postMatchesSearch} from './SearchPage';
import type {PostWithAuthor} from '@/types';
const post={id:'x:20',source:'x',content:'アニメ',imageUrls:[],externalVideo:{playlist:'https://video.twimg.com/playlist.m3u8',duration:16,width:1920,height:1080},createdAt:'2026-10-15',likesCount:3,repostsCount:0,author:{username:'artist@x.com'}} as PostWithAuthor;
it('supports selecting X as a search source',()=>{expect(parseSearchQuery('アニメ source:x').source).toBe('x');expect(parseSearchQuery('アニメ source:twitter').source).toBe('x');});
it('includes native X videos in the media and video filters',()=>{expect(postMatchesSearch(post,parseSearchQuery('アニメ filter:videos'))).toBe(true);expect(postMatchesSearch(post,parseSearchQuery('アニメ filter:images'))).toBe(false);});
it('matches X author handles with or without the provider suffix',()=>{expect(postMatchesSearch(post,parseSearchQuery('from:artist'))).toBe(true);expect(postMatchesSearch(post,parseSearchQuery('from:artist@x.com'))).toBe(true);expect(postMatchesSearch(post,parseSearchQuery('-from:artist'))).toBe(false);});
it('passes author-only and advanced conditions to twitter without losing operators',async()=>{
 const {twitterSearchQuery}=await import('@/lib/twitterSearch');expect(twitterSearchQuery(parseSearchQuery('from:artist source:twitter'))).toBe('(from:artist)');
 const q=twitterSearchQuery(parseSearchQuery('アニメ from:artist@twitter.com to:friend since:2026-10-01 filter:videos min_likes:5 -広告 source:twitter'));
 expect(q).toContain('from:artist');expect(q).toContain('to:friend');expect(q).toContain('since:2026-10-01');expect(q).toContain('filter:videos');expect(q).toContain('min_faves:5');expect(q).not.toContain('source:');
});
