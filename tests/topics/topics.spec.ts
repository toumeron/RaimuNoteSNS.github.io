import {test,expect,type Page} from '@playwright/test';
import {TOPICS} from '../../src/lib/topics';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const visualPrototypes=JSON.parse(readFileSync(new URL('../../src/lib/recommendationVisualPrototypes.json',import.meta.url),'utf8'));
const user={id:'11111111-1111-1111-1111-111111111111',username:'lime',displayName:'Lime Note',avatarUrl:'',createdAt:'2026-10-01T00:00:00Z'};
async function setup(page:Page) {
 await page.addInitScript(()=>localStorage.setItem('theme','dark'));
 const state={followed:[] as string[],dismissed:[] as string[],fail:false,writes:0,feedReads:0,externalFollows:new Map<string,any>(),externalLikes:new Map<string,any>(),feedback:[] as any[]};
 // UI regression tests isolate inference; the separate visual-inference suite
 // runs the actual worker/model on real image pixels.
 await page.route('**/recommendationVisual.worker.ts*',route=>{
  const row=visualPrototypes.prototypes.find(row=>row.topics.includes(state.followed[0] as never))??visualPrototypes.prototypes[0];
  return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/javascript',body:`self.onmessage=({data})=>{if(data.cancel===undefined)self.postMessage({id:data.id,vector:${JSON.stringify(row.vector)}});};`});
 });
 await page.route('**/src/hooks/useAuth.tsx*',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/javascript',body:`import {setExternalAccountOwner,initialiseExternalAccounts} from '/RaimuNoteSNS.github.io/src/lib/externalAccounts.ts';setExternalAccountOwner('${user.id}');void initialiseExternalAccounts().catch(()=>{});export const useAuth=()=>({user:${JSON.stringify(user)},loading:false,session:null,logout:async()=>{},accounts:[${JSON.stringify({...user,needsLogin:false})}],switching:false,switchAccount:async()=>{},forgetAccount:()=>{}});export const AuthProvider=({children})=>children;`}));
 await page.route('**/src/lib/currentUser.ts*',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/javascript',body:`export const getCurrentUserId=async()=> '${user.id}';`}));
 await page.route('**/*.supabase.co/**',route=>{
  const req=route.request(),url=new URL(req.url());
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS,HEAD','access-control-allow-headers':req.headers()['access-control-request-headers']??'*'}});
  if(url.pathname.endsWith('/rpc/update_topic_preferences')) {
   state.writes++;if(state.fail)return route.fulfill({headers:{'access-control-allow-origin':'*'},status:500,contentType:'application/json',body:'{"message":"write failed"}'});
   const {topic_ids:ids,disposition:status}=req.postDataJSON();state.followed=state.followed.filter(id=>!ids.includes(id));state.dismissed=state.dismissed.filter(id=>!ids.includes(id));
   if(status==='follow')state.followed.push(...ids);if(status==='dismiss')state.dismissed.push(...ids);
   return route.fulfill({headers:{'access-control-allow-origin':'*'},status:204,body:''});
  }
  if(url.pathname.endsWith('/rpc/import_external_account_users'))return route.fulfill({headers:{'access-control-allow-origin':'*'},status:204,body:''});
  if(url.pathname.endsWith('/rpc/set_external_follow')){const {provider,handle,enabled,profile}=req.postDataJSON();const key=provider+':'+handle;if(enabled)state.externalFollows.set(key,{follower_id:user.id,followee_id:null,external_provider:provider,external_handle:handle,external_profile:profile,profile:null});else state.externalFollows.delete(key);return route.fulfill({headers:{'access-control-allow-origin':'*'},status:204,body:''});}
  if(url.pathname.endsWith('/external_account_users'))return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify([...state.externalFollows.values()].map(row=>({provider:row.external_provider,handle:row.external_handle})))});
  if(url.pathname.endsWith('/follows'))return route.fulfill({headers:{'access-control-allow-origin':'*','content-range':`0-0/${state.externalFollows.size}`},contentType:'application/json',body:req.method()==='HEAD'?'':JSON.stringify([...state.externalFollows.values()])});
  if(url.pathname.endsWith('/rpc/set_external_like')){
   const {snapshot,enabled,mirrored}=req.postDataJSON();if(enabled)state.externalLikes.set(snapshot.id,{post_snapshot:snapshot,external_post_id:snapshot.id,user_id:user.id,created_at:new Date().toISOString(),external_mirrored:!!mirrored});else state.externalLikes.delete(snapshot.id);
   return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify({liked:enabled,count:enabled?1:0,unmirroredCount:enabled&&!mirrored?1:0})});
  }
  if(url.pathname.endsWith('/rpc/external_like_states'))return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify(req.postDataJSON().post_ids.map((id:string)=>({post_id:id,liked:state.externalLikes.has(id),likes_count:state.externalLikes.has(id)?1:0,unmirrored_count:state.externalLikes.has(id)?1:0})))});
  if(url.pathname.endsWith('/rpc/dismiss_recommendation')){const feedback=req.postDataJSON().feedback;if(feedback.enrichment){state.feedback=state.feedback.map(old=>old.id===feedback.id?{...old,vector:feedback.vector,imageUrls:feedback.imageUrls,visualKind:feedback.visualKind}:old);}else state.feedback=[feedback,...state.feedback.filter(old=>old.id!==feedback.id)];return route.fulfill({headers:{'access-control-allow-origin':'*'},status:204,body:''});}
  if(url.pathname.endsWith('/likes'))return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify([...state.externalLikes.values()])});
  if(url.pathname.endsWith('/profile_private_settings'))return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify({followed_topics:state.followed,dismissed_topics:state.dismissed,recommendation_feedback:state.feedback})});
  if(url.pathname.endsWith('/posts')&&req.method()==='GET')state.feedReads++;
  const single=(req.headers().accept??'').includes('vnd.pgrst.object');
  return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*','content-range':'0-0/0'},body:req.method()==='HEAD'?'':JSON.stringify(single?null:[])});
 });
 await page.route('**/public.api.bsky.app/**',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:'{"feed":[],"posts":[],"actors":[]}'}));
 await page.route('**/misskey.io/**',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:'[]'}));
 return state;
}
test('selection, cloud persistence, follow and dismiss work through the existing navigation',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const state=await setup(page);
 await page.goto('settings');
 if(info.project.name==='desktop')await page.getByRole('button',{name:'もっと見る',exact:true}).click();else await page.getByRole('button',{name:'メニューを開く',exact:true}).click();
 await page.getByText('トピック',{exact:true}).filter({visible:true}).click();
 await expect(page).toHaveURL(/\/topics$/);await expect(page.getByRole('heading',{name:'トピック',exact:true})).toHaveCount(1);
 const root=page.locator('[data-lime-topics]');
 await expect(root.getByRole('heading',{name:'興味のあるトピックを選択してください'})).toBeVisible();
 await expect(page.getByRole('tablist',{name:'トピックの種類'})).toHaveCount(0);
 await expect(root.locator('[aria-pressed]')).toHaveCount(TOPICS.length);await expect(page.getByRole('button',{name:'次へ',exact:true})).toBeDisabled();
 await page.screenshot({path:`artifacts/topics-selection-${info.project.name}.png`,fullPage:true});
 await root.getByRole('button',{name:'音楽',exact:true}).click();await root.getByRole('button',{name:'ゲーム',exact:true}).click();
 await expect(root.getByRole('button',{name:'音楽',exact:true})).toHaveAttribute('aria-pressed','true');await expect(root.getByText('2件選択済み')).toBeVisible();
 await page.getByRole('button',{name:'次へ',exact:true}).click();
 await expect(root.getByRole('button',{name:'音楽をフォロー解除'})).toBeVisible();expect([...state.followed].sort()).toEqual(['games','music']);
 await expect(page.getByRole('tablist',{name:'トピックの種類'})).toBeVisible();
 await page.reload();await expect(root.getByRole('button',{name:'ゲームをフォロー解除'})).toBeVisible();
 await page.getByRole('tab',{name:'おすすめ',exact:true}).click();
 await root.getByRole('button',{name:'ペットに興味なし'}).click();await expect.poll(()=>state.dismissed).toEqual(['pets']);
 await page.getByRole('tab',{name:'興味なし',exact:true}).click();await expect(root.getByRole('heading',{name:'ペット',exact:true})).toBeVisible();
 await root.getByRole('button',{name:'ペットの興味なしを解除'}).click();await expect.poll(()=>state.dismissed).toEqual([]);expect(state.followed).not.toContain('pets');
 await page.getByRole('tab',{name:'おすすめ',exact:true}).click();await expect(root.getByRole('button',{name:'ペットをフォローする'})).toBeVisible();
 await expect(root.getByText('フォローしているトピックは、おすすめのポストやトレンドのカスタマイズに使用されます。',{exact:true})).toHaveCount(0);
 await page.getByRole('tab',{name:'フォロー済み',exact:true}).click();await root.getByRole('button',{name:'音楽をフォロー解除'}).click();await expect.poll(()=>state.followed).not.toContain('music');
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);expect(overflow).toBe(false);
 await page.screenshot({path:`artifacts/topics-${info.project.name}.png`,fullPage:true});expect(errors).toEqual([]);
});
test('failed cloud save keeps selections and does not claim a follow succeeded',async({page})=>{
 const state=await setup(page);state.fail=true;await page.goto('topics');const root=page.locator('[data-lime-topics]');
 await root.getByRole('button',{name:'ペット',exact:true}).click();await page.getByRole('button',{name:'次へ',exact:true}).click();
 await expect(root.getByRole('alert')).toHaveText('保存に失敗しました。もう一度お試しください。');await expect(root.getByRole('button',{name:'ペット',exact:true})).toHaveAttribute('aria-pressed','true');expect(state.followed).toEqual([]);
 state.fail=false;await page.getByRole('button',{name:'次へ',exact:true}).click();await expect(root.getByRole('button',{name:'ペットをフォロー解除'})).toBeVisible();
 await root.getByRole('button',{name:'ペットをフォロー解除'}).click();await expect(root.getByRole('heading',{name:'興味のあるトピックを選択してください'})).toBeVisible();await expect(page.getByRole('button',{name:'次へ',exact:true})).toBeDisabled();
});
for(const topic of ['science','art','digital-illustration'])test(`${topic}: recommendations display source-qualified image-only posts and exclude declared AI art`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const state=await setup(page);state.followed=[topic];
 await page.addInitScript(()=>localStorage.setItem('lime_active_feed_tab','recommended'));
 await page.addInitScript(async()=>{const cache=await caches.open('transformers-cache');for(const file of ['config.json','preprocessor_config.json','onnx/vision_model_quantized.onnx'])await cache.put(`https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/test/${file}`,new Response('installed-test-model'));});
 const image=`https://images.example/${topic}.jpg`;
 const post=(id:string,text:string,url:string)=>({uri:`at://did:plc:creator/app.bsky.feed.post/${id}`,cid:id,author:{did:'did:plc:creator',handle:'creator.bsky.social',displayName:'Artist'},record:{text,createdAt:new Date().toISOString()},embed:{images:[{fullsize:url,thumb:url,alt:''}]}});
 await page.route('**/*bsky.app/xrpc/**',route=>{
  const url=new URL(route.request().url());
  const endpoint=url.pathname.split('/').at(-1);
  let data:unknown={feed:[],posts:[],actors:[]};
  if(endpoint==='app.bsky.unspecced.getPopularFeedGenerators')data={feeds:[{uri:'at://did:plc:science/app.bsky.feed.generator/science',displayName:topic==='art'?'アート':'Science',description:'日本の画像投稿',likeCount:100}]};
  if(endpoint==='app.bsky.feed.getFeed')data={feed:[{post:post('media-only','',image)},{post:post('media-seed-2','',`https://images.example/${topic}-seed2.jpg`)}]};
  if(endpoint==='app.bsky.feed.getAuthorFeed'){expect(url.searchParams.get('filter')).toBe('posts_with_media');data={feed:[{post:post('creator-latest','',`https://images.example/${topic}-creator.jpg`)}]};}
  if(endpoint==='app.bsky.feed.searchPosts')data={posts:[post('generated','#AIart','https://images.example/ai.jpg'),{...post('english','My illustration from overseas','https://images.example/english.jpg'),record:{text:'My illustration from overseas',langs:['en'],createdAt:new Date().toISOString()}}]};
  return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.route('**/images.example/**',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#557799"/></svg>'}));
 await page.goto('');
 await expect(page.locator(`img[src="${image}"]`).first()).toBeVisible({timeout:15000});
 await expect(page.locator('img[src="https://images.example/english.jpg"]')).toHaveCount(0);
 await expect(page.locator(`img[src="https://images.example/${topic}-creator.jpg"]`).first()).toBeVisible({timeout:15000});
 if(topic==='art'||topic==='digital-illustration')await expect(page.locator('img[src="https://images.example/ai.jpg"]')).toHaveCount(0);
 expect(errors).toEqual([]);
});
test('dismissed topics stay manageable when the initial selection tabs are hidden',async({page})=>{
 const state=await setup(page);state.dismissed=TOPICS.map(topic=>topic.id);await page.goto('topics');
 await expect(page.getByRole('tablist',{name:'トピックの種類'})).toHaveCount(0);
 await page.getByRole('button',{name:'興味なしのトピックを管理'}).click();
 await expect(page.getByRole('tab',{name:'興味なし',exact:true})).toHaveAttribute('aria-selected','true');
 await page.getByRole('button',{name:'科学の興味なしを解除'}).click();
 await expect.poll(()=>state.dismissed.includes('science')).toBe(false);expect(state.followed).toEqual([]);
 await page.reload();await expect(page.getByRole('button',{name:'科学の興味なしを解除'})).toHaveCount(0);
 await page.getByRole('tab',{name:'フォロー済み',exact:true}).click();
 await expect(page.locator('[data-lime-topics]').getByRole('button',{name:'科学',exact:true})).toBeVisible();
});
test('selection footer touches the mobile navigation without a gap and digital illustration saves',async({page},testInfo)=>{
 const state=await setup(page);await page.goto('topics');
 await page.getByRole('button',{name:'デジタルイラスト',exact:true}).click();
 const footer=page.getByText('1件選択済み',{exact:true}).locator('..');
 await footer.scrollIntoViewIfNeeded();
 if(testInfo.project.name!=='desktop'){
  const nav=page.locator('[data-lime-bottom-nav-root]');await expect(nav).toBeVisible();
  await expect.poll(async()=>{const a=await footer.boundingBox(),b=await nav.boundingBox();return Math.abs((a!.y+a!.height)-b!.y);}).toBeLessThanOrEqual(2);
 }
 await page.getByRole('button',{name:'次へ',exact:true}).click();await expect.poll(()=>state.followed).toEqual(['digital-illustration']);
});

test('Bluesky login survives reload and account initialization without restoring a stale snapshot',async({page})=>{
 await setup(page);await page.goto('settings');
 await page.evaluate(async()=>{
  const accounts=await import('/RaimuNoteSNS.github.io/src/lib/savedAccounts.ts');
  localStorage.setItem('lime_bluesky_session',JSON.stringify({did:'did:plc:browser-test',handle:'old.bsky.social',accessJwt:'fake-old',refreshJwt:'fake-old-refresh'}));
  accounts.activateAccountIntegrations(undefined,'browser-owner');
  localStorage.setItem('lime_bluesky_session',JSON.stringify({did:'did:plc:browser-test',handle:'current.bsky.social',accessJwt:'fake-current',refreshJwt:'fake-current-refresh'}));
 });
 await page.reload();
 await page.evaluate(async()=>{const accounts=await import('/RaimuNoteSNS.github.io/src/lib/savedAccounts.ts');accounts.activateAccountIntegrations(undefined,'browser-owner');});
 await expect(page.getByText('@current.bsky.social',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('lime_bluesky_session')!).handle)).toBe('current.bsky.social');
});
test('concurrent Bluesky actions share session refresh in the browser',async({page})=>{
 await setup(page);await page.goto('settings');let refreshes=0;
 const rotated={did:'did:plc:browser-refresh',handle:'current.bsky.social',accessJwt:'fake-rotated-access',refreshJwt:'fake-rotated-refresh'};
 await page.route('https://bsky.social/xrpc/**',async route=>{
  const request=route.request();const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'authorization,content-type'};
  if(request.method()==='OPTIONS')return route.fulfill({headers:{'access-control-allow-origin':'*'},status:204,headers});
  if(request.url().endsWith('refreshSession')){refreshes++;return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',headers,body:JSON.stringify(rotated)});}
  const fresh=request.headers()['authorization']==='Bearer fake-rotated-access';
  return route.fulfill({headers:{'access-control-allow-origin':'*'},status:fresh?200:400,contentType:'application/json',headers,body:JSON.stringify(fresh?{}:{error:'ExpiredToken'})});
 });
 const result=await page.evaluate(async()=>{
  localStorage.setItem('lime_bluesky_session',JSON.stringify({did:'did:plc:browser-refresh',handle:'current.bsky.social',accessJwt:'fake-expired-access',refreshJwt:'fake-refresh'}));
  const api=await import('/RaimuNoteSNS.github.io/src/lib/bluesky.ts');
  return (await Promise.all([api.authorizedBlueskyFetch('test-action'),api.authorizedBlueskyFetch('test-action')])).map(response=>response.ok);
 });
 expect(result).toEqual([true,true]);expect(refreshes).toBe(1);
});
test('three clicks on the current home tab return to the top',async({page})=>{
 await setup(page);await page.addInitScript(()=>localStorage.setItem('lime_active_feed_tab','recommended'));await page.goto('');
 const tab=page.getByRole('tab',{name:'おすすめ',exact:true}).filter({visible:true});await expect(tab).toHaveAttribute('aria-selected','true');const element=await tab.elementHandle();
 await expect(page.getByText('おすすめの投稿がまだありません',{exact:true})).toBeVisible();
 await page.evaluate(()=>{document.documentElement.style.minHeight='2600px';document.body.style.minHeight='2600px';window.scrollTo({top:800,behavior:'instant'});});await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(500);
 // Dispatch individual clicks to exercise the third-click branch independently of native dblclick.
 await element!.dispatchEvent('click');await element!.dispatchEvent('click');await element!.dispatchEvent('click');
 await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeLessThanOrEqual(2);
});
test('pull to refresh works in a normal mobile browser, without PWA mode',async({page},info)=>{
 test.skip(info.project.name==='desktop');const state=await setup(page);await page.addInitScript(()=>localStorage.setItem('lime_active_feed_tab','recommended'));await page.goto('');
 await expect.poll(()=>state.feedReads).toBeGreaterThan(0);await expect(page.getByText('おすすめの投稿がまだありません',{exact:true})).toBeVisible();
 const reads=state.feedReads;await page.evaluate(()=>{
  window.scrollTo({top:0,behavior:'instant'});
  const touch=(type:string,y:number)=>{const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'touches',{value:type==='touchend'?[]:[{clientY:y,clientX:200,pageY:y,pageX:200,identifier:1,target:document.body}]});Object.defineProperty(event,'changedTouches',{value:[{clientY:y,clientX:200,pageY:y,pageX:200,identifier:1,target:document.body}]});document.body.dispatchEvent(event);};
  touch('touchstart',150);touch('touchmove',330);touch('touchend',330);
 });
 await expect.poll(()=>state.feedReads).toBeGreaterThan(reads);
});
test('the same work with twenty IDs is shown once and does not return after a viewed reload',async({page})=>{
 const state=await setup(page);state.followed=['science'];await page.addInitScript(()=>localStorage.setItem('lime_active_feed_tab','recommended'));
 await page.route('**/*bsky.app/xrpc/**',route=>{
  const endpoint=new URL(route.request().url()).pathname.split('/').at(-1);let data:unknown={feed:[],posts:[]};
  if(endpoint==='app.bsky.unspecced.getPopularFeedGenerators')data={feeds:[{uri:'at://did:plc:science/app.bsky.feed.generator/science',displayName:'科学',description:'日本語の科学フィード'}]};
  if(endpoint==='app.bsky.feed.getFeed')data={feed:Array.from({length:20},(_,i)=>({post:{uri:`at://did:plc:artist/app.bsky.feed.post/copy${i}`,author:{did:'did:plc:artist',handle:'artist.bsky.social'},record:{text:'',createdAt:new Date().toISOString()},embed:{images:[{fullsize:`https://images.example/repeated.png?width=${300+i}`,alt:''}]}}}))};
  return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.route('**/images.example/**',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><rect width="300" height="150" fill="#557799"/></svg>'}));
 await page.goto('');const rows=page.locator('[data-lime-recommendation-post]');await expect(rows).toHaveCount(1);await rows.first().scrollIntoViewIfNeeded();
 await expect.poll(()=>page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('lime_recommendation_impressions:11111111-1111-1111-1111-111111111111')??'{}')).some(key=>key.startsWith('fp:')))).toBe(true);
 await page.reload();await expect(page.getByText('おすすめの投稿がまだありません',{exact:true})).toBeVisible({timeout:15000});await expect(page.locator('[data-lime-recommendation-post]')).toHaveCount(0);
});
test('a four-post qualified result continues loading toward a usable first page',async({page})=>{
 const state=await setup(page);state.followed=['digital-illustration'];await page.addInitScript(()=>localStorage.setItem('lime_active_feed_tab','recommended'));
 const cursors=new Set<string>();
 await page.route('**/*bsky.app/xrpc/**',route=>{
  const url=new URL(route.request().url()),endpoint=url.pathname.split('/').at(-1);let data:unknown={feed:[],posts:[],actors:[]};
  if(endpoint==='app.bsky.feed.getFeed'){
   const round=Number(url.searchParams.get('cursor')??0);cursors.add(String(round));
   const feed=Array.from({length:4},(_,i)=>({post:{uri:`at://did:plc:creator${i}/app.bsky.feed.post/round-${round}-${i}`,cid:`round-${round}-${i}`,author:{did:`did:plc:creator${i}`,handle:`creator${i}.bsky.social`,displayName:'作者'},record:{text:'',langs:['ja'],createdAt:new Date().toISOString()},embed:{images:[{fullsize:`https://images.example/round-${round}-${i}.jpg`,thumb:`https://images.example/round-${round}-${i}.jpg`,alt:''}]}}}));
   data={feed,cursor:round<5?String(round+1):undefined};
  }
  return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.route('**/images.example/**',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><rect width="30" height="20" fill="#557799"/></svg>'}));
 await page.goto('');
 await expect.poll(()=>cursors.size,{timeout:20000}).toBeGreaterThanOrEqual(5);
 await expect(page.locator('[data-lime-recommendation-post]').first()).toBeVisible();
 expect(await page.locator('[data-lime-recommendation-post]').count()).toBeGreaterThan(4);
 await expect(page.getByText('すべての投稿を読み込みました',{exact:true})).toHaveCount(0);
});
test('cold recommendations show a first post under three seconds without downloading a vision model',async({page,browser},info)=>{
 const state=await setup(page);state.followed=['digital-illustration'];await page.addInitScript(()=>{localStorage.setItem('lime_active_feed_tab','recommended');(window as any).__feedStart=performance.now();});
 const models:string[]=[];page.on('request',request=>{if(/huggingface.co.*(?:onnx|clip-vit)|recommendationVisual.worker|transformers.*\.js/.test(request.url()))models.push(request.url());});
 await page.route('**/*bsky.app/xrpc/**',async route=>{
  const url=new URL(route.request().url()),endpoint=url.pathname.split('/').at(-1);let data:unknown={feed:[],posts:[],actors:[]};
  if(endpoint==='app.bsky.feed.searchPosts'){await new Promise(resolve=>setTimeout(resolve,6000));}
  if(endpoint==='app.bsky.feed.getFeed')data={feed:Array.from({length:24},(_,i)=>({post:{uri:`at://did:plc:cold${i}/app.bsky.feed.post/new`,cid:`cold${i}`,author:{did:`did:plc:cold${i}`,handle:`cold${i}.bsky.social`,displayName:'作者'},record:{text:'',langs:['ja'],createdAt:new Date().toISOString()},embed:{images:[{fullsize:`https://images.example/cold-${i}.jpg`,thumb:`https://images.example/cold-${i}.jpg`,alt:''}]}}})),cursor:'next'};
  await route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify(data)}).catch(()=>{});
 });
 await page.route('**/images.example/**',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><rect width="30" height="20" fill="#557799"/></svg>'}));
 await page.goto('');await expect(page.locator('[data-lime-recommendation-post]').first()).toBeVisible({timeout:3500});
 const ms=await page.evaluate(()=>performance.now()-(window as any).__feedStart);console.log(`${info.project.name}: first recommended post ${Math.round(ms)} ms`);
 expect(ms).toBeLessThan(3000);expect(models).toEqual([]);expect(await page.locator('[data-lime-recommendation-post]').count()).toBeGreaterThan(4);
 await page.waitForTimeout(1800);expect(models).toEqual([]);
 if(info.project.name==='desktop'){
  const cdp=await browser.newBrowserCDPSession();const {processInfo}=await cdp.send('SystemInfo.getProcessInfo');const ids=processInfo.filter(row=>row.type==='renderer').map(row=>row.id);
  const rss=execFileSync('ps',['-o','rss=','-p',ids.join(',')],{encoding:'utf8'}).trim().split(/\s+/).reduce((sum,value)=>sum+Number(value),0)/1024;
  console.log(`Recommended page renderer RSS without inference: ${Math.round(rss)} MiB`);expect(rss).toBeLessThan(700);await cdp.detach();
 }

});


test('external likes persist without provider login, appear in the profile and recommendation-only dismiss survives reload',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const state=await setup(page);state.followed=['pets'];
 await page.addInitScript(()=>localStorage.setItem('lime_active_feed_tab','recommended'));
 let generation=0;
 const make=(i:number)=>({uri:`at://did:plc:pet${i}/app.bsky.feed.post/cat`,cid:`cat${i}`,author:{did:`did:plc:pet${i}`,handle:`pet${i}.bsky.social`,displayName:'猫の作者',avatar:'https://images.example/author.jpg'},record:{text:`猫の写真 ${i}`,langs:['ja'],createdAt:new Date().toISOString()},embed:{images:[{fullsize:`https://images.example/pet-${i}.jpg`,thumb:`https://images.example/pet-${i}.jpg`,alt:''}]}});
 await page.route('**/*bsky.app/xrpc/**',route=>{const endpoint=new URL(route.request().url()).pathname.split('/').at(-1);return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify(endpoint==='app.bsky.feed.searchPosts'?{posts:Array.from({length:80},(_,i)=>make(i+generation))}:endpoint==='app.bsky.feed.getFeed'?{feed:Array.from({length:80},(_,i)=>({post:make(i+generation)}))}:{feed:[],posts:[],actors:[],feeds:[]})});});
 await page.route('**/images.example/**',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20"><rect width="30" height="20" fill="#557799"/></svg>'}));
 await page.goto('');const first=page.locator('[data-lime-recommendation-post]').first();await expect(first).toBeVisible();
 await first.getByRole('button',{name:'いいね',exact:true}).click();await expect.poll(()=>state.externalLikes.size).toBe(1);await expect(first.getByRole('button',{name:'いいねを取り消す',exact:true})).toBeVisible();
 const snapshot=[...state.externalLikes.values()][0].post_snapshot;expect(snapshot.imageUrls).toHaveLength(1);
 const second=page.locator('[data-lime-recommendation-post]').nth(1);await second.getByRole('button',{name:'ポストのメニュー',exact:true}).click();await page.getByRole('button',{name:'興味なし',exact:true}).click();await expect.poll(()=>state.feedback.length).toBe(1);
 const dismissed=state.feedback[0].id;await expect(page.locator(`[data-lime-recommendation-post="${dismissed}"]`)).toHaveCount(0);
 await page.waitForLoadState('networkidle');const delivered=await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('lime_recommendation_deliveries:11111111-1111-1111-1111-111111111111')??'{}')));generation=100;await page.reload();await expect(page.locator('[data-lime-recommendation-post]').first()).toBeVisible();await expect(page.locator(`[data-lime-recommendation-post="${dismissed}"]`)).toHaveCount(0);const nextIds=await page.locator('[data-lime-recommendation-post]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-lime-recommendation-post')));expect(nextIds.every(id=>!delivered.includes(id!))).toBe(true);
 await page.route('**/rest/v1/profiles?**',route=>{const single=(route.request().headers().accept??'').includes('vnd.pgrst.object');return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify(single?{...user,display_name:user.displayName,created_at:user.createdAt}:[{...user,display_name:user.displayName,created_at:user.createdAt}])});});
 await page.waitForLoadState('networkidle');await page.goto('u/lime');await page.getByRole('tab',{name:'いいね',exact:true}).click();await expect(page.locator(`img[src="${snapshot.imageUrls[0]}"]`).first()).toBeVisible();await expect(page.getByText('猫の作者',{exact:true}).first()).toBeVisible();await expect(page.locator('img[src="https://images.example/author.jpg"]').first()).toBeVisible();
 await page.getByRole('button',{name:'ポストのメニュー',exact:true}).first().click();await expect(page.getByRole('button',{name:'興味なし',exact:true})).toHaveCount(0);
 expect(errors).toEqual([]);
});

 test('external profile follow joins the Lime following list and following timeline',async({page})=>{
  const state=await setup(page);
  await page.route('**/rest/v1/profiles?**',route=>{const url=new URL(route.request().url());const owner=url.searchParams.get('username')==='eq.lime';return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify(owner?{...user,display_name:user.displayName,created_at:user.createdAt}:null)});});
  await page.route('**/*bsky.app/xrpc/**',route=>{const endpoint=new URL(route.request().url()).pathname.split('/').at(-1);return route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify(endpoint==='app.bsky.actor.getProfile'?{did:'did:plc:artist',handle:'artist.bsky.social',displayName:'絵の作者',avatar:'https://images.example/follow-avatar.svg',description:'日本の絵の作者',createdAt:'2026-01-01',followersCount:1,followsCount:1,postsCount:1}:endpoint==='app.bsky.feed.getAuthorFeed'?{feed:[{post:{uri:'at://did:plc:artist/app.bsky.feed.post/followed',cid:'cid',author:{did:'did:plc:artist',handle:'artist.bsky.social',displayName:'絵の作者'},record:{text:'フォローした作者の新しい投稿',langs:['ja'],createdAt:new Date().toISOString()}}}],cursor:null}:{feed:[],posts:[],actors:[]})});});
  await page.route('**/images.example/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><circle cx="15" cy="15" r="15" fill="pink"/></svg>'}));
  await page.goto('u/artist.bsky.social');
  await expect(page.getByRole('button',{name:'追加する',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'新しい投稿を通知する',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'フォロー',exact:true}).click();await expect.poll(()=>state.externalFollows.size).toBe(1);await expect(page.getByRole('button',{name:'新しい投稿を通知する',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/^フォロー中$|^フォロー解除$/})).toBeVisible();
  await page.goto('u/lime/followers_following?tab=following');await expect(page.getByText('絵の作者',{exact:true}).last()).toBeVisible();await expect(page.locator('.group.flex.p-4').getByRole('button')).toHaveCount(0);await expect(page.locator('img[src="https://images.example/follow-avatar.svg"]').last()).toBeVisible();
  await page.goto('');await page.getByRole('tab',{name:'フォロー中',exact:true}).click();await expect(page.getByText('フォローした作者の新しい投稿',{exact:true})).toBeVisible();
  await page.goto('u/artist.bsky.social');await page.getByRole('button',{name:/^フォロー中$|^フォロー解除$/}).click();await expect.poll(()=>state.externalFollows.size).toBe(0);await expect(page.getByRole('button',{name:'新しい投稿を通知する',exact:true})).toHaveCount(0);
 });
