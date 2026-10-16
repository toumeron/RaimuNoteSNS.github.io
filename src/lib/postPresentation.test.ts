import {expect,it} from 'vitest';
import {canShowPostLinkPreview,quotePreviewText,QUOTE_TEXT_LIMIT} from './postPresentation';
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
