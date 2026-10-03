import { beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({likedId:'',limeFail:false,blueFail:false,preferencesFail:false,limeSize:2,limeCalls:0,authorCalls:[] as string[],topicCalls:[] as string[],searchCalls:[] as string[],targeted:false}));
vi.mock('@/lib/supabase',()=>({supabase:{from:(table:string)=>{const b={select:()=>b,eq:()=>b,order:()=>b,limit:()=>b,then:(resolve:any)=>Promise.resolve({data:table==='likes'?[{posts:{id:fixture.likedId,user_id:'cat-author',content:'猫の写真'}}]:[],error:fixture.preferencesFail?new Error('prefs unavailable'):null}).then(resolve)};return b;}}}));
const source=(id:string,content:string)=>({id,userId:id,content,createdAt:'2026-10-03T00:00:00Z',likesCount:1,commentsCount:0,likedByMe:false,repostsCount:0,repostedByMe:false,imageUrls:[],author:{id,username:id}});
vi.mock('./posts',()=>({searchPosts:async(query:string)=>{fixture.searchCalls.push(query);return fixture.targeted?[source('targeted-lime','猫の写真')]:[];},getPostsByUser:async()=>[],getFeed:async()=>{fixture.limeCalls++;if(fixture.limeFail)throw new Error('lime failed');return fixture.limeSize>2?Array.from({length:fixture.limeSize},(_,i)=>source(`lime-${i}`,'猫の写真')):[source('lime-cat','猫の写真'),source('lime-sports','サッカー速報')];}}));
vi.mock('@/lib/bluesky',()=>({fetchBlueskyAuthorFeed:async({actor}:any)=>{fixture.authorCalls.push(actor);return {posts:[],cursor:null};},fetchBlueskyTopicPosts:async({query}:any)=>{fixture.topicCalls.push(query);return {posts:fixture.targeted?[source('bsky:targeted','猫の写真')]:[],cursor:null};},fetchTrendingJapaneseBlueskyPosts:async()=>{if(fixture.blueFail)throw new Error('blue failed');return {posts:[source('bsky:cat','猫の写真')],cursor:null};}}));
import { createRecommendationCursor,getRecommendationPage } from './recommendations';
beforeEach(()=>{fixture.likedId='';fixture.limeFail=false;fixture.blueFail=false;fixture.preferencesFail=false;fixture.limeSize=2;fixture.limeCalls=0;fixture.authorCalls=[];fixture.topicCalls=[];fixture.searchCalls=[];fixture.targeted=false;localStorage.clear();});
it('mixes Lime and Bluesky posts ranked from the viewer actual likes',async()=>{
  const page=await getRecommendationPage(createRecommendationCursor([]),'viewer');
  expect(page.posts.map(p=>p.id)).toContain('bsky:cat');
  expect(page.posts[0].content).toContain('猫');
  expect(page.next).toBeUndefined();
});
it('keeps the other service visible when one source fails',async()=>{
  fixture.blueFail=true;
  const page=await getRecommendationPage(createRecommendationCursor([]),'viewer');
  expect(page.posts.map(p=>p.id)).toEqual(['lime-cat','lime-sports']);
  expect(page.next?.trending.done).toBe(false);
});
it('falls back to discovery when preference enrichment fails',async()=>{
  fixture.preferencesFail=true;
  expect((await getRecommendationPage(createRecommendationCursor([]),'viewer')).posts).toHaveLength(3);
});
it('reports an error when every source fails instead of claiming an empty feed',async()=>{
  fixture.limeFail=true;fixture.blueFail=true;
  await expect(getRecommendationPage(createRecommendationCursor([]),'viewer')).rejects.toThrow();
});
it('does not mutate a cursor or show posts already emitted',async()=>{
  const cursor=createRecommendationCursor([]);cursor.seen=['lime-cat'];
  const page=await getRecommendationPage(cursor,'viewer');
  expect(page.posts.map(p=>p.id)).not.toContain('lime-cat');
  expect(cursor.lime.page).toBe(0);expect(cursor.seen).toEqual(['lime-cat']);
});

it('pages through ranked leftovers without re-fetching sources or repeating posts',async()=>{
  fixture.limeSize=60;
  const first=await getRecommendationPage(createRecommendationCursor([]),'viewer');
  const second=await getRecommendationPage(first.next!,'viewer');
  expect(first.posts).toHaveLength(20);expect(second.posts).toHaveLength(20);
  expect(new Set([...first.posts,...second.posts].map(p=>p.id)).size).toBe(40);
  expect(fixture.limeCalls).toBe(1);
});
it('adds recently liked Bluesky authors as candidate sources',async()=>{
  localStorage.setItem('lime_recommendation_likes:viewer',JSON.stringify([{id:'bsky:liked',userId:'did:plc:favorite',content:'猫の写真'}]));
  await getRecommendationPage(createRecommendationCursor([]),'viewer');
  expect(fixture.authorCalls).toContain('did:plc:favorite');
});

it('retrieves relevant candidates from both topic searches beyond the general feed',async()=>{
  fixture.targeted=true;
  const page=await getRecommendationPage(createRecommendationCursor([]),'viewer');
  expect(fixture.searchCalls).toContain('猫');expect(fixture.topicCalls).toContain('猫');
  expect(page.posts.map(p=>p.id)).toContain('targeted-lime');
  expect(page.posts.map(p=>p.id)).toContain('bsky:targeted');
});
it('carries diversity history into the next ranked page without mutating previous history',async()=>{
  fixture.limeSize=60;
  const first=await getRecommendationPage(createRecommendationCursor([]),'viewer');
  const before=first.next!.history.map(p=>p.id);
  const second=await getRecommendationPage(first.next!,'viewer');
  expect(first.next!.history.map(p=>p.id)).toEqual(before);
  expect(second.next?.history.map(p=>p.id)).toEqual(second.posts.slice(-6).map(p=>p.id));
});

it('excludes server-side liked posts while still learning their topics for fresh candidates',async()=>{
  fixture.likedId='lime-cat';
  const page=await getRecommendationPage(createRecommendationCursor([]),'viewer');
  expect(page.posts.map(post=>post.id)).not.toContain('lime-cat');
  expect(page.posts.map(post=>post.id)).toContain('bsky:cat');
  expect(fixture.searchCalls).toContain('猫');
});
