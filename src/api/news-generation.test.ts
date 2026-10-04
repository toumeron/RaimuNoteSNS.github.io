import {expect, it} from 'vitest';
import {selectPopularPosts, validateSummary} from '../../supabase/functions/generate-news/sources';
import {latestNewsPerSource, type SearchNewsItem} from './search-news';
const now = Date.parse('2026-10-04T03:00:00Z');
const post = (i: number, likes = i) => ({uri: `at://did:plc:a/app.bsky.feed.post/${i}`, record: {text: `本文${i}`, createdAt: new Date(now - 1000).toISOString()}, likeCount: likes});
it('selects ten popular unique posts, excluding stale and restricted content', () => {
  const input = [...Array.from({length: 20}, (_, i) => post(i)), post(19), {...post(100,10000),labels:[{val:'!no-unauthenticated'}]}, {...post(101,10000),record:{text:'old',createdAt:'2020-01-01'}}, {...post(102,10000),author:{labels:[{val:'!hide'}]}}];
  const picked=selectPopularPosts(input,now);
  expect(picked).toHaveLength(10);
  expect(picked[0].id).toContain('/19');
  expect(picked.at(-1)?.id).toContain('/10');
});
it('weights repost popularity and does not use newest-only order', () => {
  expect(selectPopularPosts([post(1,100), {...post(2,10),repostCount:100}],now)[0].id).toContain('/2');
});
it('rejects invented references and invalid summaries', () => {
  const posts=[{id:'public',content:'本文'}];
  expect(validateSummary({title:'記事',content:'内容',related_post_ids:['private','public','public']},posts).related_post_ids).toEqual(['public']);
  expect(()=>validateSummary({title:'記事',content:'内容',related_post_ids:['private']},posts)).toThrow();
  expect(()=>validateSummary({},posts)).toThrow();
});
it('always displays the latest item from each source despite many newer LimeNote stories', () => {
  const item=(id:string,source:'limenote'|'bluesky',date:number):SearchNewsItem=>({id,source,created_at:new Date(date).toISOString(),title:'',content:'',category:''});
  expect(latestNewsPerSource([item('old-b','bluesky',1),item('old-l','limenote',2),item('l','limenote',5),item('b','bluesky',3)]) .map(n=>n.id)).toEqual(['l','b']);
});

it('limits the article material to one chosen topic, excluding other candidates', async()=>{
 const {selectNewsTopic,focusedNewsPrompt}=await import('../../supabase/functions/generate-news/sources');
 const candidates=[{id:'a',content:'新作映画Aの公開日'},{id:'b',content:'映画Aの予告公開'},{id:'c',content:'サッカー結果'}];
 const selection=selectNewsTopic({topic:'映画Aの予告公開',post_ids:['a','b','invented']},candidates);
 expect(selection.posts.map(p=>p.id)).toEqual(['a','b']);
 expect(focusedNewsPrompt(selection.topic,selection.posts)).not.toContain('サッカー結果');
 expect(()=>selectNewsTopic({topic:'映画A',post_ids:['invented']},candidates)).toThrow();
 expect(()=>validateSummary({title:'結果',content:'結果',related_post_ids:['c']},selection.posts)).toThrow();
});
