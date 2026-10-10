import { test, expect, type Page, type Locator } from '@playwright/test';
import { setup } from './fixtures';
async function press(page:Page,locator:Locator){if(await page.evaluate(()=>navigator.maxTouchPoints>0))await locator.tap();else await locator.click();}
test('shared viewer opens from posts and detail; controls operate the image and persist actions',async({page},info)=>{
 const state=await setup(page,false);await page.addInitScript(()=>Object.defineProperty(navigator,'share',{value:async(data:unknown)=>{(window as any).__mediaShared=data;}}));await page.goto('./');
 const post=page.locator('[data-lime-post-card]').filter({hasText:'写真の投稿'}).first();
 await press(page,post.locator('[data-lime-post-body] img').first());
 const viewer=page.getByRole('dialog',{name:'メディアを拡大表示'});await expect(viewer).toBeVisible();
 await expect(viewer.getByAltText('拡大画像 1')).toHaveAttribute('src','https://media.example/one.svg');
 await press(page,viewer.getByRole('button',{name:'画像 2',exact:true}));await expect(viewer.getByAltText('拡大画像 2')).toHaveAttribute('src','https://media.example/two.svg');
 await viewer.locator('.lime-media-stage').dblclick();await expect(viewer.getByAltText('拡大画像 2')).toHaveCSS('transform',/2.5/);await viewer.locator('.lime-media-stage').dblclick();await expect(viewer).not.toHaveClass(/lime-media-controls-hidden/);
 const actions=viewer.locator('.lime-media-bottom .lime-media-actions');
 await press(page,actions.locator('[data-lime-bookmark-button]'));await expect.poll(()=>state.rows.length).toBe(1);await expect(actions.locator('[data-lime-bookmark-button]')).toHaveAttribute('aria-pressed','true');
 await press(page,actions.locator('[data-lime-post-action="repost"]'));const repostChoice=page.getByRole((page.viewportSize()?.width??0)<640?'button':'menuitem',{name:'リポストする',exact:true});await expect(repostChoice).toBeVisible();await press(page,repostChoice);
 await press(page,actions.getByRole('link',{name:'返信',exact:true}));
 const replyScope=(page.viewportSize()?.width??0)<768?page.getByRole('dialog',{name:'返信を作成',exact:true}):viewer;const replyInput=replyScope.locator('textarea:visible,input:visible').first();await expect(replyInput).toBeFocused();
 await replyInput.fill('ビューアーからの返信');await press(page,replyScope.getByRole('button',{name:'コメントを送信',exact:true}).filter({visible:true}).first());await expect.poll(()=>state.writes.some(write=>write.table==='comments'&&write.body?.content==='ビューアーからの返信'&&write.body?.post_id==='native')).toBe(true);
 await press(page,actions.locator('[data-lime-post-action=like]'));await expect.poll(()=>state.writes.some(write=>write.table==='likes'&&write.body?.post_id==='native')).toBe(true);
 await expect(actions.locator('[data-lime-post-action=like]')).toHaveClass(/text-pink-500/);
 await page.screenshot({path:info.outputPath('viewer.png'),animations:'disabled'});
 await press(page,actions.getByRole('button',{name:'ポストを共有',exact:true}));if((page.viewportSize()?.width??0)<640)await expect(page.locator('.lime-post-action-sheet-backdrop-mobile')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await press(page,page.getByText('その他の方法でポストを送信',{exact:true}));await expect.poll(()=>page.evaluate(()=>(window as any).__mediaShared?.url)).toContain('/post/native');
 await press(page,viewer.getByRole('button',{name:'ポストのメニュー'}).filter({visible:true}));
 const download=page.waitForEvent('download');
 await press(page,page.getByRole('button',{name:'画像を保存',exact:true}).filter({visible:true}));expect((await download).suggestedFilename()).toContain('LimeNote-2');
 await press(page,viewer.getByRole('button',{name:'画像を閉じる'}));await expect(viewer).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
 await press(page,post.getByRole('button',{name:'ポストを共有',exact:true}));
 const shareMenu=page.locator('.lime-post-share-menu');await expect(shareMenu).toBeVisible();
 expect((await shareMenu.boundingBox())!.width).toBeLessThanOrEqual(256);
 await expect(shareMenu).toHaveCSS('padding-top','4px');
 await press(page,page.getByText('その他の方法でポストを送信',{exact:true}));await expect(shareMenu).toHaveCount(0);
 await page.goto('post/native');await press(page,page.locator('[data-lime-post-detail-card] img').filter({hasNot:page.locator('none')}).filter({visible:true}).last());
 await expect(viewer).toBeVisible();await press(page,viewer.getByRole('button',{name:'画像を閉じる'}));
});
test('profile media and reply images use the same viewer; mobile supports swipe and dismiss',async({page})=>{
 await setup(page,false);await page.goto('u/lime');
 await press(page,page.getByRole('tab',{name:'メディア',exact:true}).filter({visible:true}));
 await press(page,page.locator('[data-lime-profile-posts] .grid img').first());
 const viewer=page.getByRole('dialog',{name:'メディアを拡大表示'});await expect(viewer).toBeVisible();
 await expect(viewer.getByAltText('拡大画像 1')).toBeVisible();
 if((page.viewportSize()?.width??0)<768){
  const stage=viewer.locator('.lime-media-stage');
  await stage.dispatchEvent('pointerdown',{pointerId:1,clientX:260,clientY:300,pointerType:'touch'});
  await stage.dispatchEvent('pointermove',{pointerId:1,clientX:80,clientY:300,pointerType:'touch'});
  await stage.dispatchEvent('pointerup',{pointerId:1,clientX:80,clientY:300,pointerType:'touch'});
  await expect(viewer.getByAltText('拡大画像 2')).toBeVisible();
 }else {await press(page,viewer.getByRole('button',{name:'詳細を隠す'}));await expect(viewer.locator('.lime-media-detail')).toBeHidden();await press(page,viewer.getByRole('button',{name:'詳細を表示'}));await expect(viewer.locator('.lime-media-detail')).toBeVisible();}
 await press(page,viewer.getByRole('button',{name:'画像を閉じる'}));
 await page.goto('post/native');const reply=page.locator('[data-lime-comment-card="child"]');await press(page,reply.locator('img[src="https://media.example/reply.svg"]'));
 await expect(viewer).toBeVisible();await expect(viewer.getByAltText('拡大画像 1')).toHaveAttribute('src','https://media.example/reply.svg');
 await press(page,viewer.getByRole('button',{name:'画像を閉じる'}));
});

test('search media shares the viewer and profile rows return after scrolling through pages',async({page})=>{
 const state=await setup(page,false);await page.goto('search?q=写真');
 await press(page,page.getByRole((page.viewportSize()?.width??0)<640?'button':'tab',{name:'メディア',exact:true}).filter({visible:true}));
 await press(page,page.getByRole('button',{name:'画像を開く',exact:true}).nth(1));
 const viewer=page.getByRole('dialog',{name:'メディアを拡大表示'});await expect(viewer).toBeVisible();await press(page,viewer.getByRole('button',{name:'画像を閉じる'}));
 const author={id:'11111111-1111-1111-1111-111111111111',username:'lime',displayName:'Lime Note',avatarUrl:'',createdAt:'2026-10-01T00:00:00Z'};
 const posts=Array.from({length:32},(_,i)=>({id:'scroll-'+i,userId:author.id,author,content:'スクロール投稿 '+i+' 本文'.repeat(70),createdAt:new Date(1791100000000-i*60000).toISOString(),imageUrls:['https://media.example/one.svg'],likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,visibility:'public'}));
 state.profilePosts=posts;
 await page.goto('u/lime');await expect(page.locator('[data-lime-post-card]').filter({hasText:'スクロール投稿 0 '})).toBeVisible();
 await expect(async()=>{
  await page.locator('[data-lime-profile-posts]').locator('xpath=./div[last()]').evaluate(el=>el.scrollIntoView({block:'center'}));
  await expect(page.locator('[data-lime-profile-row="profile-post-post:scroll-31"]')).toHaveCount(1,{timeout:500});
 }).toPass({timeout:15000});
 const firstRow=page.locator('[data-lime-profile-row="profile-post-post:scroll-0"]');await firstRow.scrollIntoViewIfNeeded();await expect(firstRow).toContainText('スクロール投稿 0');
});

test('viewer uses real Bluesky like and unlike, and the normal action order', async ({page}) => {
 const state=await setup(page,false);
 await page.addInitScript(()=>localStorage.setItem('lime_bluesky_session',JSON.stringify({did:'did:plc:viewer',handle:'viewer.bsky.social',accessJwt:'fixture',refreshJwt:'fixture'})));
 let liked=false; const writes:string[]=[];
 await page.route('**/xrpc/**',async route=>{
  const request=route.request(), url=request.url();
  if(url.includes('getPostThread')) return route.fulfill({contentType:'application/json',body:JSON.stringify({thread:{post:{cid:'fixture-cid',viewer:liked?{like:'at://did:plc:viewer/app.bsky.feed.like/test'}:{}}}})});
  if(url.includes('createRecord')){writes.push(request.postDataJSON().record.subject.uri);liked=true;return route.fulfill({contentType:'application/json',body:JSON.stringify({uri:'at://did:plc:viewer/app.bsky.feed.like/test'})});}
  if(url.includes('deleteRecord')){writes.push('unlike');liked=false;return route.fulfill({contentType:'application/json',body:'{}'});}
  return route.fulfill({contentType:'application/json',body:'{"feed":[],"posts":[],"actors":[]}'});
 });
 await page.goto('./');
 const card=page.locator('[data-lime-post-card]').filter({hasText:'プレビューなし'}).first();await press(page,card.locator('[data-lime-post-body] img').first());
 const viewer=page.getByRole('dialog',{name:'メディアを拡大表示'}), actions=viewer.locator('.lime-media-bottom .lime-media-actions');
 await expect(actions.locator('svg.lucide-heart')).toHaveCount(1);
 await expect(actions.getByRole('button',{name:'リアクションを追加'})).toHaveCount(0);
 await press(page,actions.locator('[data-lime-post-action=like]'));await expect.poll(()=>writes[0]).toBe('at://did:plc:test/app.bsky.feed.post/demo');
 await expect(actions.locator('[data-lime-post-action=like]')).toHaveClass(/text-pink-500/);
 await press(page,actions.locator('[data-lime-post-action=like]'));await expect.poll(()=>writes.includes('unlike')).toBe(true);
 await press(page,viewer.getByRole('button',{name:'画像を閉じる'}));
 await press(page,page.locator('[data-lime-post-card]').filter({hasText:'写真の投稿'}).first().locator('[data-lime-post-body] img').first());
 const order=await Promise.all([actions.locator('[data-lime-post-action=like]'),actions.locator('[data-lime-post-action=repost]'),actions.getByRole('link',{name:'返信',exact:true}),actions.getByRole('button',{name:'リアクションを追加'})].map(el=>el.boundingBox()));
 expect(order.every((box,i)=>box && (i===0 || box.x>order[i-1]!.x))).toBe(true);
 await press(page,actions.getByRole('button',{name:'リアクションを追加'}));await expect(page.getByRole('button',{name:'👍',exact:true})).toBeVisible();await press(page,page.getByRole('button',{name:'👍',exact:true}));await expect.poll(()=>state.writes.some(write=>write.table==='post_reactions'&&write.body?.emoji==='👍')).toBe(true);
});

test('pinch and wheel zoom can reach image edges without page zoom; black padding closes',async({page})=>{
 await setup(page,false);await page.goto('./');await press(page,page.locator('[data-lime-post-card]').filter({hasText:'写真の投稿'}).first().locator('[data-lime-post-body] img').first());
 const viewer=page.getByRole('dialog',{name:'メディアを拡大表示'}),stage=viewer.locator('.lime-media-stage'),image=viewer.getByAltText('拡大画像 1');
 const rect=(await stage.boundingBox())!,cx=rect.x+rect.width/2,cy=rect.y+rect.height/2;
 await stage.dispatchEvent('pointerdown',{pointerId:10,pointerType:'touch',clientX:cx-20,clientY:cy});
 await stage.dispatchEvent('pointerdown',{pointerId:11,pointerType:'touch',clientX:cx+20,clientY:cy});
 await stage.dispatchEvent('pointermove',{pointerId:11,pointerType:'touch',clientX:cx+400,clientY:cy});
 await expect.poll(()=>image.evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).a)).toBeCloseTo(Math.pow(10.5,.7),4);
 await stage.dispatchEvent('pointerup',{pointerId:11,pointerType:'touch',clientX:cx+400,clientY:cy});
 await stage.dispatchEvent('pointermove',{pointerId:10,pointerType:'touch',clientX:cx-120,clientY:cy-100});
 await expect(image).not.toHaveCSS('transform',/matrix\([\d.]+, 0, 0, [\d.]+, 0, 0\)/);
 await stage.dispatchEvent('pointerup',{pointerId:10,pointerType:'touch',clientX:cx-120,clientY:cy-100});
 expect(await stage.evaluate(el=>!el.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:1000,clientX:20,clientY:20,bubbles:true,cancelable:true})))).toBe(true);
 await expect(image).toHaveCSS('transform',/matrix\(1, 0, 0, 1, 0, 0\)/);
 expect(await stage.evaluate(el=>!el.dispatchEvent(new Event('gesturestart',{bubbles:true,cancelable:true})))).toBe(true);
 await stage.dispatchEvent('pointerdown',{pointerId:12,pointerType:'touch',clientX:rect.x+5,clientY:rect.y+5});
 await stage.dispatchEvent('pointerup',{pointerId:12,pointerType:'touch',clientX:rect.x+5,clientY:rect.y+5});
 await expect(viewer).toHaveCount(0);
 expect(await page.evaluate(()=>window.visualViewport?.scale)).toBe(1);
});

 test('quote from the viewer opens the actual composer without trapping it behind the image',async({page})=>{
 await setup(page,false);await page.goto('./');await press(page,page.locator('[data-lime-post-card]').filter({hasText:'写真の投稿'}).first().locator('[data-lime-post-body] img').first());
 const viewer=page.getByRole('dialog',{name:'メディアを拡大表示'});await press(page,viewer.locator('.lime-media-bottom [data-lime-post-action=repost]'));await press(page,page.getByRole('menuitem',{name:'引用リポスト',exact:true}));
 await expect(viewer).toHaveCount(0);const composer=page.getByRole('dialog',{name:'引用リポスト',exact:true});await expect(composer).toBeVisible();await expect(composer.getByText('写真の投稿',{exact:true})).toBeVisible();await expect(composer.locator('textarea')).toBeEditable();
 });

test('reference reply layout keeps the mobile launcher plain and opens a multiline reply screen',async({page},info)=>{
 const state=await setup(page,false);await page.goto('./');await press(page,page.locator('[data-lime-post-card]').filter({hasText:'写真の投稿'}).first().locator('[data-lime-post-body] img').first());
 const viewer=page.getByRole('dialog',{name:'メディアを拡大表示'});
 if((page.viewportSize()?.width??0)<768){
  await expect(viewer.locator('.lime-media-mobile-reply .reply-submit')).toHaveCount(0);
  await expect(viewer.getByRole('button',{name:'返信を入力'})).toBeVisible();
  await press(page,viewer.getByRole('button',{name:'返信を入力'}));
  const reply=page.getByRole('dialog',{name:'返信を作成',exact:true});await expect(reply).toBeVisible();
  const input=reply.getByPlaceholder('返信をポスト');await expect(input).toHaveJSProperty('tagName','TEXTAREA');await expect(input).toBeFocused();
  await expect(reply.locator('.lime-media-reply-source')).toContainText('写真の投稿');
  await input.fill('1行目\n2行目');await page.screenshot({path:info.outputPath('reply-editing.png'),animations:'disabled'});
  await press(page,reply.getByRole('button',{name:'返信入力を閉じる'}));await expect(reply).toHaveCount(0);await expect(viewer).toBeVisible();
  await press(page,viewer.getByRole('button',{name:'返信を入力'}));await expect(input).toHaveValue('1行目\n2行目');
  await press(page,reply.getByRole('button',{name:'コメントを送信',exact:true}));await expect.poll(()=>state.writes.some(write=>write.table==='comments'&&write.body?.content==='1行目\n2行目')).toBe(true);await expect(reply).toHaveCount(0);await expect(viewer).toBeVisible();
 }else{
  const composer=viewer.locator('[data-variant=mediaViewer]');const input=composer.getByPlaceholder('返信をポスト'),submit=composer.getByRole('button',{name:'コメントを送信'});await expect(submit).toHaveText('返信');
  const buttonBefore=await submit.boundingBox();await input.fill('1行目\n2行目');await expect(composer.getByRole('button',{name:'返信に画像を添付'})).toBeVisible();
  const buttonAfter=await submit.boundingBox();expect(buttonAfter!.x).toBeCloseTo(buttonBefore!.x,1);expect(buttonAfter!.y).toBeCloseTo(buttonBefore!.y,1);
  await page.screenshot({path:info.outputPath('reply-editing.png'),animations:'disabled'});await composer.screenshot({path:info.outputPath('desktop-reply.png'),animations:'disabled'});
  await press(page,submit);await expect.poll(()=>state.writes.some(write=>write.table==='comments'&&write.body?.content==='1行目\n2行目')).toBe(true);
 }
});

test('image swipe animates the adjacent image before changing its selected dot',async({page})=>{
 await setup(page,false);await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('./');await press(page,page.locator('[data-lime-post-card]').filter({hasText:'写真の投稿'}).first().locator('[data-lime-post-body] img').first());
 const viewer=page.getByRole('dialog',{name:'メディアを拡大表示'}),stage=viewer.locator('.lime-media-stage');
 await viewer.locator('.lime-media-adjacent').evaluate(el=>{(window as any).__nextMediaImage=el;});
 const rect=(await stage.boundingBox())!,cx=rect.x+rect.width/2,cy=rect.y+rect.height/2;
 await stage.dispatchEvent('pointerdown',{pointerId:31,pointerType:'touch',clientX:cx+50,clientY:cy});await stage.dispatchEvent('pointermove',{pointerId:31,pointerType:'touch',clientX:cx-70,clientY:cy});
 await expect(viewer.locator('.lime-media-image-track')).toHaveCSS('transform',/matrix\(1, 0, 0, 1, -120, 0\)/);
 await expect(viewer.locator('.lime-media-adjacent')).toHaveAttribute('src','https://media.example/two.svg');
 await stage.dispatchEvent('pointerup',{pointerId:31,pointerType:'touch',clientX:cx-70,clientY:cy});
 await expect.poll(()=>viewer.locator('.lime-media-image-track').evaluate(el=>el.getAnimations().length)).toBeGreaterThan(0);
 await expect(viewer.getByAltText('拡大画像 2')).toBeVisible();await expect(viewer.getByRole('button',{name:'画像 2',exact:true})).toHaveAttribute('aria-current','true');
 expect(await viewer.getByAltText('拡大画像 2').evaluate(el=>el===(window as any).__nextMediaImage)).toBe(true);
 await expect(viewer.locator('.lime-media-image-track')).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)');
});

 test('image three-dot menu preserves navigation and a transparent mobile backdrop',async({page})=>{
 await setup(page,false);await page.goto('./');await press(page,page.locator('[data-lime-post-card]').filter({hasText:'写真の投稿'}).first().locator('[data-lime-post-body] img').first());
 const viewer=page.getByRole('dialog',{name:'メディアを拡大表示'});
 await press(page,viewer.getByRole('button',{name:'ポストのメニュー'}).filter({visible:true}));
 await expect(page.locator('[data-lime-media-sheet=menu]')).toBeVisible();
 if((page.viewportSize()?.width??0)<640)await expect(page.locator('.lime-post-options-backdrop')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 await press(page,page.getByRole('button',{name:'ポストに移動',exact:true}));
 await expect(page).toHaveURL(/post\/native$/);await expect(viewer).toHaveCount(0);
 });


test('viewer keeps follow labels intact on mobile and uses full-width themed desktop rules',async({page},info)=>{
 await setup(page,false);
 await page.addInitScript(()=>localStorage.setItem('theme','light'));
 await page.route('**/rest/v1/follows?**',route=>route.fulfill({contentType:'application/json',body:route.request().method()==='HEAD'?'':JSON.stringify({follower_id:'11111111-1111-1111-1111-111111111111'})}));
 await page.route('https://media.example/portrait.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="900"><rect width="400" height="900" fill="#e8bfd3"/></svg>'}));
 await page.goto('./');await expect(page.locator('[data-lime-post-card]').first()).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('lime-open-media-viewer',{detail:{url:'https://media.example/portrait.svg',post:{id:'other-photo',userId:'22222222-2222-2222-2222-222222222222',author:{id:'22222222-2222-2222-2222-222222222222',username:'other',displayName:'最強マンDXねこちゃんと長い名前',avatarUrl:'',isOfficial:true},content:'写真の投稿',createdAt:'2026-10-01T00:00:00Z',likesCount:2,imageUrls:['https://media.example/portrait.svg'],visibility:'public'}}})));
 const viewer=page.getByRole('dialog',{name:'メディアを拡大表示'});await expect(viewer.getByAltText('拡大画像 1')).toBeVisible();
 await expect(viewer.locator('.lime-media-download,.lime-media-stats')).toHaveCount(0);
 if(page.viewportSize()!.width<768){
  const follow=viewer.locator('.lime-media-mobile-summary .lime-media-follow button');await expect(follow).toHaveAttribute('aria-busy','false');
  expect((await follow.boundingBox())!.width).toBeGreaterThan(65);expect((await follow.boundingBox())!.height).toBe(32);
  await expect(follow).toContainText('フォロー中');
  await expect(viewer.locator('.lime-media-reply-launcher')).toHaveCSS('backdrop-filter','blur(18px)');
  const like=viewer.locator('.lime-media-bottom [data-lime-post-action=like]');expect(await like.evaluate(el=>getComputedStyle(el).backdropFilter==='blur(18px)'||getComputedStyle(el.parentElement!).backdropFilter==='blur(18px)')).toBe(true);
 }else{
  await expect(viewer.locator('.lime-media-follow').filter({visible:true})).toHaveCount(0);
  await expect(viewer.locator('.lime-media-detail')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(viewer.locator('.lime-media-detail .lime-media-display-name')).toHaveCSS('white-space','nowrap');
  const panel=(await viewer.locator('.lime-media-detail').boundingBox())!, actions=(await viewer.locator('.lime-media-detail>.lime-media-actions').boundingBox())!;
  expect(actions.x-panel.x).toBeCloseTo(1,0);expect(actions.width).toBeCloseTo(panel.width-1,0);
  const comment=(await viewer.locator('[data-lime-comment-card]').first().boundingBox())!;expect(comment.width).toBeCloseTo(panel.width-1,0);
  await page.evaluate(()=>document.documentElement.classList.add('dark'));await expect(viewer.locator('.lime-media-detail')).toHaveCSS('background-color','rgb(0, 0, 0)');
  await page.evaluate(()=>document.documentElement.classList.remove('dark'));
 }
 await page.screenshot({path:info.outputPath('targeted-viewer.png'),animations:'disabled'});
 if(page.viewportSize()!.width<768){await viewer.locator('.lime-media-stage').dblclick();await expect(viewer).toHaveClass(/lime-media-zoomed/);await page.screenshot({path:info.outputPath('zoomed-viewer.png'),animations:'disabled'});await viewer.locator('.lime-media-stage').dblclick();}
 const stage=viewer.locator('.lime-media-stage'), rect=(await stage.boundingBox())!;
 await expect.poll(()=>viewer.getByAltText('拡大画像 1').evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBe(400);
 await page.mouse.click(rect.x+5,rect.y+rect.height/2);await expect(viewer).toHaveCount(0);
});

test('reply dock expands when idle and retains its input through keyboard viewport changes',async({page})=>{
 test.skip((page.viewportSize()?.width??0)>=640,'Mobile reply dock');
 await setup(page,false);await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('post/native');
 const composer=page.locator('[data-variant=bottomNav]'),input=composer.getByPlaceholder('返信をポスト');await expect(input).toBeVisible();
 const idleWidth=(await input.boundingBox())!.width;
 expect(await composer.evaluate(el=>getComputedStyle(el).transitionProperty)).toContain('grid-template-columns');
 await input.evaluate(el=>{(window as any).__replyInput=el;});await input.focus();await input.fill('入力を維持');
 await expect.poll(async()=> (await input.boundingBox())!.width).toBeLessThan(idleWidth-60);
 const sizes=await composer.locator('[data-lime-attachment-tool] svg').evaluateAll(els=>els.map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));
 expect(sizes.length).toBe(2);for(const size of sizes)expect(size).toEqual({width:20,height:20});
 await page.evaluate(()=>{const viewport=window.visualViewport!;Object.defineProperty(viewport,'height',{configurable:true,value:window.innerHeight-280});viewport.dispatchEvent(new Event('resize'));});
 await expect(input).toBeFocused();await expect(input).toHaveValue('入力を維持');expect(await input.evaluate(el=>el===(window as any).__replyInput)).toBe(true);
 await expect.poll(()=>composer.evaluate(el=>getComputedStyle(el.closest('nav')!).bottom)).toBe('280px');
 await input.evaluate(el=>(el as HTMLTextAreaElement).blur());await expect.poll(async()=> (await input.boundingBox())!.width).toBeGreaterThan(idleWidth-2);
});

test('short touch swipes do not switch images and reply source shares the post card and avatar line',async({page})=>{
 test.skip((page.viewportSize()?.width??0)>=768,'Mobile touch controls');
 await setup(page,false);await page.goto('./');await press(page,page.locator('[data-lime-post-card]').filter({hasText:'写真の投稿'}).first().locator('[data-lime-post-body] img').first());
 const viewer=page.getByRole('dialog',{name:'メディアを拡大表示'}),stage=viewer.locator('.lime-media-stage');
 await stage.dispatchEvent('pointerdown',{pointerId:70,pointerType:'touch',clientX:200,clientY:260});await stage.dispatchEvent('pointermove',{pointerId:70,pointerType:'touch',clientX:140,clientY:260});await stage.dispatchEvent('pointerup',{pointerId:70,pointerType:'touch',clientX:140,clientY:260});
 await expect(viewer.getByAltText('拡大画像 1')).toBeVisible();await expect(viewer.locator('.lime-media-image-track')).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)');
 await press(page,viewer.getByRole('button',{name:'返信を入力'}));const reply=page.getByRole('dialog',{name:'返信を作成',exact:true});
 await expect(reply.locator('[data-lime-embedded] [data-lime-post-body]')).toContainText('写真の投稿');await expect(reply.locator('[data-lime-embedded] [data-lime-post-body] img')).toHaveCount(2);
 const avatars=await reply.locator('[data-lime-thread-avatar]').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return{x:r.x+r.width/2,width:r.width,height:r.height};}));expect(avatars).toHaveLength(2);expect(avatars[0].x).toBe(avatars[1].x);for(const a of avatars){expect(a.width).toBe(40);expect(a.height).toBe(40);}
 await expect(reply.locator('svg line')).toHaveCount(1);
});

test('mobile image action circles and glyphs align including the direct reply link',async({page},info)=>{
 test.skip((page.viewportSize()?.width??0)>=768,'Mobile action circles');await setup(page,false);await page.goto('./');await press(page,page.locator('[data-lime-post-card]').filter({hasText:'写真の投稿'}).first().locator('[data-lime-post-body] img').first());
 const row=page.locator('.lime-media-bottom [data-lime-post-actions]');const circles=await row.evaluate(el=>Array.from(el.children).slice(0,4).map(el=>{const rect=el.getBoundingClientRect(),svg=el.querySelector('svg:not(.twitter-like-effects)')!.getBoundingClientRect();return{width:rect.width,height:rect.height,center:rect.y+rect.height/2,svgWidth:svg.width,svgHeight:svg.height,svgCenter:svg.y+svg.height/2};}));
 for(const circle of circles){expect(circle.width).toBe(40);expect(circle.height).toBe(40);expect(circle.center).toBe(circles[0].center);expect(circle.svgWidth).toBe(20);expect(circle.svgHeight).toBe(20);expect(circle.svgCenter).toBe(circle.center);}
 await page.screenshot({path:info.outputPath('uniform-actions.png')});
});

test('saved LimeAI model displays across pages, supports placement and persists settings',async({page},info)=>{
 test.skip(info.project.name==='small-mobile'||info.project.name==='WebKit-iPhone','Real WebGL verified in Chrome desktop and mobile');
 await setup(page,false);await page.goto('./');
 await expect(page.locator('[data-lime-page-companion]')).toHaveCount(0);
 await page.evaluate(async()=>{const response=await fetch('/RaimuNoteSNS.github.io/models/robot-expressive.glb');const blob=await response.blob();await new Promise<void>((resolve,reject)=>{const req=indexedDB.open('limeai-avatar',1);req.onupgradeneeded=()=>req.result.createObjectStore('models',{keyPath:'id'});req.onsuccess=()=>{const db=req.result,tx=db.transaction('models','readwrite');tx.objectStore('models').put({id:'companion-test',name:'保存済みロボット',blob,createdAt:Date.now(),format:'glb'});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};req.onerror=()=>reject(req.error);});});
 await page.goto('settings');const settings=page.locator('[data-lime-companion-settings]');await expect(settings).toBeVisible();
 await expect(settings.locator('select#companion-model option[value=companion-test]')).toHaveText('保存済みロボット');await settings.locator('#companion-model').selectOption('companion-test');await press(page,settings.getByRole('switch',{name:'全ページにキャラクターを表示'}));
 const widget=page.getByRole('complementary',{name:'LimeAI キャラクター',exact:true});await expect(widget.locator('canvas')).toBeVisible({timeout:30000});await expect(widget.getByRole('status')).toHaveCount(0,{timeout:30000});await expect(widget.getByRole('alert')).toHaveCount(0);
 expect(await widget.locator('canvas').evaluate(canvas=>(canvas as HTMLCanvasElement).width)).toBeGreaterThan(100);
 await page.screenshot({path:info.outputPath('companion-settings.png')});
 if(info.project.name==='desktop'){
  const before=await widget.boundingBox();const bounds=await widget.locator('canvas').boundingBox();
  await page.mouse.move(bounds!.x+bounds!.width/2,bounds!.y+bounds!.height/2);await page.mouse.down();await page.mouse.move(bounds!.x+bounds!.width/2-80,bounds!.y+bounds!.height/2-60,{steps:8});await page.mouse.up();
  await expect.poll(async()=>Math.round((await widget.boundingBox())!.x)).toBe(Math.round(before!.x-80));
 }

 if(info.project.name==='mobile'){
  const before=await widget.boundingBox(),bounds=await widget.locator('canvas').boundingBox(),cdp=await page.context().newCDPSession(page);
  const x=bounds!.x+bounds!.width/2,y=bounds!.y+bounds!.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-50,y:y-40}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(async()=>Math.round((await widget.boundingBox())!.x)).toBe(Math.round(before!.x-50));await cdp.detach();
 }

 const canvas=await widget.locator('canvas').elementHandle();await page.evaluate(()=>{(window as any).__companionCanvas=document.querySelector('[data-lime-page-companion] canvas');});
 if((page.viewportSize()?.width??0)>=768)await page.getByRole('button',{name:'検索',exact:true}).first().click();else await press(page,page.locator('a[href$="/search"]').first());await expect(page).toHaveURL(/search/);await expect(widget.locator('canvas')).toBeVisible();expect(await widget.locator('canvas').evaluate(el=>el===(window as any).__companionCanvas)).toBe(true);
 await expect(widget.getByRole('button',{name:'キャラクターを移動'})).toHaveCount(0);const handle=widget.locator('canvas');await handle.dispatchEvent('pointerdown',{pointerId:50,clientX:300,clientY:300});await handle.dispatchEvent('pointermove',{pointerId:50,clientX:-1500,clientY:200});await handle.dispatchEvent('pointerup',{pointerId:50,clientX:-1500,clientY:200});
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('lime-companion:11111111-1111-1111-1111-111111111111')!).x)).toBeLessThan(0);
 await handle.dispatchEvent('pointerdown',{pointerId:51,clientX:0,clientY:0});await handle.dispatchEvent('pointerup',{pointerId:51,clientX:1800,clientY:100});
 await page.reload();await expect(widget.locator('canvas')).toBeVisible({timeout:30000});await widget.hover();await press(page,widget.getByRole('button',{name:'キャラクターを非表示'}));await expect(widget).toHaveCount(0);
 await canvas?.dispose();
});

test('native URL cards restore saved metadata and image after reloading',async({page})=>{
 const state=await setup(page,false);
 state.extraPosts.push({id:'preview-native',userId:'11111111-1111-1111-1111-111111111111',content:'保存するカード https://preview.example/cache',createdAt:'2026-10-01T00:00:00Z',imageUrls:[],visibility:'public',likesCount:0,commentsCount:0,repostsCount:0,author:{id:'11111111-1111-1111-1111-111111111111',username:'lime',displayName:'Lime Note',avatarUrl:''}});
 await page.route('https://preview.example/cover.svg',route=>route.fulfill({contentType:'image/svg+xml',headers:{'access-control-allow-origin':'*'},body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="180"><rect width="400" height="180" fill="pink"/></svg>'}));
 await page.goto('post/preview-native');const card=page.locator('[data-link-preview]').first();await expect(card).toBeVisible();
 await expect.poll(()=>page.evaluate(async()=>{const {savedPreviewImage}=await import('/RaimuNoteSNS.github.io/src/lib/linkPreviewCache.ts');return !!await savedPreviewImage('https://preview.example/cover.svg');})).toBe(true);
 const requests:string[]=[];page.on('request',request=>{if(request.url().includes('/functions/v1/link-preview')||request.url()==='https://preview.example/cover.svg')requests.push(request.url());});
 await page.reload();await expect(card).toBeVisible();await expect(card.locator('img')).toHaveAttribute('src',/^blob:/);
 expect(requests).toEqual([]);
});


test('reply options preserve activity navigation on all devices',async({page})=>{
 await setup(page,false);await page.goto('post/native');
 await press(page,page.getByRole('button',{name:'コメントのメニュー',exact:true}).first());await press(page,page.getByRole('button',{name:'ポストアクティビティ',exact:true}));
 await expect(page).toHaveURL(/activity\?reply=child$/);
});

test('mobile repost sheet floats over dimmed background without hiding navigation',async({page},info)=>{
 test.skip((page.viewportSize()?.width??0)>=640,'Phone action sheet');
 await setup(page,false);await page.addInitScript(()=>localStorage.setItem('theme','light'));await page.goto('./');
 const post=page.locator('[data-lime-post-card]').filter({hasText:'写真の投稿'}).first();
 const trigger=post.locator('[data-lime-post-action="repost"]');
 await press(page,trigger);
 const sheet=page.locator('.lime-post-action-sheet'),backdrop=page.locator('.lime-post-action-sheet-backdrop');
 await expect(sheet).toBeVisible();await expect(backdrop).toHaveCSS('background-color','rgba(0, 0, 0, 0.35)');
 await expect(page.locator('[data-lime-bottom-nav-root]')).toBeVisible();
 await expect(page.locator('[data-lime-app-header]')).toBeVisible();
 const box=await sheet.boundingBox();expect(Math.abs(box!.y+box!.height-(page.viewportSize()!.height-8))).toBeLessThan(2);expect(box!.x).toBe(8);
 await page.screenshot({path:info.outputPath('repost-sheet-light.png')});
 await expect(sheet.locator('.lime-post-sheet-close')).toHaveCount(0);await backdrop.tap({position:{x:10,y:80}});await expect(sheet).toHaveCount(0);
 await press(page,trigger);await expect(sheet).toBeVisible();
 await backdrop.tap({position:{x:10,y:80}});await expect(sheet).toHaveCount(0);
 await press(page,post.locator('[data-lime-post-body] img').first());
 const viewer=page.getByRole('dialog',{name:'メディアを拡大表示'});
 await press(page,viewer.locator('.lime-media-bottom [data-lime-post-action="repost"]'));await expect(sheet).toBeVisible();
 await expect(sheet.locator('.lime-post-sheet-close')).toHaveCount(0);await backdrop.tap({position:{x:10,y:80}});await expect(sheet).toHaveCount(0);await expect(viewer).toBeVisible();
});

test('mobile profile cover reaches the top, header stays when scrolling, and pull stretches cover',async({page},info)=>{
 test.skip((page.viewportSize()?.width??0)>=640,'Mobile profile');
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error' && message.text().includes('inert'))errors.push(message.text());});
 let profileReads=0;page.on('request',request=>{if(request.url().includes('/__bookmark-fixture/profile-posts?'))profileReads++;});
 await setup(page,false);
 await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent='body { padding-top: 44px !important; }';document.head.append(style);}));
 await page.route('**/*.supabase.co/rest/v1/profiles*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({id:'11111111-1111-1111-1111-111111111111',username:'lime',display_name:'Lime Note',avatar_url:'',cover_url:'https://media.example/one.svg',created_at:'2026-10-01T00:00:00Z',bio:'プロフィールの自己紹介',location:'東京都'})}));
 await page.goto('u/lime');
 const cover=page.locator('.profile-header-cover-avatar-gap'),header=page.locator('header[data-lime-mobile-profile-header-hidden=true]');
 await expect(cover).toBeVisible();await expect(header.locator("[data-lime-header-row]")).toBeVisible();
 if(info.project.name==='WebKit-iPhone')expect((await cover.boundingBox())!.y).toBe(0);
 await expect(header.getByText('Lime Note',{exact:true})).toHaveCount(1);
 expect((await header.locator('[data-lime-header-row]').boundingBox())!.height).toBeLessThanOrEqual(56);
 await expect(page.locator('[data-lime-profile-tabs-header]')).toHaveCSS('height','44px');
 await press(page,header.getByRole('button',{name:'プロフィールのその他のメニュー'}));
 const copy=page.getByRole('menuitem',{name:'リンクをコピー',exact:true});await expect(copy).toBeVisible();
 expect(await copy.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
 await page.keyboard.press('Escape');
 await page.screenshot({path:info.outputPath('profile-top.png')});
 await page.evaluate(()=>window.scrollTo(0,280));await expect(header).toHaveAttribute('data-lime-profile-scrolled','true');await expect(header.locator('.lime-profile-bar-title')).toHaveCSS('opacity','1');
 await expect(header.locator('.lime-profile-bar-background')).toHaveCSS('opacity','1');
 expect((await header.locator('[data-lime-header-row]').boundingBox())!.y).toBe(0);
 await page.screenshot({path:info.outputPath('profile-scrolled.png'),animations:'disabled'});
 await page.evaluate(()=>window.scrollTo(0,0));
 for(let i=0;i<4;i++){
  await page.evaluate(()=>window.scrollTo(0,600));
  await expect(header.locator('.lime-profile-bar-background')).toBeVisible();
  await page.evaluate(()=>window.scrollTo(0,0));
  await expect(header.locator('.lime-profile-bar-background')).toBeHidden();
 }
 await expect(cover).toHaveCSS('mask-image','none');
 await expect(cover.locator('img').first()).toHaveCSS('filter','none');
 await expect(cover.locator('img').first()).toHaveCSS('transform','none');
 await page.screenshot({path:info.outputPath('profile-returned-to-top.png')});
 await expect(page.locator('[data-lime-profile-posts]').getByText('写真の投稿',{exact:true}).first()).toBeVisible();
 const readsBeforePull=profileReads;
 const initial=(await cover.boundingBox())!.height;
 await cover.evaluate(el=>{
  const target=el.querySelector('img') ?? el.querySelector('button') ?? el;
  const touch=(type:string,y:number)=>{const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'touches',{value:[{identifier:1,target,clientX:150,clientY:y}]});target.dispatchEvent(event);};
  touch('touchstart',100);touch('touchmove',260);
 });
 await expect(page.locator('[data-lime-profile-page]')).toHaveAttribute('data-lime-profile-pulling','true');
 await expect.poll(async()=>(await cover.boundingBox())!.height).toBeGreaterThan(initial+60);
 await expect(page.locator('[data-lime-profile-pull-indicator]')).toHaveCSS('opacity','1');
 await expect(cover.locator('img').first()).toHaveCSS('filter', /blur\(/);
 await expect(page.locator('[data-lime-profile-avatar]')).not.toHaveCSS('transform','none');
 await page.screenshot({path:info.outputPath('profile-pull.png')});
 await cover.evaluate(el=>el.dispatchEvent(new Event('touchend',{bubbles:true})));
 await expect(page.locator('[data-lime-profile-page]')).not.toHaveAttribute('data-lime-profile-pulling','true');
 await expect.poll(async()=>(await cover.boundingBox())!.height).toBe(initial);
 await expect.poll(()=>profileReads).toBeGreaterThan(readsBeforePull);
 await expect(page.locator('[data-lime-bottom-nav-root]')).toBeVisible();
 expect(errors).toEqual([]);
 await page.goto('settings');
 if(info.project.name==='WebKit-iPhone')await expect(page.locator('body')).toHaveCSS('padding-top','44px');
 await expect(page.locator('html')).not.toHaveAttribute('data-lime-iphone-profile','true');
});

for (const theme of ['light','dark']) test(`mobile profile without a cover uses a grey borderless header and restores the follow transition (${theme})`,async({page},info)=>{
 test.skip((page.viewportSize()?.width??0)>=640,'Phone profile');
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&m.text().includes('Warning:'))errors.push(m.text());});
 await setup(page,false);await page.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
 await page.route('**/src/api/follows.ts*',route=>route.fulfill({contentType:'application/javascript',body:'export const getFollowStats=async()=>({following:22,followers:86,followedByMe:true});export const toggleFollow=async()=>({following:false});export const getFollowing=async()=>[];export const getFollowers=async()=>[];'}));
 await page.route('**/*.supabase.co/rest/v1/profiles*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({id:'22222222-2222-2222-2222-222222222222',username:'other',display_name:'User',avatar_url:'',cover_url:null,created_at:'2026-10-01T00:00:00Z'})}));
 await page.goto('u/other');
 const header=page.locator('header[data-lime-mobile-profile-header-hidden=true]');
 await expect(header).toHaveAttribute('data-lime-profile-no-cover','true');
 await expect(header.locator('.lime-profile-bar-background')).toHaveCSS('background-color',theme==='light'?'rgb(180, 178, 178)':'rgb(100, 98, 98)');
 await page.screenshot({path:info.outputPath('no-cover-top.png')});
 await page.evaluate(()=>window.scrollTo(0,600));
 await expect(header.locator('.lime-profile-bar-title')).toHaveCSS('opacity','1');
 await expect(header).toHaveCSS('border-bottom-width','0px');
 await expect(header).toHaveCSS('box-shadow','none');
 await expect(header).toHaveCSS('backdrop-filter','none');
 if(info.project.name==='WebKit-iPhone')await expect(header).toHaveCSS('-webkit-backdrop-filter','none');
 await expect(header.locator('.lime-profile-bar-follow')).toHaveCSS('width','124px');
 await expect(header.locator('.lime-profile-bar-follow')).toHaveCSS('transition-duration','0.18s, 0.18s, 0.18s');
 await expect(header.locator('.lime-profile-bar-follow')).not.toHaveAttribute('inert','');
 await expect(page.locator('[data-lime-profile-tabs-header]')).toHaveCSS('height','44px');
 await page.screenshot({path:info.outputPath('no-cover-scrolled.png')});
 await page.evaluate(()=>window.scrollTo(0,0));await expect(header.locator('.lime-profile-bar-title')).toHaveCSS('opacity','0');
 await expect(header.locator('.lime-profile-bar-follow')).toHaveCSS('width','0px');
 await expect(header.locator('.lime-profile-bar-follow')).toHaveAttribute('inert','');
 expect(errors).toEqual([]);
});

test('profile cover has no horizontal band at the control row boundary',async({page},info)=>{
 test.skip(info.project.name!=='mobile','Reproduce the supplied width');
 await page.setViewportSize({width:556,height:994});await setup(page,false);
 await page.route('**/*.supabase.co/rest/v1/profiles*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({id:'11111111-1111-1111-1111-111111111111',username:'lime',display_name:'Lime Note',avatar_url:'',cover_url:'https://media.example/one.svg',created_at:'2026-10-01T00:00:00Z'})}));
 await page.goto('u/lime');await expect(page.locator('.profile-header-cover-avatar-gap img')).toBeVisible();
 await page.screenshot({path:info.outputPath('cover-boundary.png')});
 const header=page.locator('header[data-lime-mobile-profile-header-hidden=true]');
 await expect(header).toHaveCSS('display','contents');
 await expect(header.locator('[data-lime-header-row]')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 await expect(header.locator('[data-lime-header-row]')).toHaveCSS('border-bottom-width','0px');
 const row=await header.locator('[data-lime-header-row]').boundingBox();
 const points=await page.evaluate(y=>[100,200,300,400,500].map(x=>{const el=document.elementFromPoint(x,y);return !!el?.closest('.profile-header-cover-avatar-gap');}),row!.y+row!.height+1);
 expect(points).toEqual([true,true,true,true,true]);
});

test('profile header requests metadata when mounted after the profile',async({page},info)=>{
 test.skip(info.project.name!=='mobile','Viewport lifecycle');
 await setup(page,false);await page.setViewportSize({width:900,height:900});await page.goto('u/lime');
 await expect(page.locator('[data-lime-profile-name]')).toContainText('Lime Note');
 await page.setViewportSize({width:390,height:844});
 const header=page.locator('header[data-lime-mobile-profile-header-hidden=true]');
 await expect(header.locator('.lime-profile-bar-title')).toContainText('Lime Note');
});

test('profile header fills the status area instead of adding top padding',async({page},info)=>{
 test.skip(!['mobile','WebKit-iPhone'].includes(info.project.name),'Phone status area');
 await setup(page,false);
 await page.route('**/*.supabase.co/rest/v1/profiles*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({id:'11111111-1111-1111-1111-111111111111',username:'lime',display_name:'Lime Note',avatar_url:'',cover_url:'https://media.example/one.svg',created_at:'2026-10-01T00:00:00Z'})}));
 await page.goto('./');
 const initialMedia=await page.evaluate(()=>Array.from(document.querySelectorAll('meta[name="theme-color"]')).map(meta=>meta.getAttribute('media')));
 await page.goto('u/lime');
 await expect.poll(()=>page.evaluate(()=>Array.from(document.querySelectorAll('meta[name="theme-color"]')).every(meta=>meta.getAttribute('media')==='not all'))).toBe(true);
 await page.evaluate(()=>document.documentElement.style.setProperty('--lime-profile-system-top','44px'));
 const row=page.locator('header[data-lime-mobile-profile-header-hidden=true] [data-lime-header-row]');
 const cover=page.locator('.profile-header-cover-avatar-gap');
 await expect(cover).toBeVisible();
 await expect(row).toHaveCSS('height','100px');await expect(row).toHaveCSS('padding-top','0px');
 expect((await cover.boundingBox())!.y).toBe(0);await expect(cover).toHaveCSS('height','194px');
 expect((await row.getByRole('button',{name:'戻る',exact:true}).boundingBox())!.y).toBe(52);
 await page.evaluate(()=>window.scrollTo(0,600));
 const background=row.locator('.lime-profile-bar-background');await expect(background).toBeVisible();
 expect((await background.boundingBox())!.y).toBe(0);expect((await background.boundingBox())!.height).toBe(100);
 await expect(row.locator('.lime-profile-bar-title')).toHaveCSS('text-shadow','rgba(0, 0, 0, 0.18) 0px 1px 2px');
 await page.screenshot({path:info.outputPath('expanded-profile-header.png')});
 await page.goto('./');await expect.poll(()=>page.evaluate(()=>Array.from(document.querySelectorAll('meta[name="theme-color"]')).map(meta=>meta.getAttribute('media')))).toEqual(initialMedia);
});
