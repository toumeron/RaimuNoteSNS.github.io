import { test, expect, type Page, type Locator } from '@playwright/test';
const user={id:'11111111-1111-1111-1111-111111111111',username:'lime',displayName:'Lime Note',avatarUrl:'',createdAt:'2026-10-01T00:00:00Z'};
const profile={id:user.id,username:user.username,display_name:user.displayName,avatar_url:'',created_at:user.createdAt};
const base={userId:user.id,createdAt:user.createdAt,imageUrls:[],visibility:'public',likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,author:user};
const posts=[{...base,id:'native',content:'9月の日記を更新しました https://preview.example/diary'},{...base,id:'private',visibility:'following',content:'二つのリンク https://preview.example/a https://preview.example/b'},{...base,id:'bsky:at://did:plc:test/app.bsky.feed.post/demo',source:'bluesky',content:'プレビューなし https://preview.example/none'}];
posts.push({...base,id:'old',content:'古い固定対象',createdAt:'2020-01-01T00:00:00Z'});
const reply={...base,id:'reply:child',replyId:'child',replyPostId:'native',replyToUsername:'lime',content:'返信のリンク https://preview.example/reply'};
async function press(page:Page,locator:Locator){if(await page.evaluate(()=>navigator.maxTouchPoints>0))await locator.tap();else await locator.click();}
async function setup(page:Page,standalone:boolean){
  const state={profileId:user.id,profileUsername:user.username,followed:false,member:false,reviewEnabled:true, reviewRows:[] as any[], reviewFail:false, rows:[] as Record<string,string>[],extraPosts:[] as (typeof posts)[number][],denyPrivate:false,failWrite:false,pin:null as string|null, highlights:[] as string[]};
  if(standalone)await page.addInitScript(()=>{Object.defineProperty(navigator,'standalone',{get:()=>true});});
  await page.route('**/src/hooks/useAuth.tsx*',route=>route.fulfill({contentType:'application/javascript',body:`export const useAuth=()=>({user:${JSON.stringify(user)},loading:false,session:null,logout:async()=>{},accounts:[${JSON.stringify({...user,needsLogin:false})},{id:'other',username:'other',displayName:'Other',avatarUrl:'',needsLogin:false}],switching:false,switchAccount:async()=>{},forgetAccount:()=>{}});export const AuthProvider=({children})=>children;`}));
  await page.route('**/src/lib/currentUser.ts*',route=>route.fulfill({contentType:'application/javascript',body:`export const getCurrentUserId=async()=> '${user.id}';`}));
  await page.route('**/src/api/posts.ts*',route=>route.fulfill({contentType:'application/javascript',body:`const posts=${JSON.stringify(posts)};
    export const getFeed=async()=>posts,getFollowingFeed=getFeed,getPostsByUser=getFeed,getProfilePosts=getFeed,getLikedPostsByUser=getFeed,searchPosts=getFeed;
    export const getHighlightedPosts=async (_user,page=0,limit=10)=>(await fetch('/__highlights-fixture?offset='+page*limit+'&limit='+limit)).json();export const getPostById=async id=>(await fetch('/__bookmark-fixture/post/'+encodeURIComponent(id))).json();export const createPost=async()=>posts[0],toggleLike=async()=>({liked:true}),toggleRepost=async()=>({reposted:true}),deletePost=async()=>{},getPostLikers=async()=>[];`}));
  await page.route('**/__bookmark-fixture/post/**',route=>{const id=decodeURIComponent(new URL(route.request().url()).pathname.split('/post/')[1]);const post=id===reply.id?reply:[...posts,...state.extraPosts].find(post=>post.id===id);return route.fulfill({contentType:'application/json',body:JSON.stringify(id==='private'&&state.denyPrivate?null:post??null)});});
  await page.route('**/*.supabase.co/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS,HEAD','access-control-allow-headers':req.headers()['access-control-request-headers']??'*'}});
    if(url.pathname.endsWith('/rpc/get_account_reviews')) {
      const total=state.reviewRows.length, average=total?state.reviewRows.reduce((n,r)=>n+r.rating,0)/total:0;
      const distribution=Object.fromEntries([1,2,3,4,5].map(star=>[star,state.reviewRows.filter(r=>r.rating===star).length]));
      return route.fulfill({contentType:'application/json',body:JSON.stringify({enabled:state.reviewEnabled,total,average,distribution,reviews:state.reviewRows})});
    }
    if(url.pathname.endsWith('/rpc/submit_account_review')) {
      if(state.reviewFail)return route.fulfill({status:500,contentType:'application/json',body:'{"message":"write failed"}'});
      const body=req.postDataJSON();
      state.reviewRows=[{id:'review-1',author_id:user.id,rating:body.stars,title:body.review_title,content:body.review_content,
        created_at:'2026-10-08T10:00:00Z',likes_count:0,liked_by_me:false,author:{...profile,is_official:true}}];
      return route.fulfill({contentType:'application/json',body:JSON.stringify('review-1')});
    }
    if(url.pathname.endsWith('/rpc/set_account_review_like')) {
      const body=req.postDataJSON(),row=state.reviewRows.find(r=>r.id===body.target_review);
      row.liked_by_me=body.enabled;row.likes_count=body.enabled?1:0;
      return route.fulfill({contentType:'application/json',body:JSON.stringify({liked:row.liked_by_me,count:row.likes_count})});
    }
    if(url.pathname.endsWith('/profile_highlights')){
      if(req.method()==='POST'){
        if(state.failWrite)return route.fulfill({status:500,contentType:'application/json',body:'{"message":"write failed"}'});
        const id=req.postDataJSON().post_id;if(!state.highlights.includes(id))state.highlights.unshift(id);
        return route.fulfill({status:201,body:''});
      }
      const id=url.searchParams.get('post_id')?.slice(3);
      if(req.method()==='DELETE'){state.highlights=state.highlights.filter(postId=>postId!==id);return route.fulfill({status:204,body:''});}
      return route.fulfill({contentType:'application/json',body:JSON.stringify(state.highlights.includes(id??'')?{post_id:id}:null)});
    }
    if(url.pathname.endsWith('/profile_pins')){
      if(req.method()==='POST'){state.pin=JSON.parse(req.postData()!).post_id;return route.fulfill({status:201,body:''});}
      if(req.method()==='DELETE'){state.pin=null;return route.fulfill({status:204,body:''});}
      return route.fulfill({contentType:'application/json',body:JSON.stringify(state.pin?{post_id:state.pin}:null)});
    }
    if(url.pathname.endsWith('/functions/v1/link-preview')){
      const target=JSON.parse(req.postData()??'{}').url;
      return route.fulfill({contentType:'application/json',body:JSON.stringify({preview:target.endsWith('/none')?null:{url:target,domain:'preview.example',title:'9月日記 | プレビュー確認',image:'https://preview.example/cover.svg'}})});
    }
    if(url.pathname.endsWith('/bookmarks')){
      if(req.method()==='POST'){
        if(state.failWrite)return route.fulfill({status:500,contentType:'application/json',body:'{"message":"fixture write failed"}'});
        state.rows.push({...req.postDataJSON(),id:`bookmark-${state.rows.length}`,created_at:new Date().toISOString()});return route.fulfill({status:201,body:''});
      }
      const filters=[...url.searchParams.entries()].filter(([key,value])=>['user_id','post_id','comment_id','external_id'].includes(key)&&value.startsWith('eq.'));
      const matches=(row:Record<string,string>)=>filters.every(([key,value])=>row[key]===value.slice(3));
      if(req.method()==='DELETE'){state.rows=state.rows.filter(row=>!matches(row));return route.fulfill({status:204,body:''});}
      const offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??1000);
      return route.fulfill({contentType:'application/json',body:JSON.stringify(state.rows.filter(matches).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(offset,offset+limit))});
    }
    const single=(req.headers().accept??'').includes('vnd.pgrst.object');let data:unknown=single?null:[];
    if(url.pathname.endsWith('/follows'))data=state.followed?(single?{follower_id:user.id}:[{follower_id:user.id}]):(single?null:[]);
    if(url.pathname.endsWith('/memberships'))data=state.member?(single?{id:'membership'}:[{id:'membership'}]):(single?null:[]);
    if(url.pathname.endsWith('/profiles')) {
      if (req.method()==='PATCH') state.pin=req.postDataJSON().pinned_post_id;
      const row={...profile,id:state.profileId,username:state.profileUsername,review:state.reviewEnabled,pinned_post_id:state.pin};
      data=single?row:[row];
    }
    if(url.pathname.endsWith('/comments')){
      const parent=url.searchParams.get('parent_comment_id');
      data=parent?.startsWith('eq.')?[]:[{id:'child',post_id:'native',parent_comment_id:null,user_id:user.id,content:reply.content,created_at:user.createdAt,image_urls:[],likes_count:0,profiles:profile}];
    }
    if(url.pathname.endsWith('/posts'))data=[{...posts[0],user_id:user.id,profiles:profile}];
    if(url.pathname.includes('get_profile_activity_count'))data=3;
    if(url.pathname.includes('get-trends'))data=[];
    return route.fulfill({contentType:'application/json',headers:{'content-range':'0-0/0'},body:req.method()==='HEAD'?'':JSON.stringify(data)});
  });
  await page.route('**/public.api.bsky.app/**',route=>route.fulfill({contentType:'application/json',body:'{"feed":[],"posts":[],"actors":[]}'}));
  await page.route('**/__highlights-fixture?*',route=>{
    const url=new URL(route.request().url()),offset=Number(url.searchParams.get('offset')),limit=Number(url.searchParams.get('limit'));
    return route.fulfill({contentType:'application/json',body:JSON.stringify(state.highlights.map(id=>posts.find(post=>post.id===id)).filter(Boolean).slice(offset,offset+limit))});
  });
  return state;
}


test('leaving reviews for a profile without reviews does not render wrapped posts as posts',async({page})=>{
 const errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 const state=await setup(page,false);
 state.reviewRows=[{id:'other-review',author_id:'other',rating:5,title:'感想',content:'レビュー本文',created_at:user.createdAt,likes_count:0,liked_by_me:false,author:{username:'ordinary',display_name:'別のユーザー',avatar_url:'',is_official:false}}];
 state.profileUsername='ordinary';state.profileId='22222222-2222-2222-2222-222222222222';state.reviewEnabled=false;
 await page.goto('u/ordinary');
 await expect(page.getByText('9月の日記を更新しました',{exact:false}).first()).toBeVisible();
 state.profileUsername=user.username;state.profileId=user.id;state.reviewEnabled=true;
 await press(page,page.locator('article').getByRole('link',{name:user.displayName,exact:true}).first());
 await expect(page).toHaveURL(/\/u\/lime$/);
 await expect(page.getByText('返信のリンク', {exact:false}).first()).toBeVisible();
 await press(page,page.getByRole('tab',{name:'レビュー',exact:true}).filter({visible:true}));
 await expect(page.getByText('レビュー本文',{exact:true})).toBeVisible();
 state.profileUsername='ordinary';state.profileId='22222222-2222-2222-2222-222222222222';state.reviewEnabled=false;
 await press(page,page.locator('[data-lime-account-review]').getByRole('link',{name:'別のユーザー'}));
 await expect(page).toHaveURL(/\/u\/ordinary$/);
 expect(errors).toEqual([]);
 try { await expect(page.getByRole('tab',{name:'ポスト',exact:true}).filter({visible:true})).toHaveAttribute('data-state','active'); }
 finally { expect(errors).toEqual([]); }
 await expect(page.getByText('9月の日記を更新しました',{exact:false}).first()).toBeVisible();
 expect(errors).toEqual([]);
});

test('reviews are hidden unless the profile flag is true',async({page})=>{
 const state=await setup(page,false);state.reviewEnabled=false;
 await page.goto('u/lime');
 await expect(page.getByRole('tab',{name:'ポスト',exact:true}).filter({visible:true})).toBeVisible();
 await expect(page.getByRole('tab',{name:'レビュー',exact:true})).toHaveCount(0);
 await expect(page.locator('[data-lime-profile-review-rating]')).toHaveCount(0);
});
test('review tab, rating, posting, editing and existing like button work',async({page},info)=>{
 const state=await setup(page,false);state.highlights=['native'];
 await page.goto('u/lime');
 const tabs=page.getByRole('tablist').filter({visible:true});
 await expect(tabs.getByRole('tab')).toHaveCount(6);
 await expect(tabs.getByRole('tab')).toHaveText(['ポスト','ハイライト','メディア','レビュー','いいね','リアクション']);
 const headerRating=page.locator('[data-lime-profile-review-rating]');
 await expect(headerRating.getByRole('img',{name:'5つ星のうち0',exact:true})).toBeVisible();
 const placement=await headerRating.evaluate(el=>{
   const box=el.getBoundingClientRect(), cover=el.parentElement!.getBoundingClientRect();
   return {right:cover.right-box.right,bottom:cover.bottom-box.bottom,background:getComputedStyle(el).backgroundColor};
 });
 expect(placement.right).toBeGreaterThanOrEqual(16);expect(placement.right).toBeLessThanOrEqual(24);
 expect(placement.bottom).toBe(12);expect(placement.background).toBe('rgba(0, 0, 0, 0)');

 const tab=tabs.getByRole('tab',{name:'レビュー',exact:true});
 await press(page,page.getByRole('button',{name:'レビューを見る',exact:true}));
 await expect(tab).toHaveAttribute('aria-selected','true');
 await expect(page.locator('[data-lime-account-reviews]')).toBeVisible();
 await expect(page.getByRole('heading',{name:'アカウントレビュー',exact:true})).toHaveCount(0);
 await expect(page.getByText('このアカウントについての感想を共有しましょう')).toHaveCount(0);
 const layout=await tabs.evaluate(el=>({height:el.getBoundingClientRect().height, tops:[...el.querySelectorAll('[role=tab]')].map(t=>t.getBoundingClientRect().top)}));
 expect(Math.max(...layout.tops)-Math.min(...layout.tops)).toBeLessThan(3);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await expect(page.getByText('まだレビューがありません。')).toBeVisible();
 await press(page,page.getByRole('button',{name:'レビューを書く',exact:true}));
 const dialog=page.getByRole('dialog');
 const checkComposer=async(mode:string)=>{
  await expect(dialog).toBeVisible();
  await expect.poll(()=>dialog.evaluate(el=>getComputedStyle(el).pointerEvents)).toBe('auto');
  const box=await dialog.evaluate(el=>{const b=el.getBoundingClientRect();return {left:b.left,top:b.top,width:b.width,height:b.height,viewportWidth:innerWidth,viewportHeight:innerHeight,bottomCovered:!!document.elementFromPoint(innerWidth/2,innerHeight-12)?.closest('[role=dialog]'),fabCovered:!!document.elementFromPoint(innerWidth-48,innerHeight-108)?.closest('[role=dialog]')};});
  if(info.project.use.isMobile){
   expect(Math.abs(box.left)).toBeLessThanOrEqual(1);expect(Math.abs(box.top)).toBeLessThanOrEqual(1);
   expect(Math.abs(box.width-box.viewportWidth)).toBeLessThanOrEqual(1);expect(Math.abs(box.height-box.viewportHeight)).toBeLessThanOrEqual(1);
   expect(box.bottomCovered).toBe(true);expect(box.fabCovered).toBe(true);
  }else{expect(box.width).toBeLessThan(box.viewportWidth);expect(box.height).toBeLessThan(box.viewportHeight);}
  await page.screenshot({path:`artifacts/review-${mode}-${info.project.name}.png`});
 };
 await checkComposer('write');
 await expect(dialog.locator('input[type=file]')).toHaveCount(0);
 await press(page,dialog.getByRole('radio',{name:'星5つ',exact:true}).locator('..'));
 await dialog.getByLabel('タイトル（任意）').fill('ありがとう');
 await dialog.getByLabel('レビュー（必須）').fill('いつもお世話になっているアカウントです');
 await press(page,dialog.getByRole('button',{name:'レビューを保存',exact:true}));
 await expect(dialog).toHaveCount(0);
 await expect(page.getByText('1件の評価')).toBeVisible();
 await expect(page.getByRole('meter',{name:'星5つの割合'})).toHaveAttribute('aria-valuenow','100');
 const review=page.locator('[data-lime-account-review]');
 await expect(review.getByText('ありがとう')).toBeVisible();
 await expect(review.getByAltText('認証済み')).toBeVisible();
 const spacing=await review.evaluate(el=>{
   const section=el.closest('[data-lime-account-reviews]')!.getBoundingClientRect(), row=el.getBoundingClientRect();
   const name=el.querySelector('[data-lime-review-author-name]')!.getBoundingClientRect();
   const badge=el.querySelector('img[alt="認証済み"]')!.getBoundingClientRect();
   const style=getComputedStyle(el), compose=el.closest('[data-lime-account-reviews]')!.querySelector('[data-lime-review-compose]')!, composeBox=compose.getBoundingClientRect(), composeStyle=getComputedStyle(compose);
   return {left:row.left+parseFloat(style.paddingLeft)-section.left,right:section.right-row.right+parseFloat(style.paddingRight),gap:badge.left-name.right,align:Math.abs((badge.top+badge.height/2)-(name.top+name.height/2)),
     viewport:window.innerWidth,sectionLeft:section.left,sectionRight:section.right,rowLeft:row.left-section.left,rowRight:section.right-row.right,composeLeft:composeBox.left-section.left,composeRight:section.right-composeBox.right,composeTopBorder:parseFloat(composeStyle.borderTopWidth),composeBottomBorder:parseFloat(composeStyle.borderBottomWidth)};
 });
 expect(spacing.left).toBeGreaterThanOrEqual(16);expect(spacing.right).toBeGreaterThanOrEqual(16);
 expect(Math.abs(spacing.rowLeft)).toBeLessThanOrEqual(1);expect(Math.abs(spacing.rowRight)).toBeLessThanOrEqual(1);
 expect(Math.abs(spacing.composeLeft)).toBeLessThanOrEqual(1);expect(Math.abs(spacing.composeRight)).toBeLessThanOrEqual(1);
 expect(spacing.composeTopBorder).toBe(0);expect(spacing.composeBottomBorder).toBe(1);
 if(info.project.use.isMobile){expect(Math.abs(spacing.sectionLeft)).toBeLessThanOrEqual(1);expect(Math.abs(spacing.sectionRight-spacing.viewport)).toBeLessThanOrEqual(1);}
 expect(spacing.gap).toBeGreaterThanOrEqual(3);expect(spacing.gap).toBeLessThanOrEqual(5);expect(spacing.align).toBeLessThanOrEqual(2);

 await review.scrollIntoViewIfNeeded();
 await press(page,review.locator('[data-lime-post-action=like]'));
 await expect.poll(()=>state.reviewRows[0].likes_count).toBe(1);
 await expect(review.locator('[data-lime-post-action=like]')).toHaveClass(/text-pink-500/);
 await press(page,review.locator('[data-lime-post-action=like]'));
 await expect.poll(()=>state.reviewRows[0].likes_count).toBe(0);
 await page.getByRole('button',{name:'レビューを編集',exact:true}).scrollIntoViewIfNeeded();
 const edit=page.locator('[data-lime-review-compose] button');
 const editBackground=await edit.evaluate(el=>getComputedStyle(el).backgroundColor);
 if(!info.project.use.isMobile)await edit.hover();
 await edit.focus();
 await expect.poll(()=>edit.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(editBackground);
 await press(page,edit);
 await expect.poll(()=>edit.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(editBackground);
 await checkComposer('edit');
 await expect(dialog.getByLabel('レビュー（必須）')).toHaveValue('いつもお世話になっているアカウントです');
 await press(page,dialog.getByRole('radio',{name:'星3つ',exact:true}).locator('..'));
 await dialog.getByLabel('レビュー（必須）').fill('更新した感想');
 await press(page,dialog.getByRole('button',{name:'レビューを保存',exact:true}));
 await expect(page.getByText('5つのうち3.0つ')).toBeVisible();
 await expect(headerRating.getByRole('img',{name:'5つ星のうち3',exact:true})).toBeAttached();
 await expect(review.getByText('更新した感想')).toBeVisible();
 await expect(page.locator('[role=dialog]')).toHaveCount(0);
 await page.locator('[data-lime-account-reviews]').scrollIntoViewIfNeeded();
 const selectedLayout=await tab.evaluate(el=>{const label=el.querySelector('[data-lime-tab-label]')!.getBoundingClientRect();const list=el.closest('[role=tablist]')!.getBoundingClientRect();return {left:label.left,right:label.right,listLeft:list.left,listRight:list.right};});
 expect(selectedLayout.left).toBeGreaterThanOrEqual(selectedLayout.listLeft);
 expect(selectedLayout.right).toBeLessThanOrEqual(selectedLayout.listRight+1);
 await page.evaluate(async()=>{window.scrollTo(0,0);await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
 await page.screenshot({path:`artifacts/account-reviews-${info.project.name}.png`,fullPage:true});
});
test('failed review keeps the draft and leaves the summary unchanged',async({page})=>{
 const state=await setup(page,false);state.reviewFail=true;
 await page.goto('u/lime');
 const tab=page.getByRole('tab',{name:'レビュー',exact:true}).filter({visible:true});
 await tab.scrollIntoViewIfNeeded();await press(page,tab);
 await press(page,page.getByRole('button',{name:'レビューを書く',exact:true}));
 const dialog=page.getByRole('dialog');
 await press(page,dialog.getByRole('radio',{name:'星4つ',exact:true}).locator('..'));
 await dialog.getByLabel('レビュー（必須）').fill('保存に失敗しても残る本文');
 await press(page,dialog.getByRole('button',{name:'レビューを保存',exact:true}));
 await expect(page.getByText('レビューを保存できませんでした。もう一度お試しください。')).toBeVisible();
 await expect(dialog.getByLabel('レビュー（必須）')).toHaveValue('保存に失敗しても残る本文');
 expect(state.reviewRows).toEqual([]);
});

test('membership profile buttons fit on mobile and retain desktop and ordinary sizes',async({page},info)=>{
 const state=await setup(page,false);state.profileId='22222222-2222-4222-8222-222222222222';state.followed=true;state.member=true;
 for(const username of ['cat','limenote','ordinary']){
  state.profileUsername=username;
  await page.goto('u/'+username);
  const actions=page.locator('[data-lime-profile-actions]');
  await expect(actions.getByRole('button',{name:'新しい投稿を通知する',exact:true})).toBeVisible();
  if(username!=='ordinary')await expect(actions.getByRole('button',{name:'登録済み',exact:true})).toBeVisible();
  const layout=await actions.evaluate(el=>({viewport:window.innerWidth,buttons:[...el.querySelectorAll('button')].map(button=>{const b=button.getBoundingClientRect();return {text:button.textContent,left:b.left,right:b.right,height:b.height,fontSize:parseFloat(getComputedStyle(button).fontSize)};})}));
  const compact=info.project.use.isMobile&&username!=='ordinary';
  for(const button of layout.buttons){
   expect(button.height).toBe(compact?36:40);
   expect(button.fontSize).toBe(compact&&layout.viewport<360?13:14);
   if(info.project.use.isMobile){expect(button.left).toBeGreaterThanOrEqual(0);expect(button.right).toBeLessThanOrEqual(layout.viewport);}
  }
  if(info.project.use.isMobile){
   const divider=await page.locator('[data-lime-profile-tabs-divider]').evaluate(el=>{const b=el.getBoundingClientRect();return {left:b.left,right:b.right,width:window.innerWidth};});
   expect(Math.abs(divider.left)).toBeLessThanOrEqual(1);expect(Math.abs(divider.right-divider.width)).toBeLessThanOrEqual(1);
  }
  if(username==='cat')await page.screenshot({path:`artifacts/member-profile-buttons-${info.project.name}.png`,fullPage:true});
 }
});
