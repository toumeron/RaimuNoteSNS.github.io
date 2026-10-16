import {expect,it} from 'vitest';
import {createRecommendationCursor} from '@/api/recommendations';
import {preserveRecommendationHistory,uniqueRecommendationPosts} from './recommendationPaging';
import type {PostWithAuthor} from '@/types';
const work=(id:string,url='https://images.example/work.jpg'):PostWithAuthor=>({id,userId:'creator',content:'作品',imageUrls:[url],createdAt:'2026-10-13',likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,author:{id:'creator',username:'creator',displayName:'Creator',bio:'',avatarUrl:'',coverUrl:'',createdAt:'2026-10-13'}});
it('keeps visible work identities and media fingerprints when creator discovery restarts',()=>{
 const shown=work('bsky:original');const cursor=preserveRecommendationHistory(createRecommendationCursor([]),[shown]);
 expect(cursor.seen).toContain(shown.id);expect(cursor.history).toEqual([shown]);
 expect(uniqueRecommendationPosts([work('bsky:copy','https://images.example/work.jpg?w=900'),work('new','https://images.example/new.jpg')],[shown]).map(post=>post.id)).toEqual(['new']);
});
it('reconciles provider totals and recent creators with cards still visible after image filtering',()=>{
 const cursor={...createRecommendationCursor([]),providerTotals:{twitter:4,other:4},history:[work('x:removed')]};
 const shown=[work('x:kept'),work('bsky:kept','https://images.example/other.jpg')];
 const next=preserveRecommendationHistory(cursor,shown);
 expect(next.providerTotals).toEqual({twitter:1,other:1});expect(next.history).toEqual(shown);
});
it('does not forget a consumed creator budget when image filtering removes their cards',()=>{
 const cursor={...createRecommendationCursor([]),twitterAuthorCounts:{'x-user:artist':3},twitterAuthorHandles:{'x-user:artist':'artist@twitter.com'}};
 const next=preserveRecommendationHistory(cursor,[work('bsky:kept')]);
 expect(next.twitterAuthorCounts?.['x-user:artist']).toBe(3);
 expect(next.twitterAuthorHandles?.['x-user:artist']).toBe('artist@twitter.com');
});
