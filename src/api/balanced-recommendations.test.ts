import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({native:vi.fn(),twitter:vi.fn(),prefs:vi.fn()}));
vi.mock('./recommendations',async original=>({...await original<typeof import('./recommendations')>(),getRecommendationPage:(...args:unknown[])=>mocks.native(...args),getRecommendationPreferences:(...args:unknown[])=>mocks.prefs(...args)}));
vi.mock('./recommendation-twitter',()=>({getRecommendationTwitterPage:(...args:unknown[])=>mocks.twitter(...args)}));
import {getBalancedRecommendationPage} from './balanced-recommendations';
import {createRecommendationCursor} from './recommendations';
const prefs={authors:{},terms:{},followedTopics:['science'] as any};
const post=(id:string)=>({id,userId:id,content:'科学の研究',recommendationTopics:['science'],languages:['ja'],imageUrls:['https://images.example/'+id+'.jpg'],recommendationVisual:{version:1,classifierVersion:3,kind:'science',topics:['science'],confidence:.9,similarity:.5,vector:Array.from({length:512},(_,i)=>Number(i===0))},source:id.startsWith('x:')?'x':'bluesky',createdAt:new Date().toISOString(),likesCount:1,commentsCount:0,repostsCount:0,author:{id,username:id}}) as any;
beforeEach(()=>{vi.resetAllMocks();localStorage.clear();mocks.prefs.mockResolvedValue(prefs);});
it('starts with twitter and commits 4 + 4 on the first page, retaining unseen work for a balanced second page',async()=>{
 const blues=Array.from({length:12},(_,i)=>post('bsky:'+i)),tweets=Array.from({length:12},(_,i)=>post('x:'+String(900+i)));
 mocks.native.mockImplementation(async(previous:any)=>{const rows=previous.lime.page===0?blues.slice(0,8):[...previous.remaining,...blues.slice(8)];const cursor={...previous,lime:{page:1,done:true},remaining:[],history:[...previous.history,...rows],seen:[...previous.seen,...rows.map((post:any)=>post.id)]};return {posts:rows,next:cursor,preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:previous.lime.page+1};});
 mocks.twitter.mockResolvedValueOnce({posts:tweets.slice(0,6),next:{positions:{science:{cursor:'6',done:false}},round:1}}).mockResolvedValueOnce({posts:tweets.slice(6),next:undefined});
 const first=await getBalancedRecommendationPage(createRecommendationCursor([]),'viewer');expect(first.posts.map(post=>post.source)).toEqual(['x','bluesky','x','bluesky','x','bluesky','x','bluesky']);expect(first.next?.remaining).toHaveLength(4);expect(first.next?.seen).not.toContain('bsky:4');
 const second=await getBalancedRecommendationPage(first.next!,'viewer');expect(second.posts.filter(post=>post.source==='x')).toHaveLength(4);expect(second.posts.filter(post=>post.source==='bluesky')).toHaveLength(4);expect(new Set([...first.posts,...second.posts].map(post=>post.id)).size).toBe(16);expect(second.posts.some(post=>post.id==='bsky:4')).toBe(true);
});
it('does not commit a Bluesky-only first page while the healthy twitter read is still pending',async()=>{
 mocks.native.mockResolvedValue({posts:[post('bsky:one')],preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:1});let release!:(page:any)=>void;mocks.twitter.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));let settled=false;
 const pending=getBalancedRecommendationPage(createRecommendationCursor([]),'viewer').then(page=>{settled=true;return page;});await new Promise(resolve=>setTimeout(resolve,20));expect(settled).toBe(false);release({posts:[post('x:999')],next:undefined});const page=await pending;expect(page.posts.map(post=>post.source)).toEqual(['x','bluesky']);
});
it('does not pad with irrelevant twitter candidates just to satisfy the provider ratio',async()=>{
 mocks.native.mockResolvedValue({posts:Array.from({length:8},(_,i)=>post('bsky:'+i)),preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:1});mocks.twitter.mockResolvedValue({posts:[{...post('x:999'),content:'猫の写真',recommendationTopics:['pets'],recommendationVisual:{version:1,classifierVersion:3,kind:'pets',topics:['pets'],confidence:.9,similarity:.5,vector:Array.from({length:512},(_,i)=>Number(i===1))}}],next:undefined});
 const page=await getBalancedRecommendationPage(createRecommendationCursor([]),'viewer');expect(page.posts.every(post=>post.source==='bluesky')).toBe(true);expect(page.posts).toHaveLength(2);
 expect(page.next?.remaining).toHaveLength(6);expect(page.twitterError).toBeNull();
});
it('keeps twitter available when the native/Bluesky sources fail',async()=>{
 mocks.native.mockRejectedValue(new Error('Bluesky unavailable'));mocks.twitter.mockResolvedValue({posts:[post('x:991')],next:undefined});
 const page=await getBalancedRecommendationPage(createRecommendationCursor([]),'viewer');expect(page.posts.map(post=>post.id)).toEqual(['x:991']);expect(page.next).toBeDefined();
});
it('uses one slot per twitter creator when other relevant creators are available',async()=>{
 mocks.native.mockResolvedValue({posts:Array.from({length:8},(_,i)=>post('bsky:'+i)),preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:1});
 mocks.twitter.mockResolvedValue({posts:[...Array.from({length:4},(_,i)=>({...post('x:'+String(910+i)),userId:'favorite'})),post('x:920'),post('x:921')],next:undefined});
 const page=await getBalancedRecommendationPage(createRecommendationCursor([]),'viewer');expect(page.posts.filter(post=>post.userId==='favorite')).toHaveLength(1);expect(page.posts.filter(post=>post.source==='x')).toHaveLength(3);expect(page.posts.filter(post=>post.source==='bluesky')).toHaveLength(3);
});
it('retains completed twitter candidates and the last committed cursor when a later read exceeds the deadline',async()=>{
 vi.useFakeTimers();try{
 mocks.native.mockResolvedValue({posts:Array.from({length:8},(_,i)=>post('bsky:'+i)),preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:1});
 const cursor={positions:{science:{cursor:'committed',done:false}},round:1};mocks.twitter.mockResolvedValueOnce({posts:[post('x:980'),post('x:981')],next:cursor}).mockImplementationOnce(()=>new Promise(()=>{}));
 const previous=createRecommendationCursor([]);previous.pageKey=90;
 const pending=getBalancedRecommendationPage(previous,'viewer');await vi.advanceTimersByTimeAsync(5010);const page=await pending;
 expect(page.posts.filter(post=>post.source==='x')).toHaveLength(2);expect(page.posts.filter(post=>post.source==='bluesky')).toHaveLength(2);expect(page.next?.twitterCursor).toEqual(cursor);expect(page.twitterError?.name).toBe('TimeoutError');
 }finally{vi.useRealTimers();}
});
it('cancels promptly when leaving the feed even if a provider does not settle its promise',async()=>{
 mocks.native.mockResolvedValue({posts:[],preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:1});mocks.twitter.mockImplementationOnce(()=>new Promise(()=>{}));
 const controller=new AbortController(),pending=getBalancedRecommendationPage(createRecommendationCursor([]),'viewer',controller.signal);await Promise.resolve();await Promise.resolve();controller.abort('left feed');await expect(pending).rejects.toBe('left feed');
});
it('balances the cumulative scroll through twenty sparse twitter pages, without replaying old results',async()=>{
 let nativeRead=0,twitterRead=0;
 const oldest=post('x:10000');
 mocks.native.mockImplementation(async(previous:any)=>{
  const rows=[...previous.remaining,...Array.from({length:8},(_,i)=>post('bsky:long-'+nativeRead+'-'+i))];nativeRead++;
  return {posts:rows.slice(0,8),next:{...previous,lime:{page:nativeRead,done:false},remaining:rows.slice(8),seen:[...previous.seen,...rows.slice(0,8).map((p:any)=>p.id)]},preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:nativeRead};
 });
 mocks.twitter.mockImplementation(async()=>{const id=twitterRead++;return {posts:[oldest,post('x:'+String(11000+id))],next:{positions:{science:{cursor:String(id),done:false}},round:id+1}};});
 let cursor=createRecommendationCursor([]);const shown:any[]=[];
 for(let i=0;i<20;i++){
  const page=await getBalancedRecommendationPage(cursor,'long-scroll-viewer');shown.push(...page.posts);cursor=page.next!;
  expect(page.posts.filter(p=>p.source==='bluesky')).toHaveLength(page.posts.filter(p=>p.source==='x').length);
  expect(page.posts.every((p,index)=>index===0||p.source!==page.posts[index-1].source)).toBe(true);
 }
 expect(new Set(shown.map(p=>p.id)).size).toBe(shown.length);
 expect(shown.filter(p=>p.id===oldest.id)).toHaveLength(1);
 expect(shown.filter(p=>p.source==='x').length/shown.length).toBeGreaterThan(.45);
 expect(twitterRead).toBeLessThanOrEqual(60);
});
it('applies creator limits across pages and retains overflow rather than filling slots with that same creator',async()=>{
 const tweets=Array.from({length:14},(_,i)=>({...post('x:'+String(13000+i)),userId:i<10?'prolific':'other-'+i}));
 mocks.twitter.mockResolvedValue({posts:tweets,next:undefined});
 mocks.native.mockImplementation(async(previous:any)=>({posts:Array.from({length:8},(_,i)=>post('bsky:authors-'+(previous.pageKey??0)+'-'+i)),next:{...previous,remaining:[]},preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:(previous.pageKey??0)+1}));
 const first=await getBalancedRecommendationPage(createRecommendationCursor([]),'author-limit-viewer');
 const second=await getBalancedRecommendationPage(first.next!,'author-limit-viewer');
 const counts=[first,second].map(page=>page.posts.filter(p=>p.userId==='prolific').length);
 expect(Math.max(...counts)).toBeLessThanOrEqual(2);expect(counts[0]+counts[1]).toBeLessThanOrEqual(3);
 expect(second.next?.twitterRemaining.filter(p=>p.userId==='prolific')).toHaveLength(10-counts[0]-counts[1]);
});
it('does not repeat a persisted viewed twitter work after starting a fresh cursor',async()=>{
 const {recordRecommendationImpression}=await import('@/lib/recommendations');
 recordRecommendationImpression('x:15000','repeat-viewer');
 mocks.native.mockResolvedValue({posts:[],preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:1});
 mocks.twitter.mockResolvedValue({posts:[post('x:15000'),post('x:15001')],next:undefined});
 const page=await getBalancedRecommendationPage(createRecommendationCursor([]),'repeat-viewer');
 expect(page.posts.map(p=>p.id)).toEqual(['x:15001']);
});
it('treats exhausted related twitter candidates as normal without a false failure warning',async()=>{
 mocks.twitter.mockResolvedValue({posts:[post('x:18000')],next:undefined});
 mocks.native.mockImplementation(async(previous:any)=>({posts:[...previous.remaining,...Array.from({length:8},(_,i)=>post('bsky:scarce-'+i))],next:{...previous,remaining:[]},preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:1}));
 const first=await getBalancedRecommendationPage(createRecommendationCursor([]),'scarce-viewer');
 const second=await getBalancedRecommendationPage(first.next!,'scarce-viewer');
 expect(first.posts.filter(p=>p.source==='bluesky')).toHaveLength(1);
 expect(second.posts).toHaveLength(0);expect(second.twitterError).toBeNull();
 expect(second.next?.remaining.length).toBeGreaterThan(0);
});
it.each(['twitter','bluesky'])('buffers the faster provider when %s initially has no usable page, then emits a mixed page',async slow=>{
 let nativeRead=0,twitterRead=0;
 mocks.native.mockImplementation(async(previous:any)=>{
  const key=++nativeRead;
  const rows=slow==='bluesky'&&key===1?[]:[...previous.remaining,...Array.from({length:4},(_,i)=>post('bsky:paired-'+i))];
  return {posts:rows,next:{...previous,lime:{page:key,done:false},remaining:[],seen:[...previous.seen,...rows.map((p:any)=>p.id)]},preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:key};
 });
 mocks.twitter.mockImplementation(async()=>{
  const key=++twitterRead;
  return {posts:slow==='twitter'&&key<=3?[]:Array.from({length:4},(_,i)=>post('x:'+String(20000+i))),next:{positions:{science:{cursor:String(key),done:false}},round:key}};
 });
 const first=await getBalancedRecommendationPage(createRecommendationCursor([]),'delayed-'+slow);
 expect(first.posts).toEqual([]);expect(first.next).toBeDefined();
 if(slow==='twitter')expect(first.next!.remaining).toHaveLength(4);else expect(first.next!.twitterRemaining).toHaveLength(4);
 const second=await getBalancedRecommendationPage(first.next!,'delayed-'+slow);
 expect(second.posts.map(p=>p.source)).toEqual(['x','bluesky','x','bluesky','x','bluesky','x','bluesky']);
});
it('does not compensate for old provider imbalance by returning a one-provider batch',async()=>{
 const previous=createRecommendationCursor([]);previous.providerTotals={twitter:0,other:20};
 mocks.native.mockResolvedValue({posts:Array.from({length:4},(_,i)=>post('bsky:debt-'+i)),preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:1});
 mocks.twitter.mockResolvedValue({posts:Array.from({length:4},(_,i)=>post('x:'+String(21000+i))),next:undefined});
 const page=await getBalancedRecommendationPage(previous,'debt-viewer');
 expect(page.posts.map(p=>p.source)).toEqual(['x','bluesky','x','bluesky','x','bluesky','x','bluesky']);
});
it('never resets a discovery creator budget after twelve intervening posts',async()=>{
 let request=0;
 mocks.native.mockImplementation(async(previous:any)=>({posts:Array.from({length:8},(_,i)=>post('bsky:budget-'+request+'-'+i)),next:{...previous,remaining:[]},preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:++request}));
 mocks.twitter.mockImplementation(async()=>({posts:Array.from({length:6},(_,i)=>({...post('x:'+String(22000+request*100+i)),userId:'repeat-artist'})),next:{positions:{science:{cursor:String(request),done:false}},round:request}}));
 let cursor=createRecommendationCursor([]);const emitted:any[]=[];
 for(let page=0;page<20;page++){
  const result=await getBalancedRecommendationPage(cursor,'creator-budget-viewer');emitted.push(...result.posts);cursor=result.next!;
  expect(result.posts.filter(p=>p.userId==='repeat-artist').length).toBeLessThanOrEqual(1);
 }
 expect(emitted.filter(p=>p.userId==='repeat-artist')).toHaveLength(3);
 expect(cursor.twitterAuthorCounts?.['repeat-artist']).toBe(3);
 expect(mocks.twitter).toHaveBeenLastCalledWith(expect.anything(),expect.anything(),expect.anything(),'creator-budget-viewer',expect.objectContaining({'repeat-artist':expect.any(String)}));
});
it('prioritizes a relevant followed creator, excludes their unrelated work, and still limits each load to one work per creator',async()=>{
 const prefsWithFollow={...prefs,followedAuthors:['followed@twitter.com']};mocks.prefs.mockResolvedValue(prefsWithFollow);
 mocks.native.mockResolvedValue({posts:Array.from({length:4},(_,i)=>post('bsky:follow-'+i)),preferences:prefsWithFollow,pendingAnalysis:false,automaticPaused:false,requestKey:1});
 const followed={...post('x:24000'),userId:'x-user:followed',author:{id:'x-user:followed',username:'followed@twitter.com'}};
 const unrelated={...followed,id:'x:24001',content:'猫の写真',recommendationTopics:['pets'],recommendationVisual:{...followed.recommendationVisual,kind:'pets',topics:['pets']},imageUrls:['https://images.example/cat.jpg']};
 mocks.twitter.mockResolvedValue({posts:[...Array.from({length:6},(_,i)=>post('x:'+String(24100+i))),unrelated,followed],next:undefined});
 const page=await getBalancedRecommendationPage(createRecommendationCursor([]),'follow-ranking-viewer');
 expect(page.posts[0].id).toBe(followed.id);expect(page.posts.some(p=>p.id===unrelated.id)).toBe(false);
 expect(page.posts.filter(p=>p.userId===followed.userId)).toHaveLength(1);
});
it('applies diversity budgets to Bluesky too, without letting a single creator consume every native slot',async()=>{
 let request=0;
 mocks.native.mockImplementation(async(previous:any)=>{
  const key=++request;
  const rows=[...Array.from({length:8},(_,i)=>({...post('bsky:dominant-'+key+'-'+i),userId:'dominant-blue'})),...Array.from({length:4},(_,i)=>post('bsky:variety-'+key+'-'+i))];
  return {posts:rows,next:{...previous,remaining:[]},preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:key};
 });
 mocks.twitter.mockImplementation(async()=>({posts:Array.from({length:4},(_,i)=>post('x:'+String(33000+request*10+i))),next:{positions:{science:{cursor:String(request),done:false}},round:request}}));
 let cursor=createRecommendationCursor([]);const emitted:any[]=[];
 for(let page=0;page<6;page++){
  const result=await getBalancedRecommendationPage(cursor,'both-creators-viewer');
  expect(result.posts.filter(p=>p.userId==='dominant-blue').length).toBeLessThanOrEqual(1);
  expect(result.posts.filter(p=>p.source==='bluesky')).toHaveLength(result.posts.filter(p=>p.source==='x').length);
  emitted.push(...result.posts);cursor=result.next!;
 }
 expect(emitted.filter(p=>p.userId==='dominant-blue')).toHaveLength(3);
 expect(cursor.authorCounts?.['dominant-blue']).toBe(3);
});
it('waits for pixels before committing either service, even when captions claim a followed topic',async()=>{
 const inference=await import('@/lib/recommendationVisualInference');
 const unchecked=[post('x:42000'),post('bsky:unchecked')].map(p=>({...p,recommendationVisual:undefined}));
 mocks.native.mockResolvedValue({posts:[unchecked[1]],preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:1});
 mocks.twitter.mockResolvedValue({posts:[unchecked[0]],next:undefined});
 let release!:(rows:any[])=>void;const analyze=vi.spyOn(inference,'enrichRecommendationVisuals').mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 try{
  let committed=false;const pending=getBalancedRecommendationPage(createRecommendationCursor([]),'before-pixels').then(page=>{committed=true;return page;});
  await vi.waitFor(()=>expect(analyze).toHaveBeenCalled());expect(committed).toBe(false);
  release(unchecked.map(p=>({...p,recommendationVisual:post('pixel').recommendationVisual,recommendationVisualStatus:'checked'})));
  const page=await pending;expect(page.posts.map(p=>p.source)).toEqual(['x','bluesky']);
 }finally{analyze.mockRestore();}
});
it('keeps each delivered page balanced after rejecting three visually unrelated Bluesky images',async()=>{
 const blues=Array.from({length:4},(_,i)=>post('bsky:render-'+i));
 for(const p of blues.slice(0,3))p.recommendationVisual={...p.recommendationVisual,kind:'render-3d',topics:[]};
 mocks.native.mockResolvedValue({posts:blues,preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:1});
 mocks.twitter.mockResolvedValue({posts:Array.from({length:4},(_,i)=>post('x:'+String(43000+i))),next:undefined});
 const page=await getBalancedRecommendationPage(createRecommendationCursor([]),'post-image-balance');
 expect(page.posts.map(p=>p.source)).toEqual(['x','bluesky']);
 expect(page.next?.twitterRemaining).toHaveLength(3);
 expect(page.posts.some(p=>p.recommendationVisual?.kind==='render-3d')).toBe(false);
});
it('still reports a genuine twitter transport failure instead of suppressing every warning',async()=>{
 const error=new Error('network unavailable');mocks.twitter.mockRejectedValue(error);
 mocks.native.mockResolvedValue({posts:[post('bsky:network')],preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:1});
 const page=await getBalancedRecommendationPage(createRecommendationCursor([]),'network-warning');
 expect(page.twitterError).toBe(error);
});
it('clears a failed source warning when another twitter source succeeds in the same load',async()=>{
 mocks.native.mockResolvedValue({posts:[post('bsky:recovered')],preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:1});
 mocks.twitter.mockResolvedValueOnce({posts:[],error:new Error('one source unavailable'),next:{round:1,positions:{},authors:{}}}).mockResolvedValueOnce({posts:[post('x:61000')],next:undefined});
 const page=await getBalancedRecommendationPage(createRecommendationCursor([]),'recovered-warning');
 expect(page.posts.map(p=>p.source)).toEqual(['x','bluesky']);expect(page.twitterError).toBeNull();
});
it('does not warn when a successful fetch has only visually unrelated twitter candidates',async()=>{
 mocks.native.mockResolvedValue({posts:[post('bsky:visual-filter')],preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:1});
 const unrelated={...post('x:62000'),recommendationVisual:{...post('pixel').recommendationVisual,kind:'animal-illustration',topics:['art','pets']}};
 mocks.twitter.mockResolvedValue({posts:[unrelated],next:undefined});
 const page=await getBalancedRecommendationPage(createRecommendationCursor([]),'visual-filter-warning');
 expect(page.posts.every(p=>p.source!=='x')).toBe(true);expect(page.twitterError).toBeNull();
});
it('does not mistake a skipped cooldown source for recovery from a genuine failure',async()=>{
 const error=new Error('temporary source failure');
 mocks.native.mockResolvedValue({posts:[],preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:1});
 mocks.twitter.mockResolvedValueOnce({attempted:true,posts:[],error,next:{round:1,positions:{}}}).mockResolvedValueOnce({attempted:false,posts:[],next:undefined});
 const page=await getBalancedRecommendationPage(createRecommendationCursor([]),'cooldown-warning');
 expect(page.twitterError).toBe(error);
});
it('analyzes only the first two unknown images per service before first display and retains the rest',async()=>{
 const inference=await import('@/lib/recommendationVisualInference');
 const tweets=Array.from({length:4},(_,i)=>({...post('x:'+String(71000+i)),recommendationVisual:undefined}));
 const blues=Array.from({length:4},(_,i)=>({...post('bsky:cold-'+i),recommendationVisual:undefined}));
 mocks.native.mockResolvedValue({posts:blues,preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:1});
 mocks.twitter.mockResolvedValue({posts:tweets,next:undefined});
 const analyze=vi.spyOn(inference,'enrichRecommendationVisuals').mockImplementationOnce(async rows=>rows.map(row=>({...row,recommendationVisual:post('pixel').recommendationVisual,recommendationVisualStatus:'checked'})));
 try{
  const page=await getBalancedRecommendationPage(createRecommendationCursor([]),'cold-budget');
  expect(analyze.mock.calls[0][0]).toHaveLength(4);
  expect(page.posts.map(p=>p.source)).toEqual(['x','bluesky','x','bluesky']);
  expect(page.next?.remaining).toHaveLength(2);expect(page.next?.twitterRemaining).toHaveLength(2);
 }finally{analyze.mockRestore();}
});
it('does not wait for additional twitter pages once the first mixed screen has enough candidates',async()=>{
 mocks.native.mockResolvedValue({posts:[post('bsky:fast-1'),post('bsky:fast-2')],preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:1});
 mocks.twitter.mockResolvedValueOnce({posts:[post('x:72000'),post('x:72001')],next:{round:1,positions:{science:{cursor:'next',done:false}}}});
 const page=await getBalancedRecommendationPage(createRecommendationCursor([]),'first-screen-ready');
 expect(page.posts.map(p=>p.source)).toEqual(['x','bluesky','x','bluesky']);expect(mocks.twitter).toHaveBeenCalledTimes(1);
});

it('does not delay cached verified pairs to analyze extra reserve images',async()=>{
 const inference=await import('@/lib/recommendationVisualInference');
 const analyze=vi.spyOn(inference,'enrichRecommendationVisuals');
 mocks.native.mockResolvedValue({posts:[post('bsky:ready-a'),post('bsky:ready-b'),{...post('bsky:reserve-unknown'),recommendationVisual:undefined}],preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:1});
 mocks.twitter.mockResolvedValue({posts:[post('x:81000'),post('x:81001'),{...post('x:81002'),recommendationVisual:undefined}],next:undefined});
 try{const page=await getBalancedRecommendationPage(createRecommendationCursor([]),'cached-ready');
 expect(page.posts.map(post=>post.source)).toEqual(['x','bluesky','x','bluesky']);expect(analyze).not.toHaveBeenCalled();
 expect(page.next?.remaining.some(post=>post.id==='bsky:reserve-unknown')).toBe(true);expect(page.next?.twitterRemaining?.some(post=>post.id==='x:81002')).toBe(true);
 }finally{analyze.mockRestore();}
});

it('publishes the first verified mixed pair without waiting for a stalled reserve analysis',async()=>{
 const inference=await import('@/lib/recommendationVisualInference');
 const tweets=[{...post('x:82000'),recommendationVisual:undefined},{...post('x:82001'),recommendationVisual:undefined}];
 const blues=[{...post('bsky:partial-a'),recommendationVisual:undefined},{...post('bsky:partial-b'),recommendationVisual:undefined}];
 mocks.native.mockResolvedValue({posts:blues,preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:1});mocks.twitter.mockResolvedValue({posts:tweets,next:undefined});
 const analyze=vi.spyOn(inference,'enrichRecommendationVisuals').mockImplementationOnce(async(_rows,_topics,signal,onChecked)=>{
  onChecked?.({...tweets[0],recommendationVisual:post('pixel').recommendationVisual});
  onChecked?.({...blues[0],recommendationVisual:post('pixel').recommendationVisual});
  return await new Promise((_resolve,reject)=>signal?.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 });
 try{const page=await getBalancedRecommendationPage(createRecommendationCursor([]),'partial-ready');expect(page.posts.map(post=>post.source)).toEqual(['x','bluesky']);expect(page.next?.twitterRemaining).toHaveLength(1);expect(page.next?.remaining).toHaveLength(1);}
 finally{analyze.mockRestore();}
});
it('returns 20 verified, diverse, balanced reserve cards within 500 ms without another source read',async()=>{
 const previous=createRecommendationCursor([]);previous.preferences=prefs;
 previous.remaining=Array.from({length:10},(_,i)=>post('bsky:fast-'+i));
 previous.twitterRemaining=Array.from({length:10},(_,i)=>post('x:'+String(91000+i)));
 const started=performance.now();const page=await getBalancedRecommendationPage(previous,'viewer',undefined,{pageSize:20});
 expect(performance.now()-started).toBeLessThan(500);expect(page.posts).toHaveLength(20);expect(new Set(page.posts.map(p=>p.userId)).size).toBe(20);
 expect(page.posts.filter(p=>p.source==='x')).toHaveLength(10);expect(page.posts.filter(p=>p.source==='bluesky')).toHaveLength(10);
 expect(mocks.native).not.toHaveBeenCalled();expect(mocks.twitter).not.toHaveBeenCalled();expect(previous.seen).toEqual([]);
});
it('does not use unrelated cached work to fill a 20-card request',async()=>{
 const previous=createRecommendationCursor([]);previous.preferences=prefs;
 previous.remaining=Array.from({length:10},(_,i)=>post('bsky:quality-'+i));
 const unrelated={...post('x:92999'),recommendationTopics:['crypto'],recommendationVisual:{...post('x:92999').recommendationVisual,kind:'crypto',topics:['crypto']}};
 previous.twitterRemaining=[...Array.from({length:10},(_,i)=>post('x:'+String(92000+i))),unrelated];
 const page=await getBalancedRecommendationPage(previous,'viewer',undefined,{pageSize:20});
 expect(page.posts).toHaveLength(20);expect(page.posts.some(p=>p.id===unrelated.id)).toBe(false);expect(mocks.native).not.toHaveBeenCalled();expect(mocks.twitter).not.toHaveBeenCalled();
});

it('does not freeze a 20-card batch after the twitter source is exhausted',async()=>{
 mocks.native.mockResolvedValue({posts:Array.from({length:20},(_,i)=>post('bsky:available-'+i)),preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:1});mocks.twitter.mockResolvedValue({posts:[],next:undefined});
 const previous=createRecommendationCursor([]);previous.providerTotals={twitter:2,other:2};
 const page=await getBalancedRecommendationPage(previous,'exhausted-source',undefined,{pageSize:20});expect(page.posts).toHaveLength(20);expect(page.posts.every(row=>row.recommendationVisual?.topics.includes('science'))).toBe(true);
});

<<<<<<< HEAD
it('retains unverified candidates after transient image startup failure without showing them as accepted',async()=>{
 const inference=await import('@/lib/recommendationVisualInference');
 const unknown={...post('bsky:retry-model'),recommendationVisual:undefined};
 mocks.native.mockResolvedValue({posts:[unknown],preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:1});mocks.twitter.mockResolvedValue({posts:[],next:undefined});
 const analyze=vi.spyOn(inference,'enrichRecommendationVisuals').mockResolvedValueOnce([{...unknown,recommendationVisualStatus:'unavailable'}]);
 try{
  const first=await getBalancedRecommendationPage(createRecommendationCursor([]),'model-startup',undefined,{pageSize:20});expect(first.posts).toHaveLength(0);expect(first.next?.remaining.map(p=>p.id)).toContain(unknown.id);expect(first.next?.seen).not.toContain(unknown.id);
=======
it('discards failed pixels from the reserve while advancing a healthy source',async()=>{
 const inference=await import('@/lib/recommendationVisualInference');
 const unknown={...post('bsky:retry-model'),recommendationVisual:undefined};
 mocks.native.mockImplementation(async previous=>({posts:[unknown],next:{...previous,lime:{page:1,done:false},remaining:[]},preferences:prefs,pendingAnalysis:false,automaticPaused:false,requestKey:1}));mocks.twitter.mockResolvedValue({posts:[],next:undefined});
 const analyze=vi.spyOn(inference,'enrichRecommendationVisuals').mockResolvedValueOnce([{...unknown,recommendationVisualStatus:'unavailable'}]);
 try{
  const first=await getBalancedRecommendationPage(createRecommendationCursor([]),'model-startup',undefined,{pageSize:20});expect(first.posts).toHaveLength(0);expect(first.next).toBeDefined();expect(first.next?.remaining.map(p=>p.id)).not.toContain(unknown.id);expect(first.automaticPaused).toBe(false);
>>>>>>> 374490cc (“update23”)
 }finally{analyze.mockRestore();}
});
