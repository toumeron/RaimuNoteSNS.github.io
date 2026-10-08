import {beforeEach,expect,it} from 'vitest';
import {readSavedPreview,savePreview} from './linkPreviewCache';
const preview={url:'https://example.com/a',title:'保存した見出し',domain:'example.com',image:'https://example.com/cover.jpg'};
beforeEach(()=>localStorage.clear());
it('reuses saved positive metadata without expiring it',()=>{
 savePreview(preview.url,preview);
 expect(readSavedPreview(preview.url)?.preview).toEqual(preview);
 const saved=JSON.parse(localStorage.getItem('lime-link-previews-v1')!);saved[preview.url].savedAt=1;localStorage.setItem('lime-link-previews-v1',JSON.stringify(saved));
 expect(readSavedPreview(preview.url)?.preview).toEqual(preview);
});
it('recovers malformed storage and expires negative entries',()=>{
 for(const value of ['null','[]','bad']){localStorage.setItem('lime-link-previews-v1',value);expect(readSavedPreview(preview.url)).toBeUndefined();savePreview(preview.url,preview);expect(readSavedPreview(preview.url)?.preview).toEqual(preview);}
 localStorage.setItem('lime-link-previews-v1',JSON.stringify({[preview.url]:{preview:null,savedAt:1}}));expect(readSavedPreview(preview.url)).toBeUndefined();
});

it('re-fetches old incomplete Amazon cards while preserving existing complete previews',()=>{
 const url='https://amzn.asia/d/0h2mtcX5';localStorage.setItem('lime-link-previews-v1',JSON.stringify({[url]:{preview:{url,domain:'amazon.co.jp',title:'Amazon.co.jp',image:''},savedAt:Date.now(),version:3}}));expect(readSavedPreview(url)).toBeUndefined();
 savePreview(url,{url,domain:'amazon.co.jp',title:'商品名',image:'https://m.media-amazon.com/images/I/cover.jpg'});expect(readSavedPreview(url)?.preview?.title).toBe('商品名');
});
