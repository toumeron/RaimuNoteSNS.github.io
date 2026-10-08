import {expect,it} from 'vitest';
import {recommendationIsEligible} from './recommendationEligibility';
import type {PostWithAuthor} from '@/types';
const post=(extra:Partial<PostWithAuthor>={}):PostWithAuthor=>({id:'bsky:post',userId:'did:creator',source:'bluesky',content:'',imageUrls:['image'],author:{id:'did:creator',username:'artist.bsky.social',displayName:'Artist',bio:''},...extra} as PostWithAuthor);
it('excludes English posts for local topics even if returned by a Japanese feed',()=>{
 expect(recommendationIsEligible(post({content:'My cute cat today',languages:['en'],recommendationTopics:['pets'],recommendationLanguages:['ja']}),['pets'])).toBe(false);
});
it('requires actual global topic relevance, not merely following finance',()=>{
 expect(recommendationIsEligible(post({content:'Markets and stocks',languages:['en'],recommendationTopics:['economy']}),['economy'])).toBe(true);
 expect(recommendationIsEligible(post({content:'My cute cat',languages:['en'],recommendationTopics:['pets']}),['economy'])).toBe(false);
});
it('accepts Japanese and preserves image-only posts from Japanese creators and feeds',()=>{
 expect(recommendationIsEligible(post({languages:['ja']}),['pets'])).toBe(true);
 expect(recommendationIsEligible(post({author:{id:'creator',username:'creator',bio:'猫を描いています'}} as any),['pets'])).toBe(true);
 expect(recommendationIsEligible(post({recommendationLanguages:['ja']}),['art'])).toBe(true);
 expect(recommendationIsEligible(post(),['art'])).toBe(false);
});
it('digital illustration requires images and media/source context without requiring an initial model download and rejects declared AI',()=>{
 const character=post({recommendationVisual:{version:1,kind:'moe',topics:['digital-illustration'],confidence:.8,similarity:.3,vector:Array(512).fill(0)},recommendationTopics:['digital-illustration'],recommendationLanguages:['ja']});
 expect(recommendationIsEligible(character,['digital-illustration'])).toBe(true);
 expect(recommendationIsEligible({...character,imageUrls:[]},['digital-illustration'])).toBe(false);
 expect(recommendationIsEligible({...character,content:'#AIart'},['digital-illustration','ai'])).toBe(false);
 expect(recommendationIsEligible(post({content:'猫の写真',recommendationTopics:['art'],languages:['ja']}),['digital-illustration'])).toBe(false);
 expect(recommendationIsEligible(post({content:'ファンアート',languages:['ja']}),['digital-illustration'])).toBe(false);
});

it('Japanese hashtags do not disguise an otherwise English post',()=>{expect(recommendationIsEligible(post({content:'Here is my beautiful illustration of an anime character #猫 #イラスト',languages:['en'],recommendationLanguages:['ja']}),['art'])).toBe(false);});
