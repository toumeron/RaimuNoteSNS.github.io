import { expect, it, vi, describe } from "vitest";
import { canShowPostLinkPreview, quotePreviewText, QUOTE_TEXT_LIMIT } from "@/lib/postPresentation";
import { composerMediaDrop, isVideoAttachment } from "@/components/feed/ComposerIcon";
import { displayUsername } from "@/lib/format";
import { getClientName } from "@/lib/clientName";
import { QueryClient } from "@tanstack/react-query";
import { updateLikeCountCache } from "@/lib/likeCountCache";

describe("postPresentation", () => {
it('keeps link-only previews but suppresses attached images and either video format',()=>{
 const post={content:'本文 https://example.com',imageUrls:[]};
 expect(canShowPostLinkPreview(post)).toBe(true);
 for(const extra of [{imageUrls:['photo.jpg']},{video:{url:'video.mp4'}},{externalVideo:{url:'video.m3u8'}},{content:'https://example.com/photo.png'}])expect(canShowPostLinkPreview({...post,...extra})).toBe(false);
 expect(canShowPostLinkPreview(post,true)).toBe(false);
});
it('does not mistake an external link thumbnail for an attached photo',()=>{
 const thumbnail='https://example.com/cover.jpg';
 expect(canShowPostLinkPreview({content:'https://example.com',imageUrls:[thumbnail],linkPreview:{image:thumbnail}})).toBe(true);
 expect(canShowPostLinkPreview({imageUrls:[thumbnail,'https://example.com/attached.jpg'],linkPreview:{image:thumbnail}})).toBe(false);
});
it('bounds quoted text without splitting emoji and keeps short text unchanged',()=>{
 expect(quotePreviewText('短い本文')).toBe('短い本文');
 const text='🙂'.repeat(QUOTE_TEXT_LIMIT+1);const result=quotePreviewText(text);
 expect(Array.from(result)).toHaveLength(QUOTE_TEXT_LIMIT+1);expect(result.endsWith('…')).toBe(true);expect(result.includes('\uFFFD')).toBe(false);
});
});

describe("composerMediaDrop", () => {
it('recognizes video files supplied without MIME metadata',()=>{expect(isVideoAttachment(new File(['x'],'clip.MOV'))).toBe(true);expect(isVideoAttachment(new File(['x'],'clip.bin',{type:'video/mp4'}))).toBe(true);expect(isVideoAttachment(new File(['x'],'photo.png',{type:'image/png'}))).toBe(false);});
it('leaves text/link dragging alone and consumes file drops even when busy',()=>{const attach=vi.fn(),preventDefault=vi.fn(),stopPropagation=vi.fn();const event={preventDefault,stopPropagation,dataTransfer:{types:['text/plain'],items:[],files:[]}};composerMediaDrop(attach,false).onDragOver(event as any);expect(preventDefault).not.toHaveBeenCalled();composerMediaDrop(attach,true).onDrop({...event,dataTransfer:{files:[new File(['x'],'v.mp4')]}} as any);expect(preventDefault).toHaveBeenCalled();expect(attach).not.toHaveBeenCalled();});
});

describe("displayUsername", () => {
it('removes twitter suffixes from display without modifying the stored handle',()=>{
 const username='Google@Twitter.com';expect(displayUsername(username)).toBe('Google');expect(username).toBe('Google@Twitter.com');expect(displayUsername('Google@x.com')).toBe('Google');
});
it('preserves native, Bluesky, and Misskey handles',()=>{
 for(const value of ['local','artist.bsky.social','artist@misskey.io'])expect(displayUsername(value)).toBe(value);
});
});

describe("clientName", () => {
describe('posting client', () => {
  it.each([
    ['Mozilla iPhone OS 18 like Mac OS X', 5, 'iPhone'],
    ['Mozilla iPad CPU OS 18 like Mac OS X', 5, 'iPad'],
    ['Mozilla Macintosh Intel Mac OS X', 5, 'iPad'],
    ['Mozilla Macintosh Intel Mac OS X', 0, 'Mac'],
    ['Mozilla Linux Android 15', 5, 'Android'],
    ['Mozilla Windows NT 10.0', 0, 'Windows'],
    ['Mozilla X11 Linux x86_64', 0, 'Linux'],
    ['unknown', 0, 'Web'],
  ])('identifies %s without guessing the hardware model', (ua, touches, device) => {
    expect(getClientName(ua, touches)).toBe(`LimeNote for ${device}`);
  });
});
});

describe("likeCountCache", () => {
describe('like count cache synchronization', () => {
  it('updates latest, following, detail, profile arrays, wrapped likes and quotes without changing paging', () => {
    const client = new QueryClient();
    const post = { id: 'p', likesCount: 2 };
    const other = { id: 'other', likesCount: 9 };
    const feed = { pages: [[post, other, { id: 'quote', parentPost: post }]], pageParams: [4] };
    client.setQueryData(['feed', 'all'], feed);
    client.setQueryData(['feed', 'following'], feed);
    client.setQueryData(['post', 'p'], post);
    client.setQueryData(['feed', 'all', 'timeline', []], { pages: [{ posts: [post], next: { lime: { page: 1 } } }], pageParams: [{}] });
    client.setQueryData(['posts', 'user', 'author'], { pages: [[post]], pageParams: [0] });
    client.setQueryData(['posts', 'likes', 'author'], { pages: [[{ posts: post }]], pageParams: [0] });
    client.setQueryData(['posts', 'user', 'legacy'], [post]);
    client.setQueryData(['profile', 'author'], { id: 'p', displayName: 'Author' });
    updateLikeCountCache(client, 'post', 'p', 8);
    for (const key of [['feed', 'all'], ['feed', 'following']]) {
      expect(client.getQueryData(key)).toEqual({ pages: [[{ ...post, likesCount: 8, likes_count: 8 }, other,
        { id: 'quote', parentPost: { ...post, likesCount: 8, likes_count: 8 } }]], pageParams: [4] });
    }
    expect(client.getQueryData(['post', 'p'])).toMatchObject({ likesCount: 8 });
    expect(client.getQueryData(['feed', 'all', 'timeline', []])).toMatchObject({ pages: [{ posts: [{ likesCount: 8 }], next: { lime: { page: 1 } } }] });
    expect(client.getQueryData(['posts', 'user', 'author'])).toMatchObject({ pages: [[{ likesCount: 8 }]], pageParams: [0] });
    expect(client.getQueryData(['posts', 'likes', 'author'])).toMatchObject({ pages: [[{ posts: { likesCount: 8 } }]] });
    expect(client.getQueryData(['posts', 'user', 'legacy'])).toEqual([{ ...post, likesCount: 8, likes_count: 8 }]);
    expect(client.getQueryData(['profile', 'author'])).toEqual({ id: 'p', displayName: 'Author' });
  });
  it('isolates comment counts from post counts with the same ID', () => {
    const client = new QueryClient();
    client.setQueryData(['comments', 'post'], [{ id: 'same', likes_count: 2 }]);
    client.setQueryData(['post', 'same'], { id: 'same', likesCount: 10 });
    updateLikeCountCache(client, 'comment', 'same', 0);
    expect(client.getQueryData(['comments', 'post'])).toEqual([{ id: 'same', likes_count: 0, likesCount: 0 }]);
    expect(client.getQueryData(['post', 'same'])).toEqual({ id: 'same', likesCount: 10 });
  });
  it('keeps unrelated query references unchanged', () => {
    const client = new QueryClient();
    const key = ['feed', 'all'];
    client.setQueryData(key, { pages: [[{ id: 'other', likesCount: 2 }]], pageParams: [0] });
    const data = client.getQueryData(key);
    updateLikeCountCache(client, 'post', 'missing', 8);
    expect(client.getQueryData(key)).toBe(data);
  });
});
});
