import { beforeEach, expect, it } from 'vitest';
import { addRecommendationInterest, rankRecommendations, recommendationTerms, recordRecommendationLike, readRecommendationLikes, recordRecommendationImpression, readRecommendationImpressions, scoreRecommendation } from './recommendations';
import type { PostWithAuthor } from '@/types';
const post=(id:string,content:string,userId='author'):PostWithAuthor=>({id,content,userId,createdAt:'2026-10-03T00:00:00Z',likesCount:1,commentsCount:0,repostsCount:0,repostedByMe:false,likedByMe:false,imageUrls:[],author:{id:userId,username:userId} as any});
beforeEach(()=>localStorage.clear());
it('prioritizes subjects learned from engagement over unrelated popular posts',()=>{
  const preferences={authors:{},terms:{}};
  addRecommendationInterest(preferences,post('liked','猫の写真とイラスト'),2);
  const ranked=rankRecommendations([{...post('sports','サッカー速報'),likesCount:50000},post('cats','猫の写真')],preferences,'viewer');
  expect(ranked[0].id).toBe('cats');
});
it('responds to different user preferences and followed authors',()=>{
  const posts=[post('cats','猫の写真','cats-author'),post('sports','サッカー速報','sports-author')];
  expect(rankRecommendations(posts,{authors:{'sports-author':3},terms:{}},'viewer')[0].id).toBe('sports');
  expect(rankRecommendations(posts,{authors:{},terms:{写真:3}},'viewer')[0].id).toBe('cats');
});
it('deduplicates posts and avoids runs of one service or author when alternatives exist',()=>{
  const posts=[post('l1','猫'),post('l2','猫'),post('l3','猫'),post('bsky:1','猫','b1'),post('bsky:2','猫','b2'),post('bsky:3','猫','b3')];
  const ranked=rankRecommendations([...posts,posts[0]],{authors:{author:5},terms:{}},'viewer');
  expect(ranked).toHaveLength(6);
  expect(ranked.slice(0,3).some(p=>p.id.startsWith('bsky:'))).toBe(true);
});
it('uses meaningful Japanese terms without treating shared URL domains as interests',()=>{
  expect(recommendationTerms('猫の写真 https://example.com/sports です')).toContain('写真');
  expect(recommendationTerms('猫の写真 https://example.com/sports です')).not.toContain('sports');
});
it('isolates local Bluesky likes by viewer and removes unliked signals',()=>{
  recordRecommendationLike(post('bsky:cat','猫の写真'),true,'alice');
  expect(readRecommendationLikes('alice')).toHaveLength(1);
  expect(readRecommendationLikes('bob')).toEqual([]);
  recordRecommendationLike(post('bsky:cat','猫の写真'),false,'alice');
  expect(readRecommendationLikes('alice')).toEqual([]);
});

it('weights recent behavior separately from old interests and adapts to a new subject',()=>{
  const now=Date.parse('2026-10-03T00:00:00Z');
  const preferences={authors:{},terms:{}};
  addRecommendationInterest(preferences,post('old','サッカー速報','sports'),10,'2026-07-01T00:00:00Z',now);
  addRecommendationInterest(preferences,post('new','猫の写真','cats'),2,'2026-10-02T00:00:00Z',now);
  expect(rankRecommendations([post('sports','サッカー速報','other-sport'),post('cats','猫の写真','other-cat')],preferences,'viewer',now)[0].id).toBe('cats');
});
it('recognizes a small set of equivalent topic expressions across Japanese and English',()=>{
  const preferences={authors:{},terms:{}};
  addRecommendationInterest(preferences,post('liked','猫'),2);
  expect(rankRecommendations([post('cats','cute kitten'),post('sport','soccer')],preferences,'viewer')[0].id).toBe('cats');
});
it('does not boost a post just for repeating preferred words or adding many hashtags',()=>{
  const preferences={authors:{},terms:{}};
  addRecommendationInterest(preferences,post('liked','猫'),2);
  expect(rankRecommendations([post('stuffed','猫 #猫 #猫 #猫 #猫 #猫 #猫 #猫 #猫 #猫 #猫 #猫'),post('natural','猫')],preferences,'viewer')[0].id).toBe('natural');
});
it('allows an excellent relevant post even when it comes from the same service twice',()=>{
  const preferences={authors:{},terms:{}};
  addRecommendationInterest(preferences,post('liked','猫'),2);
  const ranked=rankRecommendations([post('c1','猫','a'),post('c2','猫','b'),post('c3','猫','c'),post('bsky:sport','サッカー速報','sport')],preferences,'viewer');
  expect(ranked.slice(0,3).map(p=>p.id)).toEqual(['c1','c2','c3']);
});
it('suppresses exact repeated text but retains different media with the same caption',()=>{
  const content='同じ内容の長い文章です。この本文は同じ投稿が何回も表示されないかのテストです。';
  const ranked=rankRecommendations([post('one',content),post('duplicate',content),{...post('photo',content),imageUrls:['different.png']}],{authors:{},terms:{}},'viewer');
  expect(ranked).toHaveLength(2);
});
it('balances authors across page boundaries',()=>{
  const preferences={authors:{author:3},terms:{}};
  const history=[post('h1','猫'),post('h2','猫')];
  expect(rankRecommendations([post('same','猫'),post('new','猫','new-author')],preferences,'viewer',Date.now(),history)[0].id).toBe('new');
});

it('reduces recently seen posts, with a penalty that fades over time and stays viewer-specific',()=>{
  const now=Date.parse('2026-10-03T00:00:00Z');
  recordRecommendationImpression('seen','viewer',now);
  const preferences={authors:{},terms:{}};
  expect(rankRecommendations([post('seen','猫'),post('new','猫')],preferences,'viewer',now)[0].id).toBe('new');
  expect(readRecommendationImpressions('other',now)).toEqual({});
  const recent=scoreRecommendation(post('seen','猫'),preferences,'viewer',{now,impressions:readRecommendationImpressions('viewer',now)});
  const later=scoreRecommendation(post('seen','猫'),preferences,'viewer',{now:now+6*86400000,impressions:readRecommendationImpressions('viewer',now+6*86400000)});
  expect(later.seenPenalty).toBeLessThan(recent.seenPenalty);
});
it('returns inspectable component scores without NaN from incomplete stats',()=>{
  const score=scoreRecommendation({...post('one','猫'),createdAt:'invalid',likesCount:undefined as any},{authors:{},terms:{}},'viewer');
  expect(Number.isFinite(score.total)).toBe(true);
  expect(score).toHaveProperty('recentInterest');expect(score).toHaveProperty('seenPenalty');
});

it('allows up to three actual views and excludes the post after the third across visits',()=>{
  const now=Date.now();const candidate=post('repeat','猫の写真');const preferences={authors:{},terms:{猫:2}};
  recordRecommendationImpression('repeat','viewer',now);
  expect(rankRecommendations([candidate],preferences,'viewer',now)).toHaveLength(1);
  recordRecommendationImpression('repeat','viewer',now);
  expect(rankRecommendations([candidate],preferences,'viewer',now)).toHaveLength(1);
  recordRecommendationImpression('repeat','viewer',now);
  expect(rankRecommendations([candidate],preferences,'viewer',now)).toHaveLength(0);
  expect(rankRecommendations([candidate],preferences,'other-viewer',now)).toHaveLength(1);
});
it('excludes liked candidates from server flags, stored preference IDs, and new successful likes',()=>{
  const candidates=[{...post('flagged','猫'),likedByMe:true},post('saved','猫'),post('bsky:new','猫'),post('fresh','猫')];
  const preferences={authors:{},terms:{猫:5},likedPostIds:['saved']};
  recordRecommendationLike(candidates[2],true,'viewer');
  expect(rankRecommendations(candidates,preferences,'viewer').map(p=>p.id)).toEqual(['fresh']);
  recordRecommendationLike(candidates[2],false,'viewer');
  expect(rankRecommendations(candidates,preferences,'viewer').map(p=>p.id)).toContain('bsky:new');
});

it('remembers liked IDs beyond the 100-post interest sample and permits confirmed unlikes',()=>{
  recordRecommendationLike(post('bsky:older-like','猫'),true,'viewer');
  for(let i=0;i<101;i++) recordRecommendationLike(post(`bsky:new-${i}`,'猫'),true,'viewer');
  expect(readRecommendationLikes('viewer').some(p=>p.id==='bsky:older-like')).toBe(false);
  expect(rankRecommendations([post('bsky:older-like','猫')],{authors:{},terms:{}},'viewer')).toHaveLength(0);
  recordRecommendationLike(post('bsky:older-like','猫'),false,'viewer');
  expect(rankRecommendations([post('bsky:older-like','猫')],{authors:{},terms:{}},'viewer')).toHaveLength(1);
});
