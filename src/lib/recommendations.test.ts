import { recommendationFingerprint } from './recommendationIdentity';
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

it('excludes an actually viewed post on future fetches across visits',()=>{
  const now=Date.now();const candidate=post('repeat','猫の写真');const preferences={authors:{},terms:{猫:2}};
  recordRecommendationImpression('repeat','viewer',now);
  expect(rankRecommendations([candidate],preferences,'viewer',now)).toHaveLength(0);
  recordRecommendationImpression('repeat','viewer',now);
  expect(rankRecommendations([candidate],preferences,'viewer',now)).toHaveLength(0);
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
it('remembers the same media across copied IDs and CDN resize variants on later reloads',async()=>{
 const {recommendationFingerprint}=await import('./recommendationIdentity');
 const original={...post('original',''),imageUrls:['https://cdn.example/work.png?width=800']};
 recordRecommendationImpression(original.id,'viewer',Date.now(),recommendationFingerprint(original));
 const copied={...original,id:'copied',content:'キャプションを変えた再投稿',imageUrls:['https://cdn.example/work.png?width=400']};
 expect(rankRecommendations([copied],{authors:{},terms:{}},'viewer')).toHaveLength(0);
 expect(rankRecommendations([copied],{authors:{},terms:{}},'another-viewer')).toHaveLength(1);
});
it('merges canonical Bluesky URIs and excludes duplicate works across page history',()=>{
 const work={...post('alias',''),blueskyUri:'at://did:plc:artist/app.bsky.feed.post/work',imageUrls:['https://cdn.example/work.png']};
 expect(rankRecommendations([work,{...work,id:'bsky:at://did:plc:artist/app.bsky.feed.post/work'}],{authors:{},terms:{}},null)).toHaveLength(1);
 expect(rankRecommendations([{...work,id:'copy'}],{authors:{},terms:{}},null,Date.now(),[work])).toHaveLength(0);
});
it('uses the viewer’s own creator history across subjects rather than treating all topic posts as interchangeable',()=>{
 const prefs={authors:{favorite:20},recentAuthors:{favorite:20},terms:{},followedTopics:['music'] as any};
 const favorite={...post('favorite-work','','favorite'),recommendationTopics:['music']};
 const generic={...post('generic','','generic'),recommendationTopics:['music'],likesCount:100000};
 expect(rankRecommendations([generic,favorite],prefs,'viewer')[0].id).toBe('favorite-work');
});
it('recognizes the same Bluesky media blob shared by different creators and formats',async()=>{
 const {recommendationFingerprint}=await import('./recommendationIdentity');
 const a={...post('one',''),imageUrls:['https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:one/bafkreiexampleimage@jpeg']};
 const b={...post('two',''),imageUrls:['https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:two/bafkreiexampleimage@webp']};
 expect(recommendationFingerprint(a)).toBe(recommendationFingerprint(b));
 expect(rankRecommendations([a,b],{authors:{},terms:{}},'viewer')).toHaveLength(1);
});

it('removes the exact dismissed work, including resized copies, without banning its topic',()=>{
 const dismissed={...post('bsky:original','','artist'),imageUrls:['https://example.com/work.jpg?w=300'],recommendationTopics:['pets'] as any,languages:['ja']};
 const copy={...dismissed,id:'bsky:copy',imageUrls:['https://example.com/work.jpg?w=900']};
 const alternative={...post('bsky:other','','other'),imageUrls:['https://example.com/other.jpg'],recommendationTopics:['pets'] as any,languages:['ja']};
 const preferences={authors:{},terms:{},feedback:[{id:dismissed.id,userId:dismissed.userId,fingerprint:recommendationFingerprint(dismissed),createdAt:new Date().toISOString()}]};
 expect(rankRecommendations([dismissed,copy,alternative],preferences,'viewer').map(row=>row.id)).toEqual(['bsky:other']);
});
it('lowers similar image-only work from negative feedback across topics',()=>{
 const candidate={...post('bsky:new','','other'),imageUrls:['https://example.com/new.jpg'],recommendationVisual:{vector:Array.from({length:512},(_,i)=>i===0?1:0),topics:['pets'],confidence:1}} as any;
 const base={authors:{},terms:{}};
 expect(scoreRecommendation(candidate,{...base,feedback:[{id:'old',userId:'different',vector:Array.from({length:512},(_,i)=>i===0?1:0),createdAt:new Date().toISOString()}]},'viewer').total).toBeLessThan(scoreRecommendation(candidate,base,'viewer').total);
});

it.each(['music','science','digital-illustration'])('mixes a few related creators into a strongly preferred %s author without caption keywords',topic=>{
 const make=(id:string,author:string)=>({...post(id,'',author),imageUrls:[`https://example.com/${id}.jpg`],languages:['ja'],recommendationTopics:[topic],recommendationSources:[`feed:${topic}`],recommendationVisual:{version:1,kind:topic==='digital-illustration'?'moe':topic,topics:[topic],confidence:1,similarity:1,vector:Array.from({length:512},(_,i)=>i===0?1:0)}}) as any;
 const familiar=Array.from({length:30},(_,i)=>make(`favorite-${i}`,'favorite'));
 const neighbours=Array.from({length:6},(_,i)=>make(`related-${i}`,`new-${i}`));
 const prefs={authors:{favorite:100},recentAuthors:{favorite:100},terms:{},followedTopics:[topic] as any,likedSamples:[make('liked-reference','favorite')]};
 const ranked=rankRecommendations([...familiar,...neighbours],prefs,'viewer').slice(0,20);
 expect(ranked).toHaveLength(20);expect(ranked[0].userId).toBe('favorite');
 for(const index of [5,11,17])expect(ranked[index].userId).not.toBe('favorite');
 expect(ranked.filter(row=>row.userId==='favorite').length).toBeGreaterThan(10);
 expect(new Set(ranked.filter(row=>row.userId!=='favorite').map(row=>row.userId)).size).toBeGreaterThanOrEqual(3);
});
it('does not force unrelated or dismissed creators into discovery positions',()=>{
 const make=(id:string,author:string,topic='music')=>({...post(id,'',author),languages:['ja'],recommendationTopics:[topic],imageUrls:[`https://example.com/${id}.jpg`]}) as any;
 const favourite=Array.from({length:25},(_,i)=>make(`known-${i}`,'favorite'));
 const prefs={authors:{favorite:100},terms:{},followedTopics:['music'] as any,feedback:[{id:'old',userId:'dismissed',createdAt:new Date().toISOString()}]};
 const ranked=rankRecommendations([...favourite,make('unrelated','new','sports'),make('negative','dismissed')],prefs,'viewer').slice(0,20);
 expect(ranked.every(row=>row.userId==='favorite')).toBe(true);
});
it('keeps related-author choices diverse across page boundaries',()=>{
 const make=(id:string,author:string)=>({...post(id,'',author),languages:['ja'],recommendationTopics:['science'],imageUrls:[`https://example.com/${id}.jpg`],recommendationVisual:{version:1,kind:'science',topics:['science'],confidence:1,similarity:1,vector:Array.from({length:512},(_,i)=>i===0?1:0)}}) as any;
 const prefs={authors:{favorite:100},terms:{},followedTopics:['science'] as any,likedSamples:[make('liked-reference','favorite')]};
 const history=Array.from({length:20},(_,i)=>make(`previous-${i}`,i===5?'already-related':'favorite'));
 const rows=[...Array.from({length:25},(_,i)=>make(`next-${i}`,'favorite')),make('old-related','already-related'),...Array.from({length:4},(_,i)=>make(`new-related-${i}`,`new-${i}`))];
 const ranked=rankRecommendations(rows,prefs,'viewer',Date.now(),history).slice(0,20);
 expect(ranked[5].userId).not.toBe('already-related');expect(ranked[5].userId).not.toBe('favorite');
});

it('does not use a shared broad feed or topic alone to force unclassified images into related slots',()=>{
 const make=(id:string,author:string)=>({...post(id,'',author),languages:['ja'],imageUrls:[`https://example.com/${id}.jpg`],recommendationTopics:['art'],recommendationSources:['broad-art-feed']}) as any;
 const liked=make('liked','favorite'),prefs={authors:{favorite:100},terms:{},followedTopics:['art'] as any,likedSamples:[liked]};
 const rows=[...Array.from({length:25},(_,i)=>make(`known-${i}`,'favorite')),...Array.from({length:5},(_,i)=>make(`unknown-${i}`,`new-${i}`))];
 expect(rankRecommendations(rows,prefs,'viewer').slice(0,20).every(row=>row.userId==='favorite')).toBe(true);
});
it.each(['music','science','art'])('uses negative image evidence to reject similar %s works even from a new author',topic=>{
 const vector=Array.from({length:512},(_,i)=>i===0?1:0);
 const row={...post('new-work','','new-author'),languages:['ja'],imageUrls:['https://example.com/next.jpg'],recommendationVisual:{version:1,kind:topic,topics:[topic],confidence:1,similarity:1,vector}} as any;
 const prefs={authors:{'new-author':100},terms:{},followedTopics:[topic] as any,feedback:[{id:'dismissed-work',userId:'old-author',vector,createdAt:new Date().toISOString()}]};
 expect(rankRecommendations([row],prefs,'viewer')).toEqual([]);
});
it('excludes repeatedly dismissed authors while allowing a later explicit like to supersede older dismissals',()=>{
 const now=Date.now(),row={...post('next','猫','author'),languages:['ja']};
 const feedback=[{id:'bad-1',userId:'author',createdAt:new Date(now-2000).toISOString()},{id:'bad-2',userId:'author',createdAt:new Date(now-1000).toISOString()}];
 const prefs={authors:{author:100},terms:{},feedback};
 expect(rankRecommendations([row],prefs,'viewer',now)).toEqual([]);
 expect(rankRecommendations([row],{...prefs,likedSamples:[{...post('liked','猫','author'),engagedAt:new Date(now).toISOString()}]},'viewer',now)).toHaveLength(1);
});

it('retains repeated negative author feedback until a newer explicit like rather than expiring it',()=>{
 const now=Date.now(),row={...post('new','猫','old-disliked-author'),languages:['ja']};
 const feedback=['one','two'].map((id,i)=>({id,userId:row.userId,createdAt:new Date(now-(180+i)*86400000).toISOString()}));
 expect(rankRecommendations([row],{authors:{[row.userId]:100},terms:{},feedback},'viewer',now)).toEqual([]);
});

it('reserves delivered IDs and image copies briefly in this document, per viewer',async()=>{
 const {recordRecommendationDelivery}=await import('./recommendations');
 const work={...post('delivered','', 'liked-author'),imageUrls:['https://cdn.example/art.png']};
 const prefs={authors:{'liked-author':4},terms:{}};
 const now=Date.now();recordRecommendationDelivery([work],'delivery-viewer',now);
 expect(rankRecommendations([work,{...work,id:'other-copy'}],prefs,'delivery-viewer')).toEqual([]);
 expect(rankRecommendations([work],prefs,'different-viewer')).toHaveLength(1);
 expect(rankRecommendations([work],prefs,'delivery-viewer',now+120001)).toHaveLength(1);
});
it('does not treat legacy persisted delivery records as actual views',()=>{
 const work={...post('unseen','猫','favorite'),imageUrls:['https://cdn.example/unseen.png']};
 const viewer='legacy-delivery-viewer',prefs={authors:{favorite:4},terms:{}};
 localStorage.setItem(`lime_recommendation_deliveries:${viewer}`,JSON.stringify({[work.id]:{at:Date.now(),userId:work.userId,fingerprint:recommendationFingerprint(work)}}));
 expect(rankRecommendations([work],prefs,viewer)).toHaveLength(1);
 recordRecommendationImpression(work.id,viewer,Date.now(),recommendationFingerprint(work));
 expect(rankRecommendations([work],prefs,viewer)).toEqual([]);
});
it('limits creator runs to three across page boundaries without filling with unrelated posts',async()=>{
 const {selectRecommendationPage}=await import('./recommendations');
 const works=Array.from({length:12},(_,i)=>post(`favorite-${i}`,'science','favorite'));
 const other=post('other','science','other');
 const prefs={authors:{favorite:8,other:4},terms:{}};
 const selected=selectRecommendationPage([...works,other],prefs,works.slice(0,3));
 expect(selected.posts[0].userId).toBe('other');expect(selected.posts).toHaveLength(4);
 expect(selected.blocked).toBe(true);expect(selected.remaining).toHaveLength(9);
});
it('visual enrichment preserves the original like date instead of overriding a later dismissal',()=>{
 const old=post('old-like','','artist');
 recordRecommendationLike(old,true,'viewer','2026-05-01T00:00:00Z');
 const enriched={...old,recommendationVisual:{version:1 as const,kind:'science',topics:['science'] as any,confidence:.8,similarity:.3,vector:Array(512).fill(.01)}};
 recordRecommendationLike(enriched,true,'viewer','2026-05-01T00:00:00Z');
 expect(readRecommendationLikes('viewer')[0].engagedAt).toBe('2026-05-01T00:00:00Z');
 const prefs={authors:{artist:30},terms:{},likedSamples:readRecommendationLikes('viewer'),feedback:[1,2].map(i=>({id:`negative-${i}`,userId:'artist',createdAt:'2026-10-09T00:00:00Z'}))};
 expect(rankRecommendations([post('new-work','','artist')],prefs,'viewer')).toEqual([]);
});
it.each(['science','music','pets','digital-illustration'] as const)('uses repeated negative image neighbors for %s rather than caption words',async topic=>{
 const {recommendationIsDismissed}=await import('./recommendations');
 const vec=(a:number,b:number)=>[a,b,...Array(510).fill(0)];
 const visual={version:1 as const,kind:topic,topics:[topic],confidence:.9,similarity:.3,vector:vec(1,0)};
 const candidate={...post('candidate','', 'new-creator'),imageUrls:['https://example.com/candidate.jpg'],recommendationVisual:visual};
 const feedback=[1,2,3].map(i=>({id:`negative-${i}`,userId:`unwanted-${i}`,vector:vec(.75,Math.sqrt(1-.75**2)),createdAt:'2026-10-01T00:00:00Z'}));
 expect(recommendationIsDismissed(candidate,{authors:{},terms:{},feedback,visualInterests:[vec(0,1)]})).toBe(true);
 expect(recommendationIsDismissed(candidate,{authors:{},terms:{},feedback:feedback.slice(0,1),visualInterests:[vec(0,1)]})).toBe(false);
 expect(recommendationIsDismissed(candidate,{authors:{},terms:{},feedback,visualInterests:[vec(.9,Math.sqrt(1-.9**2))]})).toBe(false);
});

it('does not fill followed topic recommendations with unrelated Japanese discovery',()=>{
 const candidates=[post('unrelated','今日は良い天気ですね','stranger'),post('related','猫の写真','pet-author'),{...post('media','', 'known-creator'),imageUrls:['art.jpg']}];
 const ranked=rankRecommendations(candidates,{authors:{'known-creator':3},terms:{},followedTopics:['pets']},'viewer');
 expect(ranked.map(row=>row.id)).toEqual(expect.arrayContaining(['related','media']));
 expect(ranked.map(row=>row.id)).not.toContain('unrelated');
});
it('keeps keyword-free posts with followed source context across topics',()=>{
 for(const topic of ['science','sports','food','music','art'] as const){
  const media={...post('media',''),imageUrls:['media.jpg'],recommendationTopics:[topic]};
  expect(rankRecommendations([media],{authors:{},terms:{},followedTopics:[topic]},'viewer')).toHaveLength(1);
 }
});

it('rejects an author immediately even when older likes have high weights',()=>{
 const candidate=post('different-work','', 'rejected');
 expect(rankRecommendations([candidate],{authors:{rejected:1000},terms:{},feedback:[{id:'rejected-work',userId:'rejected',createdAt:new Date().toISOString()}]},'viewer')).toEqual([]);
});
it.each(['digital-illustration','food','sports','music'] as const)('repeated %s dismissals cannot be filled by unverified image creators',topic=>{
 const now=new Date().toISOString();
 const unknown={...post('unknown','', 'stranger'),imageUrls:['unknown.jpg'],recommendationTopics:[topic],languages:['ja']};
 const familiar={...unknown,id:'familiar',userId:'liked-creator',imageUrls:['familiar.jpg']};
 const preferences={authors:{'liked-creator':5},terms:{},followedTopics:[topic],feedback:[1,2,3].map(i=>({id:`negative-${i}`,userId:`bad-${i}`,topics:[topic],createdAt:now}))};
 expect(rankRecommendations([unknown,familiar],preferences,'viewer').map(row=>row.id)).toEqual(['familiar']);
});

it('retains older distinct authors as references instead of only the latest prolific author',async()=>{
 const {selectRecommendationLikeSamples}=await import('./recommendations');
 const recent=Array.from({length:200},(_,i)=>({...post(`recent-${i}`,'','prolific'),imageUrls:['https://images.example/recent.jpg'],engagedAt:new Date(Date.now()-i*1000).toISOString()}));
 const older=Array.from({length:80},(_,i)=>({...post(`older-${i}`,'',`artist-${i}`),imageUrls:['https://images.example/older.jpg'],engagedAt:new Date(Date.now()-86400000-i*1000).toISOString()}));
 const samples=selectRecommendationLikeSamples([...recent,...older]);
 expect(samples).toHaveLength(128);expect(new Set(samples.map(row=>row.userId)).size).toBe(81);
 expect(samples.some(row=>row.id==='older-79')).toBe(true);
});


it('learns creator topics from a liked keyword-free image and preserves them in compact history',async()=>{
 const {selectRecommendationLikeSamples}=await import('./recommendations');
 const liked={...post('liked-image','','did:plc:favorite'),imageUrls:['https://images.example/liked.jpg'],languages:['ja'],recommendationAuthorTopics:['digital-illustration'],recommendationSources:['creator:did:plc:favorite']};
 const preferences:import('./recommendations').RecommendationPreferences={authors:{},terms:{},followedTopics:['digital-illustration']};
 const samples=selectRecommendationLikeSamples([liked]);
 expect(samples[0].recommendationAuthorTopics).toEqual(['digital-illustration']);
 expect(samples[0].recommendationSources).toEqual(liked.recommendationSources);
 addRecommendationInterest(preferences,samples[0],4);
 expect(preferences.authorTopics?.[liked.userId]?.['digital-illustration']).toBe(4);
 const candidate={...liked,id:'new-image',imageUrls:['https://images.example/new.jpg'],recommendationAuthorTopics:undefined,recommendationSources:undefined};
 expect(rankRecommendations([candidate],preferences,'viewer').map(row=>row.id)).toEqual(['new-image']);
});
it('does not replace confident visual evidence with a liked creators broader topic hint',()=>{
 const preferences:import('./recommendations').RecommendationPreferences={authors:{},terms:{}};
 addRecommendationInterest(preferences,{userId:'artist',recommendationAuthorTopics:['digital-illustration'],recommendationVisual:{version:1,kind:'food',topics:['food'],confidence:.9,similarity:.5,vector:Array(512).fill(0)}},4);
 expect(preferences.authorTopics?.artist.food).toBe(4);
 expect(preferences.authorTopics?.artist['digital-illustration']).toBeUndefined();
});

 it('bounds scoring work with a large preference profile on successive small pages',()=>{
 const vector=(seed:number)=>Array.from({length:512},(_,i)=>i===seed%512?1:0);
 const make=(id:string,i:number)=>({...post(id,`猫の写真 ${i}`,`author-${i}`),languages:['ja'],imageUrls:[`https://example.com/${id}.jpg`],recommendationVisual:{version:1,kind:'pets',topics:['pets'],confidence:.9,similarity:1,vector:vector(i)}}) as any;
 const samples=Array.from({length:128},(_,i)=>make(`liked-${i}`,i));
 const prefs={authors:{},terms:Object.fromEntries(Array.from({length:10000},(_,i)=>[`word${i}`,i+1])),likedSamples:samples,visualInterests:samples.map(post=>post.recommendationVisual.vector),feedback:Array.from({length:200},(_,i)=>({id:`bad-${i}`,userId:`bad-author-${i}`,createdAt:new Date().toISOString(),vector:vector(i+256)}))};
 for(let page=0;page<6;page++){
  const started=performance.now();const ranked=rankRecommendations(Array.from({length:32},(_,i)=>make(`page-${page}-${i}`,i)),prefs,'viewer',Date.now(),[],40);expect(ranked).toHaveLength(32);
  console.log(`scoring small page ${page+1}: ${Math.round(performance.now()-started)} ms`);
  expect(performance.now()-started).toBeLessThan(1000);
 }
 });
