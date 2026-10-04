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
 await press(page,actions.locator('[data-lime-post-action="repost"]'));await expect(page.getByRole('menuitem',{name:'リポストする',exact:true})).toBeVisible();await press(page,page.getByRole('menuitem',{name:'リポストする',exact:true}));
 await press(page,actions.getByRole('link',{name:'返信',exact:true}));
 const replyScope=(page.viewportSize()?.width??0)<768?page.getByRole('dialog',{name:'返信を作成',exact:true}):viewer;const replyInput=replyScope.locator('textarea:visible,input:visible').first();await expect(replyInput).toBeFocused();
 await replyInput.fill('ビューアーからの返信');await press(page,replyScope.getByRole('button',{name:'コメントを送信',exact:true}).filter({visible:true}).first());await expect.poll(()=>state.writes.some(write=>write.table==='comments'&&write.body?.content==='ビューアーからの返信'&&write.body?.post_id==='native')).toBe(true);
 await press(page,actions.locator('[data-lime-post-action=like]'));await expect.poll(()=>state.writes.some(write=>write.table==='likes'&&write.body?.post_id==='native')).toBe(true);
 await expect(actions.locator('[data-lime-post-action=like]')).toHaveClass(/text-pink-500/);
 await page.screenshot({path:info.outputPath('viewer.png'),animations:'disabled'});
 await press(page,actions.getByRole('button',{name:'ポストを共有',exact:true}));await press(page,page.getByText('その他の方法でポストを送信',{exact:true}));await expect.poll(()=>page.evaluate(()=>(window as any).__mediaShared?.url)).toContain('/post/native');
 await press(page,viewer.getByRole('button',{name:'ポストのメニュー'}).filter({visible:true}));
 const save=page.getByRole('button',{name:'画像を保存',exact:true}).filter({visible:true});const download=page.waitForEvent('download');await press(page,save);expect((await download).suggestedFilename()).toContain('LimeNote-2');
 await press(page,viewer.getByRole('button',{name:'画像を閉じる'}));await expect(viewer).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
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
 await expect(image).toHaveCSS('transform',/10.5/);
 await stage.dispatchEvent('pointerup',{pointerId:11,pointerType:'touch',clientX:cx+400,clientY:cy});
 await stage.dispatchEvent('pointermove',{pointerId:10,pointerType:'touch',clientX:cx-120,clientY:cy-100});
 await expect(image).not.toHaveCSS('transform',/matrix\(10.5, 0, 0, 10.5, 0, 0\)/);
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

 test('mobile image menu is a bottom sheet and its post link navigates to the real post',async({page})=>{
 await setup(page,false);await page.goto('./');await press(page,page.locator('[data-lime-post-card]').filter({hasText:'写真の投稿'}).first().locator('[data-lime-post-body] img').first());
 const viewer=page.getByRole('dialog',{name:'メディアを拡大表示'});await press(page,viewer.getByRole('button',{name:'ポストのメニュー'}).filter({visible:true}));
 const sheet=page.locator('[data-lime-media-sheet=menu]');await expect(sheet).toBeVisible();
 if((page.viewportSize()?.width??0)<768){const rect=(await sheet.boundingBox())!;expect(rect.x).toBe(0);expect(rect.width).toBe(page.viewportSize()!.width);expect(Math.abs(rect.y+rect.height-page.viewportSize()!.height)).toBeLessThan(2);}
 await press(page,sheet.getByRole('button',{name:'ポストに移動',exact:true}));await expect(page).toHaveURL(/post\/native$/);await expect(viewer).toHaveCount(0);
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
