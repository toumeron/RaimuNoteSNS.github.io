import {recordRecommendationLike as recordCloudLikeTest} from '@/lib/recommendations';
import { beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({cloudLikes:[] as any[],feedback:[] as any[],likedId:'',limeFail:false,blueFail:false,preferencesFail:false,limeSize:2,limeCalls:0,authorCalls:[] as string[],topicCalls:[] as string[],searchCalls:[] as string[],targeted:false,followedTopics:[] as string[],dismissedTopics:[] as string[],discoveryTopics:[] as string[],topicFeedRows:{} as Record<string,any[]>,authorRows:{} as Record<string,any[]>,misskeyRows:[] as any[],feedFail:false,slowTrending:false,slowFeed:false,slowHistory:false,slowTopics:false}));
vi.mock('@/lib/misskey',()=>({fetchMisskeyTopicPosts:async()=>({posts:fixture.misskeyRows.length?fixture.misskeyRows:fixture.targeted?[source('misskey:targeted','猫の写真')]:[],cursor:null})}));
vi.mock('@/lib/supabase',()=>({supabase:{from:(table:string)=>{const b={select:()=>b,eq:()=>b,order:()=>b,limit:()=>b,range:(start:number,end:number)=>{b.window=[start,end];return b;},window:[0,199],maybeSingle:async()=>{if(fixture.slowTopics)await new Promise(resolve=>setTimeout(resolve,6000));return ({data:{followed_topics:fixture.followedTopics,dismissed_topics:fixture.dismissedTopics,recommendation_feedback:fixture.feedback},error:fixture.preferencesFail?new Error('prefs unavailable'):null});},then:async(resolve:any)=>{if(fixture.slowHistory)await new Promise(done=>setTimeout(done,6000));return Promise.resolve({data:table==='likes'?(fixture.cloudLikes.length?fixture.cloudLikes.slice(b.window[0],b.window[1]+1):[{posts:{id:fixture.likedId,user_id:'cat-author',content:'猫の写真'}}]):[],error:fixture.preferencesFail?new Error('prefs unavailable'):null}).then(resolve);}};return b;}}}));
const source=(id:string,content:string)=>({id,userId:id,languages:['ja'],content,createdAt:'2026-10-03T00:00:00Z',likesCount:1,commentsCount:0,likedByMe:false,repostsCount:0,repostedByMe:false,imageUrls:[],author:{id,username:id}});
vi.mock('./posts',()=>({searchPosts:async(query:string)=>{fixture.searchCalls.push(query);return fixture.targeted?[source('targeted-lime','猫の写真')]:[];},getPostsByUser:async()=>[],getFeed:async()=>{fixture.limeCalls++;if(fixture.limeFail)throw new Error('lime failed');return fixture.limeSize>2?Array.from({length:fixture.limeSize},(_,i)=>source(`lime-${i}`,'猫の写真')):[source('lime-cat','猫の写真'),source('lime-sports','サッカー速報')];}}));
vi.mock('@/lib/bluesky',()=>({fetchBlueskyLikedPosts:async()=>[],discoverBlueskyTopicFeeds:async(topic:string)=>{fixture.discoveryTopics.push(topic);return fixture.topicFeedRows[topic]?[`feed:${topic}`,...(fixture.slowFeed?[`slow:${topic}`]:[])]:[];},fetchBlueskyTopicFeed:async({topic,feed}:any)=>{if(feed?.startsWith("slow:"))await new Promise(resolve=>setTimeout(resolve,6000));if(fixture.feedFail)throw new Error('topic feed failed');return {posts:(fixture.topicFeedRows[topic]??[]).map(post=>({...post,recommendationTopics:[topic]})),cursor:null};},fetchBlueskyAuthorFeed:async({actor}:any)=>{fixture.authorCalls.push(actor);return {posts:fixture.authorRows[actor]??[],cursor:null};},fetchBlueskyTopicPosts:async({query}:any)=>{fixture.topicCalls.push(query);return {posts:fixture.targeted?[source('bsky:targeted','猫の写真')]:[],cursor:null};},fetchTrendingJapaneseBlueskyPosts:async()=>{if(fixture.slowTrending)await new Promise(resolve=>setTimeout(resolve,6000));if(fixture.blueFail)throw new Error('blue failed');return {posts:[source('bsky:cat','猫の写真')],cursor:null};}}));
import { readRecommendationLikeHistory,createRecommendationCursor,getRecommendationPage,getRecommendationPreferences,refreshRecommendationVisualPage } from './recommendations';
it('returns completed candidates within 2.2 seconds and late reads cannot mutate the returned cursor',async()=>{
 vi.useFakeTimers();
 try{
  fixture.slowTrending=true;const previous=createRecommendationCursor([]);
  const pending=getRecommendationPage(previous,'viewer');await vi.advanceTimersByTimeAsync(2200);const page=await pending;
  expect(page.posts.some(post=>post.id==='lime-cat')).toBe(true);expect(page.next?.trending.done).toBe(false);
  const snapshot=JSON.stringify(page.next);await vi.advanceTimersByTimeAsync(7000);
  expect(JSON.stringify(page.next)).toBe(snapshot);expect(previous.lime.page).toBe(0);
 }finally{vi.useRealTimers();}
});
it('retains a completed topic feed when another feed for the same topic misses the deadline',async()=>{
 vi.useFakeTimers();
 try{
  fixture.followedTopics=['science'];fixture.slowFeed=true;fixture.topicFeedRows.science=[{...source('bsky:completed-image',''),imageUrls:['https://images.example/complete.jpg'],recommendationVisual:checked('science')}];
  const pending=getRecommendationPage(createRecommendationCursor([]),'viewer');await vi.advanceTimersByTimeAsync(2200);const page=await pending;
  expect(page.posts.map(post=>post.id)).toContain('bsky:completed-image');
  expect(page.next?.topicDiscovery?.science?.positions['feed:science'].done).toBe(true);
  expect(page.next?.topicDiscovery?.science?.positions['slow:science'].done).toBe(false);
  const snapshot=JSON.stringify(page.next);await vi.advanceTimersByTimeAsync(7000);expect(JSON.stringify(page.next)).toBe(snapshot);
 }finally{vi.useRealTimers();}
});
beforeEach(()=>{fixture.cloudLikes=[];fixture.feedback=[];fixture.likedId='';fixture.limeFail=false;fixture.blueFail=false;fixture.preferencesFail=false;fixture.limeSize=2;fixture.limeCalls=0;fixture.authorCalls=[];fixture.topicCalls=[];fixture.searchCalls=[];fixture.targeted=false;fixture.followedTopics=[];fixture.dismissedTopics=[];fixture.discoveryTopics=[];fixture.topicFeedRows={};fixture.authorRows={};fixture.misskeyRows=[];fixture.feedFail=false;fixture.slowTrending=false;fixture.slowFeed=false;fixture.slowHistory=false;fixture.slowTopics=false;localStorage.clear();});
it.each(['science','sports','food','music','art'])('retrieves keyword-free posts from a %s feed and ranks them before unrelated discovery',async topic=>{
 fixture.followedTopics=[topic];fixture.topicFeedRows[topic]=[{...source('bsky:media-only',''),imageUrls:['https://images.example/media.jpg'],recommendationVisual:checked(topic)}];
 const page=await getRecommendationPage(createRecommendationCursor([]),'viewer');
 expect(fixture.discoveryTopics).toContain(topic);expect(page.posts[0].id).toBe('bsky:media-only');
});
it('expands a Misskey topic creator into their image-only posts without requiring a body keyword',async()=>{
 fixture.followedTopics=['food'];
 fixture.misskeyRows=['料理の写真','レシピ'].map((content,i)=>({...source(`misskey:work-${i}`,content),userId:'misskey-user:chef',imageUrls:['https://images.example/food.jpg'],recommendationVisual:{version:1,kind:'food',topics:['food'],confidence:.8,similarity:.3,vector:Array(512).fill(0)}}));
 fixture.authorRows['misskey-user:chef']=[{...source('misskey:media-only',''),userId:'misskey-user:chef',imageUrls:['https://images.example/next-food.jpg'],recommendationVisual:checked('food')}];
 const page=await getRecommendationPage(createRecommendationCursor([]),'viewer');
 expect(fixture.authorCalls).toContain('misskey-user:chef');expect(page.posts.find(post=>post.id==='misskey:media-only')?.recommendationAuthorTopics).toEqual(['food']);
});
it('rotates bounded feed discovery through all followed topics and keeps failed feeds retryable',async()=>{
 fixture.followedTopics=['science','sports','food'];fixture.topicFeedRows.science=[];fixture.feedFail=true;
 const previous=createRecommendationCursor([]),first=await getRecommendationPage(previous,'viewer');
 expect(fixture.discoveryTopics).toEqual(['science','sports']);expect(first.next!.topicDiscovery?.science?.done).toBe(false);expect(previous.topicDiscovery).toBeUndefined();
 fixture.feedFail=false;await getRecommendationPage(first.next!,'viewer');
 expect(fixture.discoveryTopics).toContain('food');
});
it('loads cloud topic follows and dismissals and uses them in external candidate retrieval',async()=>{
 fixture.followedTopics=['games'];fixture.dismissedTopics=['pets'];
 const preferences=await getRecommendationPreferences('viewer');
 expect(preferences.followedTopics).toEqual(['games']);expect(preferences.dismissedTopics).toEqual(['pets']);
 await getRecommendationPage(createRecommendationCursor([]),'viewer');
 expect(fixture.discoveryTopics).toContain('games');expect(fixture.topicCalls).toEqual([]);expect(fixture.topicCalls).not.toContain('猫');
});
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
it('does not show unrelated discovery when explicit topic preferences cannot be read',async()=>{
 fixture.preferencesFail=true;await expect(getRecommendationPage(createRecommendationCursor([]),'viewer')).rejects.toThrow('prefs unavailable');
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
  expect(page.posts.map(p=>p.id)).toContain('misskey:targeted');
});
it('carries diversity history into the next ranked page without mutating previous history',async()=>{
  fixture.limeSize=60;
  const first=await getRecommendationPage(createRecommendationCursor([]),'viewer');
  const before=first.next!.history.map(p=>p.id);
  const second=await getRecommendationPage(first.next!,'viewer');
  expect(first.next!.history.map(p=>p.id)).toEqual(before);
  expect(second.next?.history.map(p=>p.id)).toEqual(second.posts.slice(-20).map(p=>p.id));
});

it('excludes server-side liked posts while still learning their topics for fresh candidates',async()=>{
  fixture.likedId='lime-cat';
  const page=await getRecommendationPage(createRecommendationCursor([]),'viewer');
  expect(page.posts.map(post=>post.id)).not.toContain('lime-cat');
  expect(page.posts.map(post=>post.id)).toContain('bsky:cat');
  expect(fixture.searchCalls).toContain('猫');
});
const checked=(topic:string)=>({version:1 as const,kind:topic==='digital-illustration'?'moe':topic,topics:[topic] as any,confidence:.8,similarity:.3,vector:Array(512).fill(0)});
it.each(['economy','politics','sports','business','science','technology','ai','art','digital-illustration','film','games','crypto','travel','anime','food','career','pets','music','design','fashion','memes','fitness'])('%s: propagates source language to a creator media-only candidate with no body, alt, bio, or language record',async topic=>{
 fixture.followedTopics=[topic];const actor='did:plc:media-context';
 fixture.topicFeedRows[topic]=[0,1].map(i=>({...source(`bsky:seed-${i}`,''),userId:actor,languages:undefined,recommendationLanguages:['ja'],imageUrls:[`https://images.example/seed-${i}.jpg`],recommendationVisual:checked(topic),author:{id:actor,username:'creator.bsky.social'}}));
 fixture.authorRows[actor]=[{...source('bsky:creator-image',''),userId:actor,languages:undefined,imageUrls:['https://images.example/latest.jpg'],recommendationVisual:checked(topic),author:{id:actor,username:'creator.bsky.social'}}];
 const page=await getRecommendationPage(createRecommendationCursor([]),'viewer');
 expect(page.posts.find(row=>row.id==='bsky:creator-image')).toMatchObject({content:'',recommendationAuthorTopics:[topic],recommendationLanguages:['ja']});
});
it('does not use excluded English feed posts to infer a Japanese creator for future image-only posts',async()=>{
 fixture.followedTopics=['art'];const actor='did:plc:english-creator';fixture.topicFeedRows.art=[0,1].map(i=>({...source(`bsky:english-${i}`,'My latest illustration'),userId:actor,languages:['en'],recommendationLanguages:['ja'],imageUrls:[`https://images.example/en-${i}.jpg`]}));
 await getRecommendationPage(createRecommendationCursor([]),'viewer');expect(fixture.authorCalls).not.toContain(actor);
});

it('returns a cold digital page without awaiting pixel inference and rejects a known game screenshot',async()=>{
 fixture.followedTopics=['digital-illustration'];fixture.topicFeedRows['digital-illustration']=[{...source('bsky:cold',''),imageUrls:['https://images.example/cold.jpg']},{...source('bsky:game','ファンアート'),imageUrls:['https://images.example/game.jpg'],recommendationVisual:checked('games')}];
 const page=await getRecommendationPage(createRecommendationCursor([]),'viewer');
 expect(page.posts.map(post=>post.id)).toEqual(['bsky:cold']);expect(page.pendingAnalysis).toBe(false);
});
it('uses explicit topics even when old likes/history take six seconds',async()=>{
 vi.useFakeTimers();try{
 fixture.slowHistory=true;fixture.followedTopics=['digital-illustration'];fixture.topicFeedRows['digital-illustration']=[{...source('bsky:qualified',''),imageUrls:['https://images.example/qualified.jpg'],recommendationVisual:checked('digital-illustration')}];
 const pending=getRecommendationPage(createRecommendationCursor([]),'viewer');await vi.advanceTimersByTimeAsync(2200);const page=await pending;
 expect(page.preferences.followedTopics).toEqual(['digital-illustration']);expect(page.posts.map(row=>row.id)).toEqual(['bsky:qualified']);
 await vi.advanceTimersByTimeAsync(7000);expect(page.posts.map(row=>row.id)).toEqual(['bsky:qualified']);
 }finally{vi.useRealTimers();}
});
it('keeps the previous page empty rather than ignoring a slow topic lookup',async()=>{
 vi.useFakeTimers();try{fixture.slowTopics=true;fixture.followedTopics=['digital-illustration'];const pending=getRecommendationPage(createRecommendationCursor([]),'viewer');await vi.advanceTimersByTimeAsync(2200);const page=await pending;expect(page.posts).toEqual([]);await vi.advanceTimersByTimeAsync(7000);expect(page.posts).toEqual([]);}finally{vi.useRealTimers();}
});

 it('learns one external like once when its cloud snapshot and local cache both exist',async()=>{
  const liked={...source('bsky:at://did:plc:artist/app.bsky.feed.post/abc',''),userId:'bsky:did:plc:artist',imageUrls:['https://example.com/art.jpg']};
  fixture.cloudLikes=[{post_snapshot:liked,created_at:new Date().toISOString()}];
  const before=await getRecommendationPreferences('viewer');
  recordCloudLikeTest(liked as any,true,'viewer');
  const after=await getRecommendationPreferences('viewer');
  expect(after.authors[liked.userId]).toBeCloseTo(before.authors[liked.userId],6);expect(after.likedPostIds).toEqual([liked.id]);expect(after.likedSamples).toHaveLength(1);
 });

it('bounds familiar-author reads and rotates them so related topic feeds are not starved',async()=>{
 const actors=Array.from({length:6},(_,i)=>`did:plc:liked${i}`);
 fixture.cloudLikes=actors.map((actor,i)=>({created_at:new Date().toISOString(),post_snapshot:{...source(`liked-${i}`,'猫'),userId:actor}}));
 const first=await getRecommendationPage(createRecommendationCursor([]),'viewer');
 expect(fixture.authorCalls).toHaveLength(3);expect(fixture.authorCalls).toEqual(actors.slice(0,3));
 expect(first.next).toBeDefined();
 await getRecommendationPage(first.next!,'viewer');
 expect(fixture.authorCalls).toEqual(actors.slice(0,6));
});

it('retrieves related image-only creators while retaining favorites and excluding negative visual matches',async()=>{
 const vector=(index:number)=>Array.from({length:512},(_,i)=>i===index?1:0);
 const work=(id:string,author:string,bad=false)=>({...source(id,''),userId:author,imageUrls:[`https://example.com/${id}.jpg`],recommendationVisual:{...checked('science'),vector:vector(bad?1:0)}});
 fixture.followedTopics=['science'];
 fixture.cloudLikes=Array.from({length:12},(_,i)=>({created_at:new Date().toISOString(),post_snapshot:work(`bsky:liked-${i}`,'did:plc:favorite')}));
 fixture.authorRows['did:plc:favorite']=Array.from({length:30},(_,i)=>work(`bsky:familiar-${i}`,'did:plc:favorite'));
 fixture.topicFeedRows.science=[...Array.from({length:6},(_,i)=>work(`bsky:related-${i}`,`did:plc:neighbor${i}`)),...Array.from({length:10},(_,i)=>work(`bsky:negative-${i}`,`did:plc:bad${i}`,true))];
 fixture.feedback=[{id:'old-bad-work',userId:'did:plc:old-bad',vector:vector(1),createdAt:new Date().toISOString()}];
 const page=await getRecommendationPage(createRecommendationCursor([]),'viewer');
 expect(page.posts).toHaveLength(20);expect(page.posts.filter(row=>row.userId==='did:plc:favorite').length).toBeGreaterThan(10);
 expect(new Set(page.posts.filter(row=>row.id.startsWith('bsky:related')).map(row=>row.userId)).size).toBeGreaterThanOrEqual(3);
 expect(page.posts.some(row=>row.id.startsWith('bsky:negative'))).toBe(false);
});

it('removes a visible digital candidate when pixel analysis identifies a different kind',async()=>{
 fixture.followedTopics=['digital-illustration'];
 const candidate={...source('bsky:unclassified',''),imageUrls:['https://images.example/new.jpg']};
 fixture.topicFeedRows['digital-illustration']=[candidate];
 const page=await getRecommendationPage(createRecommendationCursor([]),'viewer');
 expect(page.posts).toHaveLength(1);
 const result=refreshRecommendationVisualPage(page,'viewer',{...candidate,recommendationVisual:checked('art')} as any);
 expect(result.posts).toHaveLength(0);
});
it('enriches an old dismissal and removes already visible matches from another creator',async()=>{
 fixture.followedTopics=['science'];
 const vector=Array(512).fill(0);vector[0]=1;
 const visual={...checked('science'),vector};
 const candidate={...source('bsky:negative-match',''),imageUrls:['https://images.example/negative.jpg'],recommendationVisual:visual};
 fixture.topicFeedRows.science=[candidate];
 const page=await getRecommendationPage(createRecommendationCursor([]),'viewer');
 const feedback={id:'bsky:old-negative',userId:'old-creator',createdAt:'2026-05-01T00:00:00Z'};
 page.preferences.feedback=[feedback];
 const result=refreshRecommendationVisualPage(page,'viewer',{...candidate,id:feedback.id,userId:feedback.userId} as any);
 expect(result.preferences.feedback?.[0].createdAt).toBe(feedback.createdAt);
 expect(result.preferences.feedback?.[0].vector).toEqual(vector);
 expect(result.posts.map(post=>post.id)).not.toContain(candidate.id);
});

it('hydrates 1000 cloud likes and learns authors beyond the first 200 without enlarging first-page reads',async()=>{
 fixture.cloudLikes=Array.from({length:1200},(_,i)=>({created_at:new Date(Date.now()-i*1000).toISOString(),post_snapshot:{...source(`bsky:liked-${i}`,''),userId:`did:plc:artist-${i}`,imageUrls:[`https://images.example/${i}.jpg`]}}));
 expect((await readRecommendationLikeHistory('viewer',false)).data).toHaveLength(200);
 const prefs=await getRecommendationPreferences('viewer');
 expect(prefs.likedPostIds).toHaveLength(1000);
 expect(prefs.authors['did:plc:artist-999']).toBeGreaterThan(0);
 expect(prefs.authors['did:plc:artist-1000']).toBeUndefined();
 expect(prefs.likedSamples).toHaveLength(128);
});
