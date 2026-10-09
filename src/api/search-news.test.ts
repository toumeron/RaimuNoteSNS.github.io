import { beforeEach, expect, it, vi } from 'vitest';
const lookup = vi.hoisted(() => vi.fn());
const summaries=vi.hoisted(()=>({rows:[] as any[]}));
vi.mock('@/lib/supabase',()=>({supabase:{from:()=>{const q:any={select:()=>q,eq:()=>q,order:()=>q,limit:async()=>({data:summaries.rows,error:null})};return q;}}}));
vi.mock('./posts', () => ({getPostById: lookup}));
import { getNewsRelatedPosts, getNewsSources, latestNewsPerSource, type SearchNewsItem } from './search-news';
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

it('excludes year-old, future, missing-date and invalid-date source posts on either side of the five-day boundary',async()=>{
 const {selectRecentNewsPosts,NEWS_POST_MAX_AGE_MS}=await import('../../supabase/functions/generate-news/sources');
 const dated=(id:string,at?:number)=>({id,content:'発表',createdAt:at===undefined?undefined:new Date(at).toISOString()});
 expect(selectRecentNewsPosts([dated('recent',now-1000),dated('boundary',now-NEWS_POST_MAX_AGE_MS),dated('too-old',now-NEWS_POST_MAX_AGE_MS-1),dated('last-year',now-365*86400000),dated('future',now+1),dated('missing'),{id:'invalid',content:'発表',createdAt:'invalid'}, {...dated('empty',now),content:' '}],now).map(post=>post.id)).toEqual(['recent','boundary']);
});
it.each([{},{query:'新作_100%'}, {ids:['recent','old']}])('bounds LimeNote discovery, supplemental search and final publication checks to recent public posts: %j',async options=>{
 const {loadRecentLimeNewsPosts,recentNewsWindow}=await import('../../supabase/functions/generate-news/sources');
 const calls:any[]=[];
 const query:any={then:(resolve:any)=>Promise.resolve({data:[{id:'recent',content:'新作発表',created_at:new Date(now-1000).toISOString()},{id:'old',content:'昨年発表',created_at:new Date(now-365*86400000).toISOString()}],error:null}).then(resolve)};
 for(const method of ['select','eq','gte','lte','ilike','in','order','limit'])query[method]=(...args:any[])=>{calls.push([method,...args]);return query;};
 const posts=await loadRecentLimeNewsPosts({from:()=>query},{...options,now});
 expect(posts.map(post=>post.id)).toEqual(['recent']);
 expect(calls).toContainEqual(['eq','visibility','public']);
 expect(calls).toContainEqual(['eq','profiles.is_private',false]);
 expect(calls).toContainEqual(['select','id,content,created_at,profiles!inner(is_private)']);
 expect(calls).toContainEqual(['gte','created_at',recentNewsWindow(now).since]);
 expect(calls).toContainEqual(['lte','created_at',recentNewsWindow(now).until]);
 if('query' in options)expect(calls).toContainEqual(['ilike','content','%新作\\_100\\%%']);
 if('ids' in options)expect(calls).toContainEqual(['in','id',options.ids]);
});

it('does not publish article rows until source metadata has finished loading',async()=>{
 const {getLatestSearchNews}=await import('./search-news');
 summaries.rows=[news('article',['public'])];
 let release!:(post:any)=>void;
 lookup.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
 let settled=false;
 const pending=getLatestSearchNews().then(data=>{settled=true;return data;});
 await vi.waitFor(()=>expect(lookup).toHaveBeenCalled());expect(settled).toBe(false);
 release({author:{id:'author',displayName:'作者',avatarUrl:'avatar.jpg'}});
 expect((await pending).sources.article.authors[0].avatarUrl).toBe('avatar.jpg');
});

it('attempts scheduled news every five hours even when the previous generation failed',async()=>{
 const {newsRefreshIsDue,NEWS_REFRESH_INTERVAL_MS}=await import('../../supabase/functions/generate-news/sources');
 expect(newsRefreshIsDue(null,now)).toBe(true);
 expect(newsRefreshIsDue({last_completed_at:new Date(now-86400000).toISOString(),last_attempted_at:new Date(now-1000).toISOString()},now)).toBe(false);
 expect(newsRefreshIsDue({last_attempted_at:new Date(now-NEWS_REFRESH_INTERVAL_MS).toISOString()},now)).toBe(true);
 expect(newsRefreshIsDue({last_completed_at:new Date(now-1000).toISOString(),last_attempted_at:new Date(now-86400000).toISOString()},now)).toBe(false);
});

it('news detail hydrates all unique original references and excludes inaccessible snapshots', async () => {
  lookup.mockImplementation(async id => id === 'deleted' ? Promise.reject(new Error('deleted')) : id === 'private' ? null : {id, author:{id:'current-author'}});
  const result = await getNewsRelatedPosts({...news('story', ['a','a','private']), source_post_ids:['b'], related_posts:[{id:'deleted',author:{id:'stale'}},{id:'a'}]});
  expect(result.map(p=>p.id).sort()).toEqual(['a','b']);
  expect(lookup).toHaveBeenCalledTimes(4);
});
