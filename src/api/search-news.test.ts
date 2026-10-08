import { beforeEach, expect, it, vi } from 'vitest';
const lookup = vi.hoisted(() => vi.fn());
vi.mock('./posts', () => ({getPostById: lookup}));
import { getNewsSources, latestNewsPerSource, type SearchNewsItem } from './search-news';
import {selectPopularPosts,validateSummary,selectNewsTopic} from '../../supabase/functions/generate-news/sources';
const news = (id: string, refs: unknown): SearchNewsItem => ({id, title: 'ニュース', content: '', category: 'ニュース', created_at: '', related_post_ids: refs});
beforeEach(() => {lookup.mockReset();});
it('uses quoted originals, deduplicates requests and authors, and counts visible posts', async () => {
  const a = {id: 'a', displayName: 'A'}, b = {id: 'b', displayName: 'B'};
  lookup.mockImplementation(async id => ({author: id === 'second' ? b : a}));
  const result = await getNewsSources([news('one', ['first', 'second', 'first']), news('two', ['first', 'third'])]);
  expect(lookup).toHaveBeenCalledTimes(3);
  expect(result.one).toEqual({authors: [a, b], postsCount: 2});
  expect(result.two).toEqual({authors: [a], postsCount: 2});
});
it('excludes inaccessible and failed originals instead of using saved snapshot avatars', async () => {
  lookup.mockImplementation(async id => {if (id === 'failed') throw new Error('unavailable'); return id === 'private' ? null : {author: {id: 'visible'}};});
  const item = {...news('one', ['private', 'failed', 'public']), related_posts: [{id: 'private', author: {id: 'private-author', avatarUrl: 'private-avatar'}}]};
  expect(await getNewsSources([item])).toEqual({one: {authors: [{id: 'visible'}], postsCount: 1}});
});
it('accepts source object arrays and missing references without inventing avatars', async () => {
  lookup.mockResolvedValue({author: {id: 'a'}});
  expect(await getNewsSources([{...news('one', null), related_posts: [{id: 'first'}, null, {}, 4]}, news('two', undefined)])).toEqual({one: {authors: [{id: 'a'}], postsCount: 1}, two: {authors: [], postsCount: 0}});
});

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

it('never fills a missing source slot with a second article from the other source',()=>{
 const item=(id:string,date:number):SearchNewsItem=>({id,source:'bluesky',created_at:new Date(date).toISOString(),title:id,content:'',category:''});
 expect(latestNewsPerSource([item('older',1),item('latest',3),item('next',2)]).map(item=>item.id)).toEqual(['latest']);
 expect(latestNewsPerSource([item('older',1),item('latest',3)].map(item=>({...item,source:'limenote' as const}))).map(item=>item.id)).toEqual(['latest']);
 expect(latestNewsPerSource([])).toEqual([]);
});

it('retains ten relevant sources from a broader pool instead of truncating citations to five',()=>{
 const candidates=Array.from({length:200},(_,i)=>({id:String(i),content:i<10?'映画の公開発表':'別の話題'}));
 const picked=selectNewsTopic({topic:'映画の公開発表',post_ids:candidates.slice(0,10).map(p=>p.id)},candidates,5);
 expect(picked.posts).toHaveLength(10);
 expect(()=>selectNewsTopic({topic:'映画',post_ids:['0','1','invented']},candidates,5)).toThrow('too few');
 const article={title:'映画の公開日が決定',content:'制作会社は映画の公開日を発表しました。',related_post_ids:picked.posts.map(p=>p.id)};
 expect(validateSummary(article,picked.posts,5).related_post_ids).toHaveLength(10);
 expect(()=>validateSummary({...article,related_post_ids:['0','0','1','invented']},picked.posts,5)).toThrow('too few');
 expect(()=>validateSummary({...article,content:'投稿の傾向を分析しました。'},picked.posts,5)).toThrow('post analysis');
});

it('collects a broad popular candidate pool without allowing stale or restricted sources',()=>{
 const input=Array.from({length:240},(_,i)=>post(i+1));
 input.push({...post(999,10000),labels:[{val:'!hide'}]} as typeof input[number]);
 expect(selectPopularPosts(input,now,200)).toHaveLength(200);
 expect(selectPopularPosts(input,now,200)[0].id).toContain('/240');
 expect(selectPopularPosts(input,now)).toHaveLength(10);
});
