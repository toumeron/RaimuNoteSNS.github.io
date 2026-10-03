import { test, expect, type Page, type Locator } from '@playwright/test';
const user={id:'11111111-1111-1111-1111-111111111111',username:'lime',displayName:'Lime Note',avatarUrl:'',createdAt:'2026-10-01T00:00:00Z'};
const profile={id:user.id,username:user.username,display_name:user.displayName,avatar_url:'',created_at:user.createdAt};
const base={userId:user.id,createdAt:user.createdAt,imageUrls:[],visibility:'public',likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,author:user};
const posts=[{...base,id:'native',content:'保存する通常の投稿'},{...base,id:'private',visibility:'following',content:'保存する限定投稿'},{...base,id:'bsky:at://did:plc:test/app.bsky.feed.post/demo',source:'bluesky',content:'保存するBluesky投稿'}];
const reply={...base,id:'reply:child',replyId:'child',replyPostId:'native',replyToUsername:'lime',content:'保存する返信'};
async function press(page:Page,locator:Locator){if(await page.evaluate(()=>navigator.maxTouchPoints>0))await locator.tap();else await locator.click();}
async function setup(page:Page,standalone:boolean){
  const state={rows:[] as any[],extraPosts:[] as any[],denyPrivate:false,failWrite:false};
  if(standalone)await page.addInitScript(()=>{Object.defineProperty(navigator,'standalone',{get:()=>true});});
  await page.route('**/src/hooks/useAuth.tsx*',route=>route.fulfill({contentType:'application/javascript',body:`export const useAuth=()=>({user:${JSON.stringify(user)},loading:false,session:null,logout:async()=>{},accounts:[${JSON.stringify({...user,needsLogin:false})},{id:'other',username:'other',displayName:'Other',avatarUrl:'',needsLogin:false}],switching:false,switchAccount:async()=>{},forgetAccount:()=>{}});export const AuthProvider=({children})=>children;`}));
  await page.route('**/src/lib/currentUser.ts*',route=>route.fulfill({contentType:'application/javascript',body:`export const getCurrentUserId=async()=> '${user.id}';`}));
  await page.route('**/src/api/posts.ts*',route=>route.fulfill({contentType:'application/javascript',body:`const posts=${JSON.stringify(posts)};
    export const getFeed=async()=>posts,getFollowingFeed=getFeed,getPostsByUser=getFeed,getProfilePosts=getFeed,getLikedPostsByUser=getFeed,searchPosts=getFeed;
    export const getPostById=async id=>(await fetch('/__bookmark-fixture/post/'+encodeURIComponent(id))).json();export const createPost=async()=>posts[0],toggleLike=async()=>({liked:true}),toggleRepost=async()=>({reposted:true}),deletePost=async()=>{},getPostLikers=async()=>[];`}));
  await page.route('**/__bookmark-fixture/post/**',route=>{const id=decodeURIComponent(new URL(route.request().url()).pathname.split('/post/')[1]);const post=id===reply.id?reply:[...posts,...state.extraPosts].find(post=>post.id===id);return route.fulfill({contentType:'application/json',body:JSON.stringify(id==='private'&&state.denyPrivate?null:post??null)});});
  await page.route('**/*.supabase.co/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS,HEAD','access-control-allow-headers':req.headers()['access-control-request-headers']??'*'}});
    if(url.pathname.endsWith('/bookmarks')){
      if(req.method()==='POST'){
        if(state.failWrite)return route.fulfill({status:500,contentType:'application/json',body:'{"message":"fixture write failed"}'});
        state.rows.push({...req.postDataJSON(),id:`bookmark-${state.rows.length}`,created_at:new Date().toISOString()});return route.fulfill({status:201,body:''});
      }
      const filters=[...url.searchParams.entries()].filter(([key,value])=>['user_id','post_id','comment_id','external_id'].includes(key)&&value.startsWith('eq.'));
      const matches=(row:any)=>filters.every(([key,value])=>row[key]===value.slice(3));
      if(req.method()==='DELETE'){state.rows=state.rows.filter(row=>!matches(row));return route.fulfill({status:204,body:''});}
      const offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??1000);
      return route.fulfill({contentType:'application/json',body:JSON.stringify(state.rows.filter(matches).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(offset,offset+limit))});
    }
    const single=(req.headers().accept??'').includes('vnd.pgrst.object');let data:unknown=single?null:[];
    if(url.pathname.endsWith('/profiles'))data=single?profile:[profile];
    if(url.pathname.endsWith('/comments')){
      const parent=url.searchParams.get('parent_comment_id');
      data=parent?.startsWith('eq.')?[]:[{id:'child',post_id:'native',parent_comment_id:null,user_id:user.id,content:reply.content,created_at:user.createdAt,image_urls:[],likes_count:0,profiles:profile}];
    }
    if(url.pathname.includes('get_profile_activity_count'))data=3;
    if(url.pathname.includes('get-trends'))data=[];
    return route.fulfill({contentType:'application/json',headers:{'content-range':'0-0/0'},body:req.method()==='HEAD'?'':JSON.stringify(data)});
  });
  await page.route('**/public.api.bsky.app/**',route=>route.fulfill({contentType:'application/json',body:'{"feed":[],"posts":[],"actors":[]}'}));
  return state;
}
async function openBookmarks(page:Page){
  if((page.viewportSize()?.width??0)>=768){
    const sidebar=page.locator('[data-lime-desktop-sidebar]');
    await expect(sidebar.getByRole('button',{name:'ブックマーク',exact:true})).toHaveCount(0);
    const more=sidebar.getByRole('button',{name:'もっと見る',exact:true});const trigger=(await more.boundingBox())!;
    await press(page,more);const menu=page.locator('[data-lime-sidebar-more]');await expect(menu).toBeVisible();
    await expect.poll(async()=>{const rect=(await menu.boundingBox())!;return rect.y+rect.height>trigger.y;}).toBe(true);
    await press(page,menu.getByRole('menuitem',{name:'ブックマーク',exact:true}));
  }else{
    await press(page,page.getByRole('button',{name:'メニューを開く',exact:true}));
    const sidebar=page.locator('[data-lime-mobile-sidebar="true"]');
    await expect(sidebar.getByRole('button',{name:'もっと見る',exact:true})).toHaveCount(0);
    await press(page,sidebar.getByRole('button',{name:'ブックマーク',exact:true}));
  }
  await expect(page.getByRole('heading',{name:'ブックマーク',exact:true})).toBeVisible();
}
test('saves beside share, persists after reload, and can be removed from the bookmarks page',async({page},info)=>{
  const state=await setup(page,info.project.name.includes('PWA'));await page.goto('./');
  const card=page.locator('[data-lime-post-card]').filter({hasText:posts[0].content}).first();const bookmark=card.getByRole('button',{name:'ブックマークに追加',exact:true});
  await expect(bookmark).toBeEnabled();const share=(await card.getByRole('button',{name:'ポストを共有',exact:true}).boundingBox())!;const mark=(await bookmark.boundingBox())!;expect(mark.x+mark.width).toBeLessThanOrEqual(share.x+1);
  await press(page,bookmark);await expect(card.getByRole('button',{name:'ブックマークを解除',exact:true})).toBeEnabled();expect(state.rows).toHaveLength(1);
  await openBookmarks(page);await expect(page.getByText(posts[0].content,{exact:true})).toBeVisible();
  await page.waitForLoadState('networkidle');await page.reload();await expect(page.getByText(posts[0].content,{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('bookmarks-page.png'),animations:'disabled'});
  await press(page,page.getByRole('button',{name:'ブックマークを解除',exact:true}));await expect(page.getByText('ブックマークしたポストがありません。',{exact:true})).toBeVisible();expect(state.rows).toHaveLength(0);
});
test('includes external posts and replies while hiding native posts after visibility is revoked',async({page},info)=>{
  const state=await setup(page,info.project.name.includes('PWA'));await page.goto('./');
  for(const content of [posts[1].content,posts[2].content]){const card=page.locator('[data-lime-post-card]').filter({hasText:content}).first();await press(page,card.getByRole('button',{name:'ブックマークに追加',exact:true}));await expect(card.getByRole('button',{name:'ブックマークを解除',exact:true})).toBeEnabled();}
  await page.goto('post/native');const comment=page.locator('[data-lime-comment-actions]').first();
  for(const row of [page.locator('[data-lime-post-detail-card] [data-lime-post-actions]').first(),comment]){
    await expect(row).toBeVisible();
    const centers=await row.locator(':is(svg.lucide-heart, svg.lucide-message-circle, svg.lucide-plus, [data-lime-post-action="repost"] > svg)').evaluateAll(items=>items.map(item=>{const r=item.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};}));
    expect(centers).toHaveLength(4);expect(Math.max(...centers.map(r=>r.y))-Math.min(...centers.map(r=>r.y))).toBeLessThanOrEqual(1);
    const gaps=centers.slice(1).map((r,i)=>r.x-centers[i].x);expect(Math.max(...gaps)-Math.min(...gaps),JSON.stringify(centers)).toBeLessThanOrEqual(1);
  }
  await expect(comment.getByRole('button',{name:'ブックマークに追加',exact:true})).toBeVisible();
  await press(page,comment.getByRole('button',{name:'ブックマークに追加',exact:true}));await expect(comment.getByRole('button',{name:'ブックマークを解除',exact:true})).toBeEnabled();
  state.denyPrivate=true;await page.goto('./');await openBookmarks(page);
  await expect(page.getByText(posts[2].content,{exact:true})).toBeVisible();await expect(page.getByText(reply.content,{exact:true})).toBeVisible();await expect(page.getByText(posts[1].content,{exact:true})).toHaveCount(0);
  const replyCard=page.locator('[data-lime-comment-card="child"]');
  await expect(replyCard.getByRole('link',{name:'@lime',exact:true})).toHaveClass(/text-primary/);
  expect(state.rows.map(row=>row.post_id??row.comment_id??row.external_id)).toEqual(['private',posts[2].id,'child']);
});
test('more opens only after mouse release and does not select the overlapping item',async({page},info)=>{
  test.skip((page.viewportSize()?.width??0)<768,'Desktop pointer interaction');await setup(page,false);await page.goto('./');
  const more=page.getByRole('button',{name:'もっと見る',exact:true});const box=(await more.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.waitForTimeout(250);await expect(page.locator('[data-lime-sidebar-more]')).toHaveCount(0);
  await page.mouse.up();await expect(page.locator('[data-lime-sidebar-more]')).toBeVisible();await page.waitForTimeout(250);await expect(page).toHaveURL(/github\.io\/$/);
  await press(page,page.getByRole('menuitem',{name:'フォト',exact:true}));await expect(page).toHaveURL(/\/media$/);
});
test('bookmark search stays in the header and dividers and actions remain aligned',async({page},info)=>{
  await setup(page,info.project.name.includes('PWA'));await page.goto('./');
  for(const post of posts){const card=page.locator('[data-lime-post-card]').filter({hasText:post.content}).first();await press(page,card.getByRole('button',{name:'ブックマークに追加',exact:true}));await expect(card.getByRole('button',{name:'ブックマークを解除',exact:true})).toBeEnabled();}
  await openBookmarks(page);
  const header=page.locator('[data-lime-bookmarks-header]');const bounds=(await header.boundingBox())!;
  const cards=page.locator('[data-lime-bookmarks-page] > [data-lime-post-card]');await expect(cards).toHaveCount(3);
  for(const card of await cards.all()){
    const rect=(await card.boundingBox())!;expect(Math.abs(rect.x-bounds.x)).toBeLessThanOrEqual(1);expect(Math.abs(rect.width-bounds.width)).toBeLessThanOrEqual(1);
    const icons=card.locator('[data-lime-post-actions] :is(svg.lucide-heart, svg.lucide-message-circle, svg.lucide-plus, [data-lime-post-action="repost"] > svg)');
    const centers=await icons.evaluateAll(items=>items.map(item=>{const r=item.getBoundingClientRect();return {y:r.y+r.height/2,x:r.x+r.width/2};}));
    expect(Math.max(...centers.map(r=>r.y))-Math.min(...centers.map(r=>r.y))).toBeLessThanOrEqual(1);
    for(let i=1;i<centers.length;i++)expect(Math.abs((centers[i].x-centers[i-1].x)-40)).toBeLessThanOrEqual(1);
  }
  await press(page,page.getByRole('button',{name:'ブックマークを検索',exact:true}));const input=page.getByRole('textbox',{name:'ブックマークを検索'});
  await input.fill('Bluesky');await expect(cards).toHaveCount(1);await expect(cards.first()).toContainText(posts[2].content);
  await input.fill('見つからない検索語');await expect(page.getByText('一致するブックマークがありません。')).toBeVisible();
  await input.fill('');await expect(cards).toHaveCount(3);
  await page.setViewportSize({width:page.viewportSize()!.width,height:300});await page.evaluate(()=>window.scrollTo(0,120));
  await expect.poll(async()=>Math.round((await header.boundingBox())!.y)).toBe(0);
  await page.screenshot({path:info.outputPath('bookmarks-search-header.png'),animations:'disabled'});
  await press(page,page.getByRole('button',{name:'ブックマークの検索を閉じる'}));await expect(page.getByRole('heading',{name:'ブックマーク'})).toBeVisible();
});
test('a failed write rolls back the button and allows retry',async({page},info)=>{
  const state=await setup(page,info.project.name.includes('PWA'));state.failWrite=true;await page.goto('./');
  const card=page.locator('[data-lime-post-card]').filter({hasText:posts[0].content}).first();
  await press(page,card.getByRole('button',{name:'ブックマークに追加',exact:true}));await expect(page.getByText('ブックマークの更新に失敗しました',{exact:true})).toBeVisible();await expect(card.getByRole('button',{name:'ブックマークに追加',exact:true})).toBeEnabled();expect(state.rows).toHaveLength(0);
  state.failWrite=false;await press(page,card.getByRole('button',{name:'ブックマークに追加',exact:true}));await expect(card.getByRole('button',{name:'ブックマークを解除',exact:true})).toBeEnabled();expect(state.rows).toHaveLength(1);
});
test('search also finds a saved post beyond the first twenty bookmarks',async({page},info)=>{
  const state=await setup(page,info.project.name.includes('PWA'));
  state.extraPosts=Array.from({length:21},(_,index)=>({...base,id:`older-${index}`,content:index===20?'最初のページ外にある猫の投稿':`保存済みの投稿 ${index}`}));
  state.rows=state.extraPosts.map((post,index)=>({id:`saved-${index}`,user_id:user.id,post_id:post.id,created_at:new Date(Date.UTC(2026,9,3,0,0,21-index)).toISOString()}));
  await page.goto('bookmarks');await expect(page.getByRole('heading',{name:'ブックマーク'})).toBeVisible();await expect(page.locator('[data-lime-post-card]')).toHaveCount(20);
  await press(page,page.getByRole('button',{name:'ブックマークを検索',exact:true}));await page.getByRole('textbox',{name:'ブックマークを検索'}).fill('猫');
  await expect(page.locator('[data-lime-post-card]')).toHaveCount(1);await expect(page.getByText('最初のページ外にある猫の投稿',{exact:true})).toBeVisible();
});
test('mobile account sheet uses the usual pink check',async({page},info)=>{
  test.skip((page.viewportSize()?.width??0)>=768,'Mobile-only presentation');await setup(page,info.project.name.includes('PWA'));await page.goto('./');await press(page,page.getByRole('button',{name:'メニューを開く',exact:true}));await press(page,page.getByRole('button',{name:'アカウント一覧を開く',exact:true}));
  const check=page.locator('[data-lime-mobile-account-sheet]').getByLabel('ログイン中',{exact:true});await expect(check).toBeVisible();await expect(check).toHaveClass(/bg-primary/);expect(await check.evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe('rgb(14, 165, 233)');
});
