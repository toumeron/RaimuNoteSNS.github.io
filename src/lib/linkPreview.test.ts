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
 it('uses page titles and descriptions even without an image',()=>{
  expect(metadata('<title>どれどれ</title>','https://george-doredore.jrkyushu.co.jp/ip/')).toMatchObject({title:'どれどれ',image:''});
  expect(metadata('<meta name="description" content="ページの説明">','https://example.com')).toMatchObject({title:'example.com',description:'ページの説明',image:''});
  expect(metadata('<meta property="og:title" content="記事"><meta property="og:image" content="javascript:alert(1)">','https://example.com')).toMatchObject({title:'記事',image:''});
  expect(metadata('<html><body>本文だけ</body></html>','https://example.com')).toBeNull();
 });
 it('rejects local address ranges, credentials and non-web protocols',()=>{for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.2.1','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1'])expect(publicAddress(ip)).toBe(false);expect(publicAddress('1.1.1.1')).toBe(true);expect(publicAddress('2606:4700::1111')).toBe(true);for(const url of ['file:///tmp/a','http://localhost/a','https://user:pass@example.com','https://example.com:8080'])expect(()=>publicUrl(url)).toThrow();});
});

describe('Bluesky external metadata',()=>{
 it('keeps original external-card metadata for one URL',async()=>{
  const {mapBlueskyFeedItemToPost}=await import('./bluesky');
  const item={post:{uri:'at://did:plc:test/app.bsky.feed.post/one',author:{did:'did:plc:test',handle:'user.bsky.social'},record:{text:'日記 https://example.com/diary'},embed:{$type:'app.bsky.embed.external#view',external:{uri:'https://example.com/diary',title:'日記',thumb:'https://example.com/cover.jpg'}}}};
  expect(mapBlueskyFeedItemToPost(item)?.linkPreview?.title).toBe('日記');
  delete (item.post.embed.external as {thumb?:string}).thumb;expect(mapBlueskyFeedItemToPost(item)?.linkPreview?.image).toBe('');
  item.post.record.text+=' https://example.com/another';expect(mapBlueskyFeedItemToPost(item)?.linkPreview).toBeUndefined();
 });
});

describe('product preview metadata',()=>{
 it('extracts real Amazon product title and high resolution image without OGP',()=>{
  const html='<title>Amazon.co.jp</title><span id="productTitle">なーんもうまくいかん！ １</span><img id="logo" src="/logo.png"><img src="https://m.media-amazon.com/images/I/cover-small.jpg" data-old-hires="https://m.media-amazon.com/images/I/cover-large.jpg" id="landingImage">';
  expect(metadata(html,'https://www.amazon.co.jp/dp/4832297554','https://amzn.asia/d/0h2mtcX5')).toMatchObject({url:'https://amzn.asia/d/0h2mtcX5',title:'なーんもうまくいかん！ １',image:'https://m.media-amazon.com/images/I/cover-large.jpg'});
  expect(metadata(html,'https://unrelated.example')).toMatchObject({image:''});
 });
 it('reads genuine structured product images and ignores malformed JSON and unrelated images',()=>{
  expect(metadata('<script type="application/ld+json">{"@graph":[{"@type":"Product","name":"商品名","image":{"url":"/product.jpg"},"description":"商品の説明"}]}</script>','https://shop.example')).toMatchObject({title:'商品名',image:'https://shop.example/product.jpg',description:'商品の説明'});
  expect(metadata('<title>記事</title><script type="application/ld+json">bad</script><img src="/ad.jpg">','https://shop.example')).toMatchObject({title:'記事',image:''});
 });
});
