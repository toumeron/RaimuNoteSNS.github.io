import {describe,it,expect} from 'vitest';
import {TOPICS,matchingTopics,topicAffinity} from './topics';
import {rankRecommendations,recommendationQueries,type RecommendationPreferences} from './recommendations';
import {rankPersonalTrends} from './search-trends';
import type {PostWithAuthor} from '@/types';
const post=(id:string,content:string,source:'bluesky'|'misskey'):PostWithAuthor=>({id,userId:id,source,content,createdAt:new Date().toISOString(),imageUrls:[],likesCount:1,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,author:{id,username:id}} as PostWithAuthor);
describe('explicit topic preferences',()=>{
 it('contains exactly the requested topics with unique IDs',()=>{expect(TOPICS).toHaveLength(22);expect(new Set(TOPICS.map(t=>t.id)).size).toBe(22);});
 it('matches Japanese and English content without matching AI inside an unrelated word or URL',()=>{
  expect(matchingTopics('猫と犬の写真')).toContain('pets');expect(matchingTopics('AI research')).toContain('ai');
  expect(matchingTopics('daily email https://example.org/AI')).not.toContain('ai');
 });
 it('uses explicit interests for discovery even without likes and never searches dismissed learned interests',()=>{
  const prefs:RecommendationPreferences={authors:{},terms:{猫:100,音楽:2},followedTopics:['games'],dismissedTopics:['pets']};
  expect(recommendationQueries(prefs)).toContain('ゲーム');expect(recommendationQueries(prefs)).not.toContain('猫');
 });
 it('promotes both external providers for a followed topic and excludes unrelated dismissed interests',()=>{
  const prefs:RecommendationPreferences={authors:{},terms:{},followedTopics:['pets'],dismissedTopics:['sports']};
  const ranked=rankRecommendations([post('sports','サッカーの試合','bluesky'),post('blue-cat','猫の写真','bluesky'),post('misskey-cat','犬の写真','misskey')],prefs,null);
  expect(ranked.slice(0,2).map(p=>p.id)).toEqual(expect.arrayContaining(['blue-cat','misskey-cat']));
  expect(ranked.map(post=>post.id)).not.toContain('sports');expect(topicAffinity('サッカー速報',{dismissed:['sports']})).toBeLessThan(0);
 });
 it('personalizes explore trends but preserves the source volume and rank metadata',()=>{
  const rows=[{title:'選挙',traffic:'100万',rank:1},{title:'猫の写真',traffic:'100',rank:2}];
  const ranked=rankPersonalTrends(rows,{authors:{},terms:{},followedTopics:['pets']});
  expect(ranked[0]).toEqual(rows[1]);expect(rows[0].rank).toBe(1);
 });
});
