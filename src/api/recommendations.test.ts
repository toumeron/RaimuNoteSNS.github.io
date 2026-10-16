vi.mock('@/lib/fxTwitter',()=>({searchXPage:async(term:string,options:any)=>{fixture.twitterCalls.push({term,...options});if(fixture.twitterDelay)await new Promise(resolve=>setTimeout(resolve,fixture.twitterDelay));return {posts:fixture.twitterRows,cursor:null};}}));
import {recordRecommendationLike as recordCloudLikeTest} from '@/lib/recommendations';
import { beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({followRows:[] as any[],followDelay:0,followReads:0,twitterRows:[] as any[],twitterCalls:[] as any[],twitterDelay:0,authorDelay:0,sizes:[] as number[],cloudLikes:[] as any[],feedback:[] as any[],likedId:'',limeFail:false,blueFail:false,preferencesFail:false,limeSize:2,limeCalls:0,authorCalls:[] as string[],topicCalls:[] as string[],searchCalls:[] as string[],targeted:false,followedTopics:[] as string[],dismissedTopics:[] as string[],discoveryTopics:[] as string[],topicFeedRows:{} as Record<string,any[]>,authorRows:{} as Record<string,any[]>,authorPages:{} as Record<string,any[][]>,misskeyRows:[] as any[],misskeyFail:false,feedFail:false,topicFeedContinues:false,slowTrending:false,slowFeed:false,slowHistory:false,slowTopics:false}));
vi.mock('@/lib/misskey',()=>({fetchMisskeyTopicPosts:async()=>{if(fixture.misskeyFail)throw new Error('misskey unavailable');return ({posts:fixture.misskeyRows.length?fixture.misskeyRows:fixture.targeted?[source('misskey:targeted','猫の写真')]:[],cursor:null});}}));
vi.mock('@/lib/supabase',()=>({supabase:{from:(table:string)=>{const b={select:()=>b,abortSignal:()=>b,eq:()=>b,order:()=>b,limit:()=>b,range:(start:number,end:number)=>{b.window=[start,end];return b;},window:[0,199],maybeSingle:async()=>{if(fixture.slowTopics)await new Promise(resolve=>setTimeout(resolve,2500));return ({data:{followed_topics:fixture.followedTopics,dismissed_topics:fixture.dismissedTopics,recommendation_feedback:fixture.feedback},error:fixture.preferencesFail?new Error('prefs unavailable'):null});},then:async(resolve:any)=>{if(table==='follows'){fixture.followReads++;if(fixture.followDelay)await new Promise(done=>setTimeout(done,fixture.followDelay));}if(fixture.slowHistory&&table!=='follows')await new Promise(done=>setTimeout(done,6000));return Promise.resolve({data:table==='follows'?fixture.followRows:table==='likes'?(fixture.cloudLikes.length?fixture.cloudLikes.slice(b.window[0],b.window[1]+1):[{posts:{id:fixture.likedId,user_id:'cat-author',content:'猫の写真'}}]):[],error:fixture.preferencesFail?new Error('prefs unavailable'):null}).then(resolve);}};return b;}}}));
const source=(id:string,content:string)=>({id,userId:id,languages:['ja'],content,createdAt:'2026-10-03T00:00:00Z',likesCount:1,commentsCount:0,likedByMe:false,repostsCount:0,repostedByMe:false,imageUrls:[],author:{id,username:id}});
vi.mock('./posts',()=>({searchPosts:async(query:string)=>{fixture.searchCalls.push(query);return fixture.targeted?[source('targeted-lime','猫の写真')]:[];},getPostsByUser:async()=>[],getFeed:async(_page:number,limit:number)=>{fixture.sizes.push(limit);fixture.limeCalls++;if(fixture.limeFail)throw new Error('lime failed');return fixture.limeSize>2?Array.from({length:fixture.limeSize},(_,i)=>source(`lime-${i}`,'猫の写真')):[source('lime-cat','猫の写真'),source('lime-sports','サッカー速報')];}}));
vi.mock('@/lib/bluesky',()=>({fetchBlueskyLikedPosts:async()=>[],discoverBlueskyTopicFeeds:async(topic:string)=>{fixture.discoveryTopics.push(topic);return fixture.topicFeedRows[topic]?[`feed:${topic}`,...(fixture.slowFeed?[`slow:${topic}`]:[])]:[];},fetchBlueskyTopicFeed:async({topic,feed}:any)=>{if(feed?.startsWith("slow:"))await new Promise(resolve=>setTimeout(resolve,6000));if(fixture.feedFail)throw new Error('topic feed failed');return {posts:(fixture.topicFeedRows[topic]??[]).map(post=>({...post,recommendationTopics:[topic]})),cursor:fixture.topicFeedContinues?'next':null};},fetchBlueskyAuthorFeed:async({actor,cursor,limit}:any)=>{fixture.sizes.push(limit);fixture.authorCalls.push(actor);if(fixture.authorDelay)await new Promise(resolve=>setTimeout(resolve,fixture.authorDelay));const pages=fixture.authorPages[actor];const index=Number(cursor??0);return pages?{posts:pages[index]??[],cursor:index+1<pages.length?String(index+1):null}:{posts:fixture.authorRows[actor]??[],cursor:null};},fetchBlueskyTopicPosts:async({query}:any)=>{fixture.topicCalls.push(query);return {posts:fixture.targeted?[source('bsky:targeted','猫の写真')]:[],cursor:null};},fetchTrendingJapaneseBlueskyPosts:async()=>{if(fixture.slowTrending)await new Promise(resolve=>setTimeout(resolve,6000));if(fixture.blueFail)throw new Error('blue failed');return {posts:[source('bsky:cat','猫の写真')],cursor:null};}}));
import { readRecommendationLikeHistory,createRecommendationCursor,getRecommendationPage,getRecommendationPreferences,refreshRecommendationVisualPage } from './recommendations';
it('returns completed candidates at the read deadline and late reads cannot mutate the returned cursor',async()=>{
 vi.useFakeTimers();
 try{
  fixture.slowTrending=true;const previous=createRecommendationCursor([]);
  const pending=getRecommendationPage(previous,'viewer');await vi.advanceTimersByTimeAsync(6500);const page=await pending;
  expect(page.posts.some(post=>post.id==='lime-cat')).toBe(true);expect(page.next?.trending.done).toBe(false);
  const snapshot=JSON.stringify(page.next);await vi.advanceTimersByTimeAsync(7000);
  expect(JSON.stringify(page.next)).toBe(snapshot);expect(previous.lime.page).toBe(0);
 }finally{vi.useRealTimers();}
});
it('retains a completed topic feed when another feed for the same topic misses the deadline',async()=>{
 vi.useFakeTimers();
 try{
  fixture.followedTopics=['science'];fixture.slowFeed=true;fixture.topicFeedRows.science=[{...source('bsky:completed-image',''),imageUrls:['https://images.example/complete.jpg'],recommendationVisual:checked('science')}];
  const pending=getRecommendationPage(createRecommendationCursor([]),'viewer');await vi.advanceTimersByTimeAsync(6500);const page=await pending;
  expect(page.posts.map(post=>post.id)).toContain('bsky:completed-image');
  expect(page.next?.topicDiscovery?.science?.positions['feed:science'].done).toBe(true);
  expect(page.next?.topicDiscovery?.science?.positions['slow:science']?.done??false).toBe(false);
  const snapshot=JSON.stringify(page.next);await vi.advanceTimersByTimeAsync(7000);expect(JSON.stringify(page.next)).toBe(snapshot);
 }finally{vi.useRealTimers();}
});
beforeEach(()=>{fixture.followRows=[];fixture.followDelay=0;fixture.followReads=0;fixture.twitterRows=[];fixture.twitterCalls=[];fixture.twitterDelay=0;fixture.authorDelay=0;fixture.sizes=[];fixture.cloudLikes=[];fixture.feedback=[];fixture.likedId='';fixture.limeFail=false;fixture.blueFail=false;fixture.preferencesFail=false;fixture.limeSize=2;fixture.limeCalls=0;fixture.authorCalls=[];fixture.topicCalls=[];fixture.searchCalls=[];fixture.targeted=false;fixture.followedTopics=[];fixture.dismissedTopics=[];fixture.discoveryTopics=[];fixture.topicFeedRows={};fixture.authorRows={};fixture.authorPages={};fixture.misskeyRows=[];fixture.misskeyFail=false;fixture.feedFail=false;fixture.topicFeedContinues=false;fixture.slowTrending=false;fixture.slowFeed=false;fixture.slowHistory=false;fixture.slowTopics=false;localStorage.clear();});
it.each(['science','sports','food','music','art'])('retrieves keyword-free posts from a %s feed and ranks them before unrelated discovery',async topic=>{
 fixture.followedTopics=[topic];fixture.topicFeedRows[topic]=[{...source('bsky:media-only',''),imageUrls:['https://images.example/media.jpg'],recommendationVisual:checked(topic)}];
 const page=await getRecommendationPage(createRecommendationCursor([]),'viewer');
 expect(fixture.discoveryTopics).toContain(topic);expect(page.posts[0].id).toBe('bsky:media-only');
});
it('expands a Misskey topic creator into their image-only posts without requiring a body keyword',async()=>{
 fixture.followedTopics=['food'];
 fixture.misskeyRows=['料理の写真','レシピ'].map((content,i)=>({...source(`misskey:work-${i}`,content),userId:'misskey-user:chef',imageUrls:['https://images.example/food.jpg'],recommendationVisual:{version:1,kind:'food',topics:['food'],confidence:.8,similarity:.3,vector:Array(512).fill(0)}}));
 fixture.authorRows['misskey-user:chef']=[{...source('misskey:media-only',''),userId:'misskey-user:chef',imageUrls:['https://images.example/next-food.jpg'],recommendationVisual:checked('food')}];
 const first=await getRecommendationPage(createRecommendationCursor([]),'viewer');
 const page=await getRecommendationPage(first.next!,'viewer');
 expect(fixture.authorCalls).toContain('misskey-user:chef');expect(page.posts.find(post=>post.id==='misskey:media-only')?.recommendationAuthorTopics).toEqual(['food']);
});
it('rotates bounded feed discovery through all followed topics and keeps failed feeds retryable',async()=>{
 fixture.followedTopics=['science','sports','food'];fixture.topicFeedRows.science=[];fixture.feedFail=true;
 const previous=createRecommendationCursor([]),first=await getRecommendationPage(previous,'viewer');
 expect(fixture.discoveryTopics).toEqual(['science']);expect(first.next!.topicDiscovery?.science?.done).toBe(false);expect(previous.topicDiscovery).toBeUndefined();
 fixture.feedFail=false;const second=await getRecommendationPage(first.next!,'viewer');
 await getRecommendationPage(second.next!,'viewer');
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
  if(page.next)expect((await getRecommendationPage(page.next,'viewer')).posts).toEqual([]);
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
  expect(first.posts).toHaveLength(8);expect(second.posts).toHaveLength(8);
  expect(new Set([...first.posts,...second.posts].map(p=>p.id)).size).toBe(16);
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
  const next=await getRecommendationPage(page.next!,'viewer');
  expect([...page.posts,...next.posts].map(p=>p.id)).toContain('misskey:targeted');
});
it('carries diversity history into the next ranked page without mutating previous history',async()=>{
  fixture.limeSize=60;
  const first=await getRecommendationPage(createRecommendationCursor([]),'viewer');
  const before=first.next!.history.map(p=>p.id);
  const second=await getRecommendationPage(first.next!,'viewer');
  expect(first.next!.history.map(p=>p.id)).toEqual(before);
  expect(second.next?.history.map(p=>p.id)).toEqual([...before,...second.posts.map(p=>p.id)].slice(-20));
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
 const first=await getRecommendationPage(createRecommendationCursor([]),'viewer');
 const page=await getRecommendationPage(first.next!,'viewer');
 expect(page.posts.find(row=>row.id==='bsky:creator-image')).toMatchObject({content:'',recommendationAuthorTopics:[topic],recommendationLanguages:['ja']});
});
it('does not use excluded English feed posts to infer a Japanese creator for future image-only posts',async()=>{
 fixture.followedTopics=['art'];const actor='did:plc:english-creator';fixture.topicFeedRows.art=[0,1].map(i=>({...source(`bsky:english-${i}`,'My latest illustration'),userId:actor,languages:['en'],recommendationLanguages:['ja'],imageUrls:[`https://images.example/en-${i}.jpg`]}));
 await getRecommendationPage(createRecommendationCursor([]),'viewer');expect(fixture.authorCalls).not.toContain(actor);
});

it('returns a cold digital page without awaiting pixel inference and rejects a known game screenshot',async()=>{
 fixture.followedTopics=['digital-illustration'];fixture.topicFeedRows['digital-illustration']=[{...source('bsky:cold','キャラクターイラスト'),imageUrls:['https://images.example/cold.jpg']},{...source('bsky:game','ファンアート'),imageUrls:['https://images.example/game.jpg'],recommendationVisual:checked('games')}];
 const page=await getRecommendationPage(createRecommendationCursor([]),'viewer');
 expect(page.posts.map(post=>post.id)).toEqual(['bsky:cold']);expect(page.pendingAnalysis).toBe(false);
});
it('uses explicit topics even when old likes/history take six seconds',async()=>{
 vi.useFakeTimers();try{
 fixture.slowHistory=true;fixture.followedTopics=['digital-illustration'];fixture.topicFeedRows['digital-illustration']=[{...source('bsky:qualified',''),imageUrls:['https://images.example/qualified.jpg'],recommendationVisual:checked('digital-illustration')}];
 let settled=false;const pending=getRecommendationPage(createRecommendationCursor([]),'viewer').then(page=>{settled=true;return page;});await vi.advanceTimersByTimeAsync(300);expect(settled).toBe(true);const page=await pending;
 expect(page.preferences.followedTopics).toEqual(['digital-illustration']);expect(page.posts.map(row=>row.id)).toEqual(['bsky:qualified']);
 await vi.advanceTimersByTimeAsync(7000);expect(page.posts.map(row=>row.id)).toEqual(['bsky:qualified']);
 }finally{vi.useRealTimers();}
});
it('waits for a healthy slow topic lookup instead of treating it as an empty failure',async()=>{
 vi.useFakeTimers();try{fixture.slowTopics=true;fixture.followedTopics=['science'];fixture.topicFeedRows.science=[{...source('bsky:slow-healthy','科学の研究'),imageUrls:['https://images.example/research.jpg']}];const pending=getRecommendationPage(createRecommendationCursor([]),'viewer');await vi.advanceTimersByTimeAsync(2700);const page=await pending;expect(page.posts.map(row=>row.id)).toContain('bsky:slow-healthy');expect(page.automaticPaused).toBe(false);}finally{vi.useRealTimers();}
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
 expect(fixture.authorCalls).toHaveLength(2);expect(fixture.authorCalls).toEqual(actors.slice(0,2));
 expect(first.next).toBeDefined();
 await getRecommendationPage(first.next!,'viewer');
 expect(fixture.authorCalls).toEqual([actors[0],actors[1],actors[2],actors[3]]);
 expect((await getRecommendationPage(first.next!,'viewer')).posts).toBeDefined();
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
 expect(page.posts).toHaveLength(8);expect(page.posts.filter(row=>row.userId==='did:plc:favorite').length).toBeGreaterThan(0);
 expect(new Set(page.posts.filter(row=>row.id.startsWith('bsky:related')).map(row=>row.userId)).size).toBeGreaterThanOrEqual(2);
 expect(page.posts.some(row=>row.id.startsWith('bsky:negative'))).toBe(false);
});

it('removes a visible digital candidate when pixel analysis identifies a different kind',async()=>{
 fixture.followedTopics=['digital-illustration'];
 const candidate={...source('bsky:unclassified','キャラクターイラスト'),imageUrls:['https://images.example/new.jpg']};
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

it('pauses empty timeouts without reporting a failure and preserves the cursor for continuation',async()=>{
 vi.useFakeTimers();
 try{
  fixture.slowTrending=true;let cursor=createRecommendationCursor([]);cursor.lime.done=true;cursor.preferences={authors:{},terms:{}};
  for(let i=0;i<3;i++){const pending=getRecommendationPage(cursor,'viewer');await vi.advanceTimersByTimeAsync(5100);const page=await pending;expect(page.posts).toEqual([]);expect(page.automaticPaused).toBe(i===2);cursor=page.next!;}
  fixture.slowTrending=false;expect((await getRecommendationPage(cursor,'viewer')).posts.length).toBeGreaterThan(0);
 }finally{vi.useRealTimers();}
});
it('cancels a pending page immediately when leaving the timeline',async()=>{
 vi.useFakeTimers();
 try{
  fixture.slowTopics=true;const controller=new AbortController();
  const stopped=expect(getRecommendationPage(createRecommendationCursor([]),'viewer',controller.signal)).rejects.toMatchObject({name:'AbortError'});
  await vi.advanceTimersByTimeAsync(10);controller.abort();await stopped;
 }finally{vi.useRealTimers();}
});
it('bounds optional history hydration when a database read never settles',async()=>{
 vi.useFakeTimers();
 try{fixture.slowHistory=true;const stopped=expect(getRecommendationPreferences('viewer')).rejects.toMatchObject({name:'TimeoutError'});await vi.advanceTimersByTimeAsync(5000);await stopped;}finally{vi.useRealTimers();}
});

it('continues beyond three healthy filtered author pages and learns image-only likes creator context',async()=>{
 fixture.followedTopics=['digital-illustration'];
 const actor='did:plc:favorite';
 const visual={...checked('digital-illustration'),vector:Array.from({length:512},(_,i)=>i===0?1:0)};
 const works=Array.from({length:4},(_,i)=>({...source(`bsky:work-${i}`,''),userId:actor,imageUrls:[`https://images.example/work-${i}.jpg`],recommendationVisual:visual}));
 fixture.cloudLikes=works.slice(0,3).map(post=>({created_at:new Date().toISOString(),post_snapshot:{...post,recommendationAuthorTopics:['digital-illustration']}}));
 fixture.authorPages[actor]=works.map(post=>[post]);
 let cursor=createRecommendationCursor([]);
 for(let i=0;i<3;i++){
  const page=await getRecommendationPage(cursor,'viewer');
  expect(page.posts).toEqual([]);expect(page.automaticPaused).toBe(false);
  expect(page.next?.authors[actor].cursor).toBe(String(i+1));cursor=page.next!;
 }
 const page=await getRecommendationPage(cursor,'viewer');
 expect(page.posts.map(post=>post.id)).toEqual(['bsky:work-3']);
 expect(page.preferences.authorTopics?.[actor]?.['digital-illustration']).toBeGreaterThan(0);
});

it('publishes usable posts before a slow sibling finishes instead of waiting for twenty cards',async()=>{
 vi.useFakeTimers();
 try{
  fixture.slowTrending=true;let settled=false;
  const pending=getRecommendationPage(createRecommendationCursor([]),'viewer').then(page=>{settled=true;return page;});
  await vi.advanceTimersByTimeAsync(300);
  expect(settled).toBe(true);const page=await pending;
  expect(page.posts.map(post=>post.id)).toContain('lime-cat');
  expect(page.next?.trending.done).toBe(false);
  const returned=JSON.stringify(page.next);await vi.advanceTimersByTimeAsync(7000);expect(JSON.stringify(page.next)).toBe(returned);
 }finally{vi.useRealTimers();}
});
it('topic feed rotation is not cursor progress when repeated reads time out',async()=>{
 vi.useFakeTimers();
 try{
  let cursor=createRecommendationCursor([]);cursor.lime.done=true;cursor.trending.done=true;cursor.preferences={authors:{},terms:{},followedTopics:['science']};
  cursor.topicDiscovery={science:{feeds:['slow:science'],positions:{'slow:science':{cursor:null,done:false}},done:false}};
  cursor.topics={科学:{limePage:0,limeDone:true,blueCursor:null,blueDone:true,misskeyDone:true}};cursor.twitterDiscovery={科学:{cursor:null,done:true}};
  for(let i=0;i<3;i++){
   const pending=getRecommendationPage(cursor,'viewer');await vi.advanceTimersByTimeAsync(5100);const page=await pending;
   expect(page.posts).toEqual([]);expect(page.automaticPaused).toBe(i===2);cursor=page.next!;
  }
 }finally{vi.useRealTimers();}
});

 it('uses the same eight-row source budget on initial and later reads',async()=>{
 const actor='did:plc:bounded';
 fixture.limeSize=0;fixture.authorPages[actor]=Array.from({length:3},(_,page)=>Array.from({length:8},(_,i)=>source(`bsky:bounded-${page}-${i}`,`猫の写真 ${page}-${i}`)));
 let cursor=createRecommendationCursor([]);cursor.lime.done=true;cursor.trending.done=true;cursor.preferences={authors:{[actor]:10},terms:{猫:10}};
 for(let i=0;i<3;i++){
  const start=fixture.sizes.length;const page=await getRecommendationPage(cursor,'viewer');
  expect(page.posts.length).toBeGreaterThan(0);expect(page.posts.length).toBeLessThanOrEqual(8);
  expect(fixture.sizes.slice(start)).toEqual([8]);cursor=page.next!;
 }
 });
 it('publishes a later page promptly when another source remains slow',async()=>{
 vi.useFakeTimers();try{
 fixture.slowTrending=true;const actor='did:plc:fast';
 fixture.authorPages[actor]=Array.from({length:3},(_,page)=>Array.from({length:8},(_,i)=>source(`bsky:fast-${page}-${i}`,`猫の写真 ${page}-${i}`)));
 let cursor=createRecommendationCursor([]);cursor.lime.done=true;cursor.preferences={authors:{[actor]:10},terms:{猫:10}};
 for(let i=0;i<3;i++){
  let finished=false;const pending=getRecommendationPage(cursor,'viewer').then(page=>{finished=true;return page;});
  await vi.advanceTimersByTimeAsync(300);expect(finished).toBe(true);const page=await pending;
  expect(page.posts.length).toBeGreaterThan(0);expect(page.next?.trending.done).toBe(false);cursor=page.next!;
 }
 }finally{vi.useRealTimers();}
 });

it('keeps a healthy two-second creator read alive when it is the only eligible source',async()=>{
 vi.useFakeTimers();try{
  fixture.authorDelay=2000;const actor='did:plc:healthy';
  fixture.authorPages[actor]=Array.from({length:2},(_,i)=>[{...source(`bsky:healthy-${i}`,''),userId:actor,imageUrls:[`https://images.example/healthy-${i}.jpg`],recommendationVisual:checked('science')}]);
  let cursor=createRecommendationCursor([]);cursor.lime.done=true;cursor.trending.done=true;cursor.preferences={authors:{[actor]:10},terms:{},followedTopics:['science']};
  cursor.topics={科学:{limePage:0,limeDone:true,blueCursor:null,blueDone:true,misskeyDone:true}};cursor.twitterDiscovery={科学:{cursor:null,done:true}};cursor.topicDiscovery={science:{feeds:[],positions:{},done:true}};
  for(let i=0;i<2;i++){
   let settled=false;const pending=getRecommendationPage(cursor,'viewer').then(page=>{settled=true;return page;});
   await vi.advanceTimersByTimeAsync(1600);expect(settled).toBe(false);
   await vi.advanceTimersByTimeAsync(600);const page=await pending;
   expect(page.posts.map(post=>post.id)).toEqual([`bsky:healthy-${i}`]);expect(page.automaticPaused).toBe(false);cursor=page.next!;
  }
 }finally{vi.useRealTimers();}
});

it('reaches the third creator when the first two keep returning excluded posts',async()=>{
 const actors=['did:plc:first','did:plc:second','did:plc:third'];
 for(const actor of actors.slice(0,2))fixture.authorPages[actor]=[0,1,2].map(i=>[{...source(`bsky:${actor}-${i}`,'Different foreign post '+i),languages:['en'],userId:actor}]);
 fixture.authorRows[actors[2]]=[{...source('bsky:third-visible','日本語の候補'),userId:actors[2]}];
 const cursor=createRecommendationCursor([]);cursor.lime.done=true;cursor.trending.done=true;cursor.preferences={authors:Object.fromEntries(actors.map(actor=>[actor,10])),terms:{}};
 const first=await getRecommendationPage(cursor,'viewer');expect(first.posts).toEqual([]);
 const second=await getRecommendationPage(first.next!,'viewer');
 expect(second.posts.map(post=>post.id)).toContain('bsky:third-visible');
 expect(fixture.authorCalls).toContain(actors[2]);
});
it('reaches the second followed topic while the first topic has endless excluded pages',async()=>{
 fixture.followedTopics=['science','digital-illustration'];fixture.topicFeedContinues=true;
 fixture.topicFeedRows.science=[{...source('bsky:foreign-science','Research update'),languages:['en']}];
 fixture.topicFeedRows['digital-illustration']=[{...source('bsky:second-topic-visible','日本語のキャラクターイラスト'),imageUrls:['https://images.example/digital.jpg']}];
 const first=await getRecommendationPage(createRecommendationCursor([]),'viewer');expect(first.posts).toEqual([]);
 const second=await getRecommendationPage(first.next!,'viewer');
 expect(second.posts.map(post=>post.id)).toContain('bsky:second-topic-visible');
 expect(fixture.discoveryTopics).toEqual(['science','digital-illustration']);
});

it('keeps explicitly followed anime and illustration discovery alive after many individual work dismissals',async()=>{
 fixture.followedTopics=['anime','digital-illustration'];
 fixture.feedback=Array.from({length:110},(_,i)=>({id:`dismissed-${i}`,userId:`dismissed-creator-${i}`,topics:[i<4?'anime':i<65?'digital-illustration':'art'],imageUrls:[`https://images.example/dismissed-${i}.jpg`],createdAt:new Date().toISOString()}));
 fixture.topicFeedRows.anime=[{...source('bsky:fresh-anime','アニメの話題'),imageUrls:['https://images.example/new-anime.jpg']}];
 fixture.topicFeedRows['digital-illustration']=[{...source('bsky:fresh-illustration','キャラクターイラスト'),imageUrls:['https://images.example/new-art.jpg']}];
 const first=await getRecommendationPage(createRecommendationCursor([]),'viewer');
 expect(first.posts.map(post=>post.id)).toContain('bsky:fresh-anime');
 const second=await getRecommendationPage(first.next!,'viewer');
 expect(second.posts.map(post=>post.id)).toContain('bsky:fresh-illustration');
 expect(fixture.discoveryTopics).toContain('anime');expect(fixture.discoveryTopics).toContain('digital-illustration');
});

it('tries the next followed topic before treating a failed supplementary service as a completely unavailable feed',async()=>{
 fixture.followedTopics=['anime','digital-illustration'];fixture.misskeyFail=true;
 fixture.topicFeedRows['digital-illustration']=[{...source('bsky:available-after-failure','日本語のキャラクターイラスト'),imageUrls:['https://images.example/fresh.jpg']}];
 const first=await getRecommendationPage(createRecommendationCursor([]),'viewer');
 const next=await getRecommendationPage(first.next!,'viewer');
 expect(next.posts.map(post=>post.id)).toContain('bsky:available-after-failure');
});

it('does not end a feed while unshown relevant works remain from the recent creator',async()=>{
 const cursor=createRecommendationCursor([]),actor='did:plc:science-creator';
 cursor.preferences={authors:{[actor]:8},terms:{},followedTopics:['science']};
 cursor.lime.done=true;cursor.trending.done=true;
 cursor.authors={[actor]:{cursor:null,done:true}};
 cursor.topicDiscovery={science:{feeds:[],positions:{},done:true}};
 const {recommendationQueries}=await import('@/lib/recommendations');
 cursor.topics=Object.fromEntries(recommendationQueries(cursor.preferences).map(term=>[term,{limePage:0,limeDone:true,blueCursor:null,blueDone:true,misskeyCursor:null,misskeyDone:true}]));
 const works=Array.from({length:19},(_,i)=>({...source(`bsky:unshown-science-${i}`,'科学の研究'),userId:actor,imageUrls:[`https://images.example/science-${i}.jpg`],author:{id:actor,username:'creator',displayName:'Creator',bio:'',avatarUrl:'',coverUrl:'',createdAt:'2026-10-13'}}));
 cursor.twitterDiscovery={科学:{cursor:null,done:true}};cursor.history=works.slice(0,3);cursor.seen=cursor.history.map(post=>post.id);cursor.remaining=works.slice(3);
 const first=await getRecommendationPage(cursor,'viewer');
 expect(first.posts).toHaveLength(8);expect(first.next).toBeDefined();
 const second=await getRecommendationPage(first.next!,'viewer');
 expect(second.posts).toHaveLength(8);expect(second.next).toBeUndefined();
 expect(new Set([...first.posts,...second.posts].map(post=>post.id)).size).toBe(16);
 expect(fixture.authorCalls).toEqual([]);expect(fixture.topicCalls).toEqual([]);
});

it('bounds an endless unrelated creator without pausing another productive creator',async()=>{
 const actor='did:plc:unrelated',good='did:plc:related',cursor=createRecommendationCursor([]);
 cursor.preferences={authors:{[actor]:8,[good]:8},terms:{},followedTopics:['science']};cursor.lime.done=true;cursor.trending.done=true;
 cursor.authors={[actor]:{cursor:null,done:false},[good]:{cursor:null,done:false}};cursor.topicDiscovery={science:{feeds:[],positions:{},done:true}};
 const {recommendationQueries}=await import('@/lib/recommendations');
 cursor.topics=Object.fromEntries(recommendationQueries(cursor.preferences).map(term=>[term,{limePage:0,limeDone:true,blueCursor:null,blueDone:true,misskeyCursor:null,misskeyDone:true}]));
 fixture.authorPages[actor]=Array.from({length:30},(_,i)=>[{...source(`bsky:unrelated-${i}`,'猫の写真'),userId:actor}]);
 fixture.authorPages[good]=Array.from({length:10},(_,i)=>[{...source(`bsky:related-${i}`,'科学の研究'),userId:good}]);
 let next:typeof cursor|undefined=cursor,delivered:string[]=[];
 for(let i=0;i<12&&next;i++){const page=await getRecommendationPage(next,'viewer');delivered.push(...page.posts.map(post=>post.id));expect(page.automaticPaused).toBe(false);next=page.next;}
 expect(delivered).toHaveLength(10);expect(delivered.every(id=>id.startsWith('bsky:related-'))).toBe(true);
 expect(fixture.authorCalls.filter(id=>id===actor)).toHaveLength(8);
 expect(fixture.authorCalls.filter(id=>id===good)).toHaveLength(10);expect(next).toBeUndefined();
});

it('retrieves an alternate creator before publishing another cached page of only the same author',async()=>{
 const actor='did:plc:dominant',other='did:plc:alternate',cursor=createRecommendationCursor([]);
 cursor.preferences={authors:{[actor]:8,[other]:8},terms:{},followedTopics:['science']};cursor.lime.done=false;fixture.limeSize=0;cursor.trending.done=true;
 cursor.authors={[actor]:{cursor:null,done:false},[other]:{cursor:null,done:false}};cursor.topicDiscovery={science:{feeds:[],positions:{},done:true}};
 const {recommendationQueries}=await import('@/lib/recommendations');cursor.topics=Object.fromEntries(recommendationQueries(cursor.preferences).map(term=>[term,{limePage:0,limeDone:true,blueCursor:null,blueDone:true,misskeyCursor:null,misskeyDone:true}]));
 cursor.remaining=Array.from({length:16},(_,i)=>({...source(`bsky:cached-dominant-${i}`,'科学の研究'),userId:actor,author:{id:actor,username:'dominant',displayName:'Dominant',bio:'',avatarUrl:'',coverUrl:'',createdAt:'2026-10-13'}}));
 fixture.authorDelay=300;
 fixture.authorRows[other]=Array.from({length:8},(_,i)=>({...source(`bsky:alternate-${i}`,'科学の研究'),userId:other}));
 const page=await getRecommendationPage(cursor,'viewer');
 expect(fixture.authorCalls).toContain(other);expect(fixture.authorCalls).not.toContain(actor);
 expect(new Set(page.posts.map(post=>post.userId)).size).toBe(2);
});
it('retains configured twitter sources beyond the former first-four cutoff and schedules one early',()=>{
 const handles=['one.bsky.social','two.bsky.social','three.bsky.social','four.bsky.social','Google@twitter.com'];
 const cursor=createRecommendationCursor(handles);expect(Object.keys(cursor.authors)).toHaveLength(5);expect(Object.keys(cursor.authors).slice(0,2)).toContain('Google@twitter.com');
});
it('discovers posts from twitter creators learned from likes',async()=>{
 const cursor=createRecommendationCursor([]);cursor.preferences={authors:{'x-user:123':10},terms:{},likedSamples:[],likedPostIds:[]} as any;
 fixture.authorRows['x-user:123']=[{...source('x:2100000000000000001','科学の研究'),source:'x',userId:'x-user:123'}];
 const page=await getRecommendationPage(cursor,'viewer');expect(fixture.authorCalls).toContain('x-user:123');expect(page.posts.map(post=>post.id)).toContain('x:2100000000000000001');
});

it('discovers relevant twitter art by followed topic without requiring a previously liked twitter creator',async()=>{
 fixture.followedTopics=['digital-illustration'];fixture.twitterDelay=400;
 fixture.twitterRows=[{...source('x:2110900000000000001','#ファンアート'),source:'x',userId:'x-user:artist',imageUrls:['https://images.example/art.jpg'],author:{id:'x-user:artist',username:'artist@twitter.com',bio:'イラストレーター'}},{...source('x:2110900000000000002','今日のペット #ファンアート'),source:'x',imageUrls:['https://images.example/pet.jpg'],recommendationVisual:checked('pets')}];
 const first=await getRecommendationPage(createRecommendationCursor([]),'viewer');
 expect(fixture.twitterCalls).toHaveLength(0);
 const page=await getRecommendationPage(first.next!,'viewer');
 expect(fixture.twitterCalls).toEqual([expect.objectContaining({term:'ファンアート',feed:'latest',preferAlternative:true})]);
 expect(page.posts.map(post=>post.id)).toContain('x:2110900000000000001');expect(page.posts.map(post=>post.id)).not.toContain('x:2110900000000000002');
 expect(page.posts.find(post=>post.id==='x:2110900000000000001')?.source).toBe('x');
});
it('includes preference lookup in the five-second page deadline',async()=>{
 vi.useFakeTimers();try{
 fixture.slowTopics=true;fixture.slowTrending=true;const cursor=createRecommendationCursor([]);cursor.lime.done=true;
 let settled=false;const pending=getRecommendationPage(cursor,'viewer').then(page=>{settled=true;return page;});
 await vi.advanceTimersByTimeAsync(4900);expect(settled).toBe(false);
 await vi.advanceTimersByTimeAsync(110);expect(settled).toBe(true);const page=await pending;expect(page.next?.trending.done).toBe(false);
 await vi.advanceTimersByTimeAsync(6000);
 }finally{vi.useRealTimers();}
});

it('waits for explicit follows on first load, resolves handle-only twitter rows, and reads follows only once',async()=>{
 vi.useFakeTimers();try{
 fixture.followedTopics=['digital-illustration'];fixture.followDelay=40;fixture.slowHistory=true;
 fixture.followRows=[{followee_id:null,external_provider:'x',external_handle:'artist',external_profile:null},{followee_id:null,external_provider:'x',external_handle:'other@twitter.com',external_profile:{id:'x-user:500'}}];
 const pending=getRecommendationPreferences('follow-viewer',()=>{});
 await vi.advanceTimersByTimeAsync(60);const prefs=await pending;
 expect(prefs.followedAuthors).toEqual(['artist@twitter.com','x-user:500']);
 expect(prefs.authors['artist@twitter.com']).toBe(3);expect(fixture.followReads).toBe(1);
 }finally{vi.useRealTimers();}
});
it('leaves twitter creator reads to the balanced loader instead of requesting the same creator twice',async()=>{
 const previous=createRecommendationCursor(['x-user:500']);previous.preferences={authors:{'x-user:500':3},terms:{},followedAuthors:['x-user:500']};
 await getRecommendationPage(previous,'viewer',undefined,{deferTwitter:true});
 expect(fixture.authorCalls).not.toContain('x-user:500');
});
it('pixel-only refresh preserves twitter continuation and consumed author budgets when native sources are exhausted',()=>{
 const cursor=createRecommendationCursor([]);cursor.lime.done=true;cursor.trending.done=true;
 cursor.twitterDone=false;cursor.twitterCursor={round:4,positions:{science:{cursor:'twitter-next',done:false}}};
 cursor.twitterAuthorCounts={'x-user:seen':3};cursor.authorCounts={'x-user:seen':3};
 cursor.twitterRemaining=[{...source('x:32100','科学の研究'),author:{id:'held-author',username:'held',displayName:'Held',bio:'',avatarUrl:'',coverUrl:'',createdAt:'2026-10-01'},source:'x',imageUrls:['https://images.example/held-science.jpg']}];
 const preferences={authors:{},terms:{},followedTopics:['science'] as any};
 cursor.preferences=preferences;cursor.topicDiscovery={science:{feeds:[],positions:{},done:true}};
 const visible={...source('bsky:science-visible','科学の研究'),author:{id:'visible-author',username:'visible',displayName:'Visible',bio:'',avatarUrl:'',coverUrl:'',createdAt:'2026-10-01'},imageUrls:['https://images.example/visible-science.jpg']};
 const page={posts:[visible],next:cursor,preferences,pendingAnalysis:false,requestKey:900};
 const refreshed=refreshRecommendationVisualPage(page,'pixel-state-viewer',{...visible,recommendationVisual:checked('science')},false);
 expect(refreshed.next?.twitterCursor).toEqual(cursor.twitterCursor);
 expect(refreshed.next?.twitterDone).toBe(false);
 expect(refreshed.next?.twitterRemaining).toEqual(cursor.twitterRemaining);
 expect(refreshed.next?.twitterAuthorCounts).toEqual({'x-user:seen':3});
 expect(refreshed.next?.authorCounts).toEqual({'x-user:seen':3});
 expect(page.next.twitterCursor.positions.science.cursor).toBe('twitter-next');
});
