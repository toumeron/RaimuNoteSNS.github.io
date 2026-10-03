import { afterEach, expect, it, vi } from 'vitest';
import { fetchBlueskyTopicPosts } from './bluesky';
afterEach(()=>vi.unstubAllGlobals());
it('searches personalized topics without discarding low-like posts and passes cursor and cancellation',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({posts:[{uri:'at://did:plc:cat/app.bsky.feed.post/new',cid:'cid',author:{did:'did:plc:cat',handle:'cat.bsky.social',displayName:'Cat'},record:{$type:'app.bsky.feed.post',text:'猫の写真',createdAt:new Date().toISOString()},likeCount:0}],cursor:'next'}),{status:200}));
  vi.stubGlobal('fetch',fetcher);
  const signal=new AbortController().signal;
  const page=await fetchBlueskyTopicPosts({query:'猫',cursor:'previous',signal});
  const url=new URL(fetcher.mock.calls[0][0]);
  expect(url.searchParams.get('q')).toBe('猫');expect(url.searchParams.get('sort')).toBe('latest');expect(url.searchParams.get('cursor')).toBe('previous');
  expect(fetcher.mock.calls[0][1].signal).toBe(signal);
  expect(page.posts).toHaveLength(1);expect(page.posts[0].likesCount).toBe(0);expect(page.cursor).toBe('next');
});
it('falls back to the second public search host when the first refuses the request',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('',{status:403})).mockResolvedValueOnce(new Response('{"posts":[]}',{status:200}));
  vi.stubGlobal('fetch',fetcher);
  expect((await fetchBlueskyTopicPosts({query:'猫'})).posts).toEqual([]);
  expect(fetcher.mock.calls[1][0]).toContain('api.bsky.app');
});
