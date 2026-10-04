import {describe,it,expect} from 'vitest';
import {singlePreviewUrl} from './linkPreview';
import {metadata,publicAddress,publicUrl} from '../../supabase/functions/link-preview/metadata';
describe('URL preview eligibility',()=>{
 it('accepts exactly one ordinary URL and trims Japanese sentence punctuation',()=>{expect(singlePreviewUrl('日記 https://example.com/diary。')).toBe('https://example.com/diary');});
 it('suppresses two URLs, including duplicates',()=>{expect(singlePreviewUrl('https://example.com https://example.com')).toBeNull();});
 it('keeps existing dedicated embeds',()=>{for(const url of ['https://youtu.be/abcdefghijk','https://open.spotify.com/track/abc','https://example.com/image.png','https://toumeron.github.io/RaimuNoteSNS.github.io/spaces/abc'])expect(singlePreviewUrl(url)).toBeNull();});
});
describe('metadata parsing and public target validation',()=>{
 it('reads reversed attributes, entities, relative images and Twitter fallback',()=>{expect(metadata(`<meta content="日記 &amp; 写真" property="og:title"><meta property='og:image' content='/cover.jpg'>`,'https://example.com/diary')).toEqual({url:'https://example.com/diary',domain:'example.com',title:'日記 & 写真',image:'https://example.com/cover.jpg'});expect(metadata(`<meta name=twitter:title content='記事'><meta name=twitter:image content='https://example.com/photo.jpg'>`,'https://example.com')).not.toBeNull();});
 it('returns no card without genuine image and title metadata',()=>{for(const html of ['<title>普通のページ</title>','<meta property="og:title" content="タイトル">','<meta property="og:image" content="javascript:alert(1)"><meta property="og:title" content="記事">'])expect(metadata(html,'https://example.com')).toBeNull();});
 it('rejects local address ranges, credentials and non-web protocols',()=>{for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.2.1','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1'])expect(publicAddress(ip)).toBe(false);expect(publicAddress('1.1.1.1')).toBe(true);expect(publicAddress('2606:4700::1111')).toBe(true);for(const url of ['file:///tmp/a','http://localhost/a','https://user:pass@example.com','https://example.com:8080'])expect(()=>publicUrl(url)).toThrow();});
});

describe('Bluesky external metadata',()=>{
 it('keeps original external-card metadata for one URL',async()=>{
  const {mapBlueskyFeedItemToPost}=await import('./bluesky');
  const item={post:{uri:'at://did:plc:test/app.bsky.feed.post/one',author:{did:'did:plc:test',handle:'user.bsky.social'},record:{text:'日記 https://example.com/diary'},embed:{$type:'app.bsky.embed.external#view',external:{uri:'https://example.com/diary',title:'日記',thumb:'https://example.com/cover.jpg'}}}};
  expect(mapBlueskyFeedItemToPost(item)?.linkPreview?.title).toBe('日記');
  item.post.record.text+=' https://example.com/another';expect(mapBlueskyFeedItemToPost(item)?.linkPreview).toBeUndefined();
 });
});
