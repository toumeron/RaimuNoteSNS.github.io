import { test, expect, type Page, type Locator } from '@playwright/test';
const user={id:'11111111-1111-1111-1111-111111111111',username:'lime',displayName:'Lime Note',avatarUrl:'',createdAt:'2026-10-01T00:00:00Z'};
const profile={id:user.id,username:user.username,display_name:user.displayName,avatar_url:'',created_at:user.createdAt};
const base={userId:user.id,createdAt:user.createdAt,imageUrls:[],visibility:'public',likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,author:user};
const posts=[{...base,id:'native',content:'9月の日記を更新しました https://preview.example/diary'},{...base,id:'private',visibility:'following',content:'二つのリンク https://preview.example/a https://preview.example/b'},{...base,id:'bsky:at://did:plc:test/app.bsky.feed.post/demo',source:'bluesky',content:'プレビューなし https://preview.example/none'}];
posts.push({...base,id:'old',content:'古い固定対象',createdAt:'2020-01-01T00:00:00Z'});
const reply={...base,id:'reply:child',replyId:'child',replyPostId:'native',replyToUsername:'lime',content:'返信のリンク https://preview.example/reply'};
async function press(page:Page,locator:Locator){if(await page.evaluate(()=>navigator.maxTouchPoints>0))await locator.tap();else await locator.click();}
async function setup(page:Page,standalone:boolean){
  const state={rows:[] as Record<string,string>[],extraPosts:[] as (typeof posts)[number][],denyPrivate:false,failWrite:false,pin:null as string|null, highlights:[] as string[]};
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
  await page.route('**/__highlights-fixture?*',route=>{
    const url=new URL(route.request().url()),offset=Number(url.searchParams.get('offset')),limit=Number(url.searchParams.get('limit'));
    return route.fulfill({contentType:'application/json',body:JSON.stringify(state.highlights.map(id=>posts.find(post=>post.id===id)).filter(Boolean).slice(offset,offset+limit))});
  });
  return state;
}

test('failed addition leaves the highlights tab hidden',async({page})=>{
  const state=await setup(page,false);state.failWrite=true;
  await page.goto('u/lime');
  const card=page.locator('[data-lime-post-card]').first();
  await press(page,card.getByRole('button',{name:'ポストのメニュー'}));
  await press(page,page.getByRole('button',{name:'ハイライトに追加',exact:true}));
  await expect(page.getByText('ハイライトを変更できませんでした')).toBeVisible();
  expect(state.highlights).toEqual([]);
  await expect(page.getByRole('tab',{name:'ハイライト',exact:true})).toHaveCount(0);
});

test('post detail offers highlighting for an own post',async({page})=>{
  const state=await setup(page,false);await page.goto('post/native');
  await press(page,page.getByRole('button',{name:'その他のメニュー'}).filter({visible:true}));
  await press(page,page.getByRole('button',{name:'ハイライトに追加',exact:true}));
  await expect.poll(()=>state.highlights).toEqual(['native']);
});

test('highlight tabs stay in one row above pinned posts at every width',async({page},info)=>{
  const state=await setup(page,false);state.highlights=['native'];state.pin='old';
  await page.goto('u/lime');
  await page.evaluate(()=>document.documentElement.classList.add('dark'));
  const widths=info.project.use.isMobile ? [320,390] : [1440,1000,640,320];
  for(const width of widths){
    await page.setViewportSize({width,height:900});
    const tabs=page.locator('[data-lime-profile-mobile-tabs]');
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole('tab')).toHaveCount(5);
    await expect(tabs.getByRole('tab',{name:'ハイライト',exact:true})).toBeVisible();
    await expect(page.locator('[data-lime-pinned-label]')).toBeVisible();
    const layout=await tabs.evaluate(el=>{
      const box=el.getBoundingClientRect();
      return {display:getComputedStyle(el).display,top:box.top,bottom:box.bottom,
        tabs:[...el.querySelectorAll('[role=tab]')].map(tab=>{const rect=tab.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom};})};
    });
    await page.screenshot({path:info.outputPath(`highlight-tabs-${width}.png`),animations:'disabled'});
    expect(layout.display).toBe('flex');
    expect(layout.tabs.every(tab=>Math.abs(tab.top-layout.top)<1&&tab.bottom<=layout.bottom+1)).toBe(true);
    const postBox=await page.locator('[data-lime-post-card]').first().boundingBox();
    expect(postBox!.y).toBeGreaterThanOrEqual(layout.bottom-1);
  }
});

test('own posts can be added, read after reload, and removed from the highlight tab',async({page},info)=>{
  const state=await setup(page,false);await page.goto('u/lime');
  const tabs=page.locator('[data-lime-profile-mobile-tabs]');
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  const originalFont=await tabs.getByRole('tab').first().evaluate(el=>getComputedStyle(el).fontSize);
  for(const content of ['9月の日記を更新しました','古い固定対象']){
    const card=page.locator('[data-lime-post-card]').filter({hasText:content}).first();
    await press(page,card.getByRole('button',{name:'ポストのメニュー'}));
    await press(page,page.getByRole('button',{name:'ハイライトに追加',exact:true}));
  }
  await expect.poll(()=>state.highlights.length).toBe(2);
  await expect(tabs.getByRole('tab')).toHaveCount(5);
  expect(await tabs.getByRole('tab').first().evaluate(el=>getComputedStyle(el).fontSize)).toBe(originalFont);
  await press(page,tabs.getByRole('tab',{name:'ハイライト',exact:true}));
  await expect(page.locator('[data-lime-post-card]')).toHaveCount(2);
  await expect(page.locator('[data-lime-post-card]').first()).toContainText('古い固定対象');
  await page.reload();
  await press(page,tabs.getByRole('tab',{name:'ハイライト',exact:true}));
  await expect(page.locator('[data-lime-post-card]')).toHaveCount(2);
  await page.screenshot({path:info.outputPath('highlights-restored.png'),animations:'disabled'});
  for(let remaining=1;remaining>=0;remaining--){
    await press(page,page.locator('[data-lime-post-card]').first().getByRole('button',{name:'ポストのメニュー'}));
    await press(page,page.getByRole('button',{name:'ハイライトから解除',exact:true}));
    await expect.poll(()=>state.highlights.length).toBe(remaining);
    if(remaining)await expect(page.locator('[data-lime-post-card]')).toHaveCount(remaining);
  }
  await expect(tabs.getByRole('tab',{name:'ハイライト',exact:true})).toHaveCount(0);
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  await expect(tabs.getByRole('tab',{name:'ポスト',exact:true})).toHaveAttribute('data-state','active');
});

test('highlight tabs preserve the original profile typography and underline design',async({page},info)=>{
  const state=await setup(page,false);state.pin='old';
  await page.goto('u/lime');
  await page.evaluate(()=>document.documentElement.classList.add('dark'));
  const tabs=page.locator('[data-lime-profile-mobile-tabs]');
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  const design=()=>tabs.evaluate(el=>{
    const active=el.querySelector<HTMLElement>('[role=tab][data-state=active]')!;
    const inactive=el.querySelector<HTMLElement>('[role=tab][data-state=inactive]')!;
    const line=el.querySelector<HTMLElement>('.profile-tabs-underline')!;
    const activeStyle=getComputedStyle(active),inactiveStyle=getComputedStyle(inactive),lineStyle=getComputedStyle(line);
    return {
      activeFont:activeStyle.fontSize,activeWeight:activeStyle.fontWeight,activeColor:activeStyle.color,
      inactiveFont:inactiveStyle.fontSize,inactiveWeight:inactiveStyle.fontWeight,inactiveColor:inactiveStyle.color,
      width:lineStyle.width,height:lineStyle.height,bottom:lineStyle.bottom,color:lineStyle.backgroundColor,
      radius:lineStyle.borderRadius,transition:lineStyle.transition,
    };
  });
  const original=await design();
  const viewportWidth=page.viewportSize()!.width;
  expect(original.activeFont).toBe(viewportWidth>=640 || viewportWidth<390 ? '14px' : '12px');
  expect(original.inactiveFont).toBe(original.activeFont);
  const card=page.locator('[data-lime-post-card]').filter({hasText:'9月の日記を更新しました'}).first();
  await press(page,card.getByRole('button',{name:'ポストのメニュー'}));
  await press(page,page.getByRole('button',{name:'ハイライトに追加',exact:true}));
  await expect.poll(()=>state.highlights).toEqual(['native']);
  await expect(tabs.getByRole('tab')).toHaveCount(5);
  expect(await design()).toEqual(original);
  const line=tabs.locator('.profile-tabs-underline');
  for(const label of ['ポスト','ハイライト','メディア','いいね','リアクション']){
    const tab=tabs.getByRole('tab',{name:label,exact:true});
    await tab.scrollIntoViewIfNeeded();
    await press(page,tab);
    await expect(tab).toHaveAttribute('data-state','active');
    await expect.poll(async()=>{
      const marker=(await line.boundingBox())!,selected=(await tab.boundingBox())!;
      return Math.abs(marker.x+marker.width/2-selected.x-selected.width/2);
    }).toBeLessThan(1);
    expect(await design()).toEqual(original);
    const divider=page.locator('[data-lime-profile-tabs-divider]');
    const markerBox=(await line.boundingBox())!,dividerBox=(await divider.boundingBox())!;
    expect(markerBox.y+markerBox.height).toBeLessThanOrEqual(dividerBox.y+1);
  }
  const highlight=tabs.getByRole('tab',{name:'ハイライト',exact:true});
  await highlight.scrollIntoViewIfNeeded();await press(page,highlight);
  await expect(page.locator('[data-lime-post-card]')).toHaveCount(1);
  await page.screenshot({path:info.outputPath('profile-design-preserved.png'),animations:'disabled'});
  await page.locator('[data-lime-profile-tabs-header]').screenshot({path:info.outputPath('tabs-design-preserved.png'),animations:'disabled'});
});
