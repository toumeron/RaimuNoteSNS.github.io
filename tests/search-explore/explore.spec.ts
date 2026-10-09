import {test, expect, type Page} from '@playwright/test';
const viewer={id:'11111111-1111-1111-1111-111111111111',username:'viewer',displayName:'Viewer',avatarUrl:'',createdAt:'2026-10-01T00:00:00Z'};
const avatar=(color:string)=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="20" fill="${color}"/></svg>`);
const authors=[{...viewer,id:'source-a',displayName:'引用元A',avatarUrl:avatar('pink')},{...viewer,id:'source-b',displayName:'引用元B',avatarUrl:avatar('cyan')}];
const news=[
  {id:'bluesky',source:'bluesky',title:'Blueskyの人気ニュース',content:'人気ポストの要約',category:'社会',created_at:'2026-10-03T08:00:00Z',related_post_ids:['b']},
  {id:'general',title:'本日の注目ニュース',content:'引用元から作成した記事',category:'社会',created_at:'2026-10-03T08:00:00Z',related_post_ids:['a','b','hidden']},
  {id:'sports',title:'サッカー決勝のニュース',content:'決勝についての本文',category:'スポーツ',created_at:'2026-10-03T07:00:00Z',related_post_ids:['a']},
  {id:'entertainment',title:'アニメ新作のニュース',content:'新作の本文',category:'エンターテインメント',created_at:'2026-10-03T06:00:00Z',related_post_ids:['b']},
];
const trends=[{title:'#猫トレンド',traffic:'100+'},{title:'サッカー決勝',traffic:'200+',},{title:'アニメ新作',traffic:'300+',}];
const profiles=[{id:'22222222-2222-2222-2222-222222222222',username:'recommended',display_name:'おすすめユーザーA',avatar_url:avatar('orange'),bio:'おすすめのプロフィール本文',is_official:true,created_at:viewer.createdAt}];
async function setup(page:Page){
  await page.route('**/src/hooks/useAuth.tsx*',r=>r.fulfill({contentType:'application/javascript',body:`export const useAuth=()=>({user:${JSON.stringify(viewer)},loading:false,accounts:[],logout:async()=>{}});export const AuthProvider=({children})=>children;`}));
  await page.route('**/src/lib/currentUser.ts*',r=>r.fulfill({contentType:'application/javascript',body:`export const getCurrentUserId=async()=> '${viewer.id}';`}));
  const basePost={id:'test-post',userId:viewer.id,content:'#猫トレンド の検索結果',createdAt:viewer.createdAt,imageUrls:[],likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,visibility:'public',author:viewer};
  await page.route('**/src/api/posts.ts*',r=>r.fulfill({contentType:'application/javascript',body:`const p=${JSON.stringify(basePost)},authors=${JSON.stringify(authors)};export const getPostById=async id=>id==='hidden'?null:{...p,id,author:authors[id==='b'?1:0]};export const getFeed=async()=>[p],getFollowingFeed=getFeed,getPostsByUser=getFeed,getProfilePosts=getFeed,getLikedPostsByUser=getFeed,searchPosts=getFeed;export const toggleLike=async()=>({liked:true}),toggleRepost=async()=>({reposted:true}),deletePost=async()=>{},getPostLikers=async()=>[],createPost=async()=>p;`}));
  await page.route('**/*.supabase.co/**',r=>{
    const req=r.request(),url=new URL(req.url());const single=(req.headers().accept??'').includes('vnd.pgrst.object');let data:unknown=single?null:[];
    if(url.pathname.endsWith('/profiles'))data=single?profiles[0]:profiles;
    if(url.pathname.includes('get-trends'))data=trends;
    if(url.pathname.endsWith('/news_summaries'))data=url.searchParams.has('source')?news.filter(item=>(item.source||'limenote')===url.searchParams.get('source')?.slice(3)).slice(0,Number(url.searchParams.get('limit')??1)):url.searchParams.has('id')?news.filter(item=>item.id===url.searchParams.get('id')?.slice(3)):news;
    if(url.pathname.endsWith('/posts'))data=[{id:basePost.id,user_id:profiles[0].id,content:basePost.content,created_at:viewer.createdAt,image_urls:[],likes_count:0,comments_count:0,reposts_count:0,visibility:'public',profiles:profiles[0]}];
    return r.fulfill({contentType:'application/json',body:req.method()==='HEAD'?'':JSON.stringify(data),headers:{'content-range':'0-0/0'}});
  });
  await page.route('**/public.api.bsky.app/**',r=>r.fulfill({contentType:'application/json',body:'{"posts":[],"actors":[],"feed":[]}'}));
}
test.beforeEach(async({page})=>setup(page));
test('discovery tabs, quoted author avatars and flat sections match the new search home',async({page},info)=>{
  await page.goto('search');const tabs=page.locator('[data-lime-search-explore-tabs]:visible');await expect(tabs).toBeVisible();
  await expect(tabs.getByRole('tab')).toHaveText(['話題を検索','トレンド','スポーツ','エンターテインメント']);
  await expect(page.locator('[data-lime-search-tabs]')).toHaveCount(0);await expect(page.locator('[data-lime-search-result-tabs]')).toHaveCount(0);
  const source=page.getByRole('button',{name:/本日の注目ニュース/});await expect(source.locator('[data-lime-news-source-avatars] img')).toHaveCount(2);
  await expect(source.getByRole('img',{name:'引用元A'})).toHaveAttribute('src',authors[0].avatarUrl);await expect(source.getByRole('img',{name:'引用元B'})).toHaveAttribute('src',authors[1].avatarUrl);
  await expect(source).toContainText('2件のポスト');await expect(page.locator('[data-lime-search-today-news] h3')).toHaveText(['本日の注目ニュース','Blueskyの人気ニュース']);await expect(page.getByText('おすすめのプロフィール本文',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'フォロー',exact:true})).toBeVisible();
  await page.evaluate(()=>window.scrollTo(0,0));await expect(page.getByRole('heading',{name:'本日のニュース',exact:true})).toBeInViewport();
  if(page.viewportSize()!.width<640){const newsBox=(await page.locator('[data-lime-search-today-news]').boundingBox())!;expect(newsBox.x).toBe(0);expect(newsBox.width).toBe(page.viewportSize()!.width);}
  await page.screenshot({path:info.outputPath('search-home.png'),animations:'disabled'});
  await page.evaluate(()=>{const filler=document.createElement('div');filler.style.height='1800px';document.querySelector('main')!.append(filler);window.scrollTo(0,350);});
  if(page.viewportSize()!.width<640){
    const header=page.locator('[data-lime-app-header]');
    await expect.poll(async()=>Math.round((await header.boundingBox())!.y)).toBeLessThan(-90);
    await page.evaluate(()=>window.scrollTo(0,220));await expect.poll(async()=>Math.round((await header.boundingBox())!.y)).toBe(0);
  }else await expect.poll(async()=>Math.round((await tabs.boundingBox())!.y)).toBe(64);
});
test('rankings use search volume and category tabs show only automatically classified trends',async({page})=>{
  await page.goto('search');const tabs=page.locator('[data-lime-search-explore-tabs]:visible');
  await tabs.getByRole('tab',{name:'トレンド',exact:true}).click();await expect(page.locator('[data-lime-search-today-news]')).toHaveCount(0);
  const rows=page.locator('[data-lime-search-explore-content] section[aria-label="トレンド"] > div');
  await expect(rows).toHaveCount(3);await expect(rows.first()).toContainText('1 · エンターテインメント');await expect(rows.first()).toContainText('アニメ新作');await expect(rows.nth(1)).toContainText('2 · スポーツ');
  await tabs.getByRole('tab',{name:'スポーツ',exact:true}).click();await expect(page.locator('[data-lime-search-today-news]')).toHaveCount(0);await expect(rows).toHaveCount(1);await expect(rows.first()).toContainText('サッカー決勝');
  await tabs.getByRole('tab',{name:'エンターテインメント',exact:true}).click();await expect(page.locator('[data-lime-search-today-news]')).toHaveCount(0);await expect(rows).toHaveCount(1);await expect(rows.first()).toContainText('アニメ新作');
  await tabs.getByRole('tab',{name:'話題を検索',exact:true}).click();await expect(page.locator('[data-lime-search-today-news] h3')).toHaveCount(2);
  await expect(page.getByRole('heading',{name:'ラジオ',exact:true})).toHaveCount(0);await expect(tabs.getByRole('tab',{name:'ニュース',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:/本日の注目ニュース/}).click();await expect(page).toHaveURL(/news\?story=general$/);await expect(page.getByRole('heading',{name:'本日の注目ニュース',exact:true})).toBeVisible();
});
test('personal trends use the signed-in viewer interests while rankings stay independent',async({page})=>{
  await page.addInitScript(id=>localStorage.setItem(`lime_recommendation_likes:${id}`,JSON.stringify([{id:'liked-cat',userId:'cat-author',content:'猫 猫 ねこ cats',engagedAt:new Date().toISOString()}])),viewer.id);
  await page.goto('search');const section=page.locator('[data-lime-search-explore-content] section[aria-label="トレンド"]');await expect(section.locator('> div').first()).toContainText('#猫トレンド');
  await page.locator('[data-lime-search-explore-tabs]:visible').getByRole('tab',{name:'トレンド',exact:true}).click();await expect(section.locator('> div').first()).toContainText('アニメ新作');
});
test('result tabs appear only after submitting a search and discovery returns after reset',async({page})=>{
  await page.goto('search');const input=page.locator('input[placeholder="検索"]:visible');await input.fill('#猫トレンド');await input.press('Enter');
  await expect(page.locator('[data-lime-search-explore-tabs]')).toHaveCount(0);
  const tabs=page.viewportSize()!.width>=640?page.locator('[data-lime-search-tabs]'):page.locator('[data-lime-search-result-tabs]');
  await expect(tabs).toBeVisible();
  if(page.viewportSize()!.width<640){
    const divider=(await page.locator('[data-lime-search-results-divider]').boundingBox())!;expect(divider.x).toBe(0);expect(divider.width).toBe(page.viewportSize()!.width);
    const post=(await page.locator('[data-lime-post-card]').first().boundingBox())!;expect(post.x).toBe(0);expect(post.width).toBe(page.viewportSize()!.width);
    await page.evaluate(()=>{const filler=document.createElement('div');filler.style.height='1800px';document.querySelector('main')!.append(filler);window.scrollTo(0,350);});
    await expect.poll(async()=>Math.round((await page.locator('[data-lime-app-header]').boundingBox())!.y)).toBe(0);
  }
  for(const label of ['話題','最新','ユーザー','メディア'])await expect(tabs.getByText(label,{exact:true})).toBeVisible();
  await page.evaluate(()=>{history.replaceState(null,'',location.href)});await page.reload();await expect(page.locator('[data-lime-search-explore-tabs]:visible')).toBeVisible();await expect(page.locator('[data-lime-search-tabs]')).toHaveCount(0);
});
test('search tabs retain one moving underline on discovery and desktop results',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto('search');
  const tabs=page.locator('[data-lime-search-explore-tabs]:visible');
  const underline=tabs.locator('[data-lime-search-tab-indicator]');
  await expect(underline).toHaveCount(1);
  const start=(await underline.boundingBox())!.x;
  await tabs.getByRole('tab',{name:'エンターテインメント',exact:true}).click();
  await expect.poll(async()=> (await underline.boundingBox())!.x).toBeGreaterThan(start+40);
  await expect(underline).toHaveCSS('transition-duration','0.28s');
  const input=page.locator('input[placeholder="検索"]:visible');await input.fill('猫');await input.press('Enter');
  if(page.viewportSize()!.width>=640){
    const results=page.locator('[data-lime-search-tabs]');
    const bar=results.locator('[data-lime-search-tab-indicator]');await expect(bar).toHaveCount(1);
    const before=(await bar.boundingBox())!.x;
    await results.getByRole('tab',{name:'メディア',exact:true}).click();
    await expect.poll(async()=> (await bar.boundingBox())!.x).toBeGreaterThan(before+40);
    await expect(bar).toHaveCSS('transition-duration','0.28s');
  }
});
test('trend menu can hide a row without navigating and search settings remain usable',async({page})=>{
  await page.goto('search');await page.getByRole('button',{name:'#猫トレンドのメニュー',exact:true}).click();await page.getByRole('menuitem',{name:'興味がない',exact:true}).click();await expect(page.getByRole('button',{name:'#猫トレンドのメニュー',exact:true})).toHaveCount(0);await expect(page).toHaveURL(/\/search$/);
  await page.getByRole('button',{name:page.viewportSize()!.width>=640?'詳細検索':'検索設定',exact:true}).click();await expect(page.getByText('Blueskyの投稿を含めない',{exact:true})).toBeVisible();
});
test('search uses the existing follow button for following, unfollowing and hover styling',async({page})=>{
  let followed=false;
  await page.route('**/rest/v1/follows*',r=>{
    const req=r.request(),url=new URL(req.url());
    if(req.method()==='POST')followed=true;
    if(req.method()==='DELETE')followed=false;
    const ownCheck=url.searchParams.has('follower_id')&&url.searchParams.has('followee_id');
    const data=ownCheck?(followed?[{follower_id:viewer.id}]:[]):[];
    return r.fulfill({contentType:'application/json',body:req.method()==='HEAD'?'':JSON.stringify(data),headers:{'content-range':`0-0/${followed?1:0}`}});
  });
  await page.goto('search');const button=page.getByRole('button',{name:'フォロー',exact:true});await expect(button).toBeEnabled();await expect(button).toHaveCSS('height','40px');
  await button.click();await page.mouse.move(0,0);
  const following=page.getByRole('button',{name:'フォロー中',exact:true});await expect(following).toBeEnabled();await expect(following).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await following.hover();await expect(page.getByRole('button',{name:'フォロー解除',exact:true})).toBeVisible();await page.getByRole('button',{name:'フォロー解除',exact:true}).click();await page.mouse.move(0,0);await expect(button).toBeEnabled();
});
test('post loading matches the mobile shape and divider stays within its column',async({page})=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/rest/v1/posts*',async r=>{await gate;return r.fulfill({contentType:'application/json',body:'[]'});});
  try{
    await page.goto('search');const input=page.locator('input[placeholder="検索"]:visible');await input.fill('スケルトン確認');await input.press('Enter');
    const skeletons=page.locator('[data-lime-post-skeleton]');await expect(skeletons).toHaveCount(5);
    const first=skeletons.first();await expect(first).toHaveCSS('border-radius','0px');await expect(first).toHaveCSS('box-shadow','none');
    const divider=(await first.locator('[data-lime-post-skeleton-divider]').boundingBox())!;
    if(page.viewportSize()!.width<640){expect(divider.x).toBeCloseTo(0,0);expect(divider.width).toBe(page.viewportSize()!.width);}
    else{const column=(await page.locator('.lime-desktop-column').boundingBox())!;expect(divider.x).toBeGreaterThanOrEqual(column.x);expect(divider.x+divider.width).toBeLessThanOrEqual(column.x+column.width);}
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
    release();await expect(skeletons).toHaveCount(0);
  }finally{release();}
});
test('sidebar and search observe one ranking snapshot and share hidden topics',async({page})=>{
  test.skip(page.viewportSize()!.width<768,'Right sidebar exists on desktop and iPad');
  let requests=0;
  await page.route('**/functions/v1/get-trends',r=>{requests++;return r.fulfill({contentType:'application/json',body:JSON.stringify(trends)});});
  await page.goto('search');await page.locator('[data-lime-search-explore-tabs]:visible').getByRole('tab',{name:'トレンド',exact:true}).click();
  const sidebar=page.locator('[data-lime-sidebar-trend-title]'),search=page.locator('[data-lime-search-trend-title]');
  await expect(sidebar).toHaveCount(3);await expect(search).toHaveCount(3);
  const read=(selector:string,attribute:string)=>page.locator(selector).evaluateAll((els,key)=>els.map(el=>({title:el.getAttribute(key),rank:el.getAttribute('data-lime-trend-rank')})),attribute);
  const compare=async()=>expect(await read('[data-lime-sidebar-trend-title]','data-lime-sidebar-trend-title')).toEqual((await read('[data-lime-search-trend-title]','data-lime-search-trend-title')).slice(0,6));
  await compare();expect(requests).toBe(1);
  await page.getByRole('button',{name:'アニメ新作のメニュー',exact:true}).click();await page.getByRole('menuitem',{name:'興味がない',exact:true}).click();
  await expect(sidebar).toHaveCount(2);await expect(search).toHaveCount(2);await compare();await expect(sidebar.first()).toHaveAttribute('data-lime-trend-rank','2');
});
test('timeline tabs are taller only on desktop and iPad and retain selection and underline',async({page})=>{
  await page.goto('./');const tabs=page.locator('[data-lime-feed-tab-row] [role="tablist"]');await expect(tabs).toBeVisible();
  const height=page.viewportSize()!.width>=768?48:40;
  await expect(tabs).toHaveCSS('height',`${height}px`);
  const buttons=tabs.getByRole('tab');await expect(buttons).toHaveCount(4);
  for(const button of await buttons.all())await expect(button).toHaveCSS('height',`${height}px`);
  await tabs.getByRole('tab',{name:'フォロー中',exact:true}).click();await expect(tabs.getByRole('tab',{name:'フォロー中',exact:true})).toHaveAttribute('data-state','active');
  const underline=tabs.locator('span[aria-hidden="true"]');await expect(underline).toBeVisible();const bounds=(await tabs.boundingBox())!,line=(await underline.boundingBox())!;expect(line.y+line.height).toBeCloseTo(bounds.y+bounds.height,0);
});

test('missing LimeNote news is never replaced by another Bluesky article',async({page})=>{
 await page.route('**/rest/v1/news_summaries*',route=>{const source=new URL(route.request().url()).searchParams.get('source');return route.fulfill({contentType:'application/json',body:JSON.stringify(source==='eq.bluesky'?[news.find(item=>item.source==='bluesky'),{...news.find(item=>item.source==='bluesky'),id:'second-bsky',title:'もう一つの注目ニュース',created_at:'2026-10-03T07:00:00Z'}]:[])});});
 await page.goto('search');const section=page.locator('[data-lime-search-today-news]');await expect(section.locator('h3')).toHaveText(['Blueskyの人気ニュース']);await expect(section).not.toContainText('もう一つの注目ニュース');
});


test('news detail uses the shared header, flat article, ranked tabs and history menu',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/src/api/posts.ts*',r=>r.fulfill({contentType:'application/javascript',body:`const authors=${JSON.stringify(authors)};const posts=[{id:'a',userId:'author-a',content:'新しい関連ポスト',createdAt:'2026-10-09T04:00:00Z',likesCount:1,commentsCount:0,repostsCount:0,imageUrls:[],author:authors[0]},{id:'b',userId:'author-b',content:'反応の多い関連ポスト',createdAt:'2026-10-09T03:00:00Z',likesCount:30,commentsCount:2,repostsCount:3,imageUrls:[],author:authors[1]}];export const getPostById=async id=>posts.find(p=>p.id===id)??null;export const getFeed=async()=>[],getFollowingFeed=getFeed,getPostsByUser=getFeed,getProfilePosts=getFeed,getLikedPostsByUser=getFeed,searchPosts=getFeed;export const toggleLike=async()=>({liked:true}),toggleRepost=async()=>({reposted:true}),deletePost=async()=>{},getPostLikers=async()=>[],createPost=async()=>posts[0];`}));
 await page.goto('news?story=general');
 const root=page.locator('[data-lime-news-detail]'),header=page.locator('header[data-lime-app-header]');
 await expect(root.getByRole('heading',{name:'本日の注目ニュース',exact:true})).toBeVisible();
 await expect(root.getByText('最終更新:',{exact:false})).toBeVisible();
 await expect(header.getByRole('button',{name:'検索に戻る',exact:true})).toBeVisible();
 await expect(header.getByRole('button',{name:'ニュースを共有',exact:true})).toBeVisible();
 expect(await header.evaluate(e=>getComputedStyle(e).borderBottomWidth)).toBe('0px');
 expect((await header.locator('[data-lime-header-row]').boundingBox())!.height).toBe(48);
 for(const icon of await header.locator('[data-lime-header-row] button > svg').all())expect((await icon.boundingBox())!.width).toBe(24);
 await expect(root.getByRole('tab')).toHaveText(['トップ','最新']);
 await expect(root.locator('[data-news-post]')).toHaveCount(2);
 await expect(root.locator('[data-news-post]').first()).toHaveAttribute('data-news-post','b');
 await expect(root.getByRole('img',{name:'引用元A',exact:true}).first()).toHaveAttribute('src',authors[0].avatarUrl);
 expect(await root.locator('.news-detail-article').evaluate(e=>getComputedStyle(e).borderRadius)).toBe('0px');
 const box=await root.getByRole('tablist').boundingBox(),article=await root.locator('.news-detail-article').boundingBox();
 expect(Math.abs(box!.x-article!.x)).toBeLessThan(1);expect(Math.abs(box!.width-article!.width)).toBeLessThan(1);
 await root.getByRole('tab',{name:'最新',exact:true}).click();
 await expect(root.locator('[data-news-post]').first()).toHaveAttribute('data-news-post','a');
 await root.getByRole('tab',{name:'トップ',exact:true}).click();
 await expect(root.locator('[data-news-post]').first()).toHaveAttribute('data-news-post','b');
 await page.screenshot({path:info.outputPath('news-detail.png'),animations:'disabled'});
 for(let i=0;i<2;i++){
  await header.getByRole('button',{name:'ニュースのメニュー',exact:true}).click();
  const item=page.getByRole('menuitem',{name:'トレンド履歴',exact:true});
  await expect(item).toBeVisible();
  await expect.poll(()=>item.evaluate(e=>{const b=e.getBoundingClientRect();return e.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));})).toBe(true);
  await item.click();
  await expect(page).toHaveURL(/news\/history\?story=general/);
  const history=page.locator('[data-lime-news-history]');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(header.getByRole('heading',{name:'トレンド履歴',exact:true})).toBeVisible();
  await expect(history.getByRole('link',{name:/サッカー決勝のニュース/})).toBeVisible();
  const box=await history.boundingBox();expect(box!.y).toBeGreaterThanOrEqual(48);expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({path:info.outputPath('news-history.png'),animations:'disabled'});
  if(i===0){await header.getByRole('button',{name:'ニュースに戻る',exact:true}).click();await expect(history).toHaveCount(0);}
  else {await history.getByRole('link',{name:/サッカー決勝のニュース/}).click();await expect(history).toHaveCount(0);}
 }
 await expect(page).toHaveURL(/news\?story=sports$/);
 await expect(root.getByRole('heading',{name:'サッカー決勝のニュース',exact:true})).toBeVisible();
 await expect(root.locator('[data-news-post]')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 expect(errors).toEqual([]);
 await header.getByRole('button',{name:'検索に戻る',exact:true}).click();
 await expect(page).toHaveURL(/news\/history\?story=general/);
 await header.getByRole('button',{name:'ニュースに戻る',exact:true}).click();
 await expect(page).toHaveURL(/news\?story=general/);
});


test('search settings outside-tap target never shades the search bar',async({page})=>{
 for(const theme of ['light','dark']){
  await page.addInitScript(value=>localStorage.setItem('theme',value),theme);await page.goto('search');
  await page.getByRole('button',{name:page.viewportSize()!.width>=640?'詳細検索':'検索設定',exact:true}).click();
  const dismiss=page.locator('[data-lime-dismiss-backdrop]');await expect(dismiss).toBeVisible();
  await dismiss.hover({position:{x:2,y:2}});await expect(dismiss).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await dismiss.dispatchEvent('pointerdown');await expect(dismiss).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(page.getByText('Blueskyの投稿を含めない',{exact:true})).toBeVisible();
  await dismiss.click({position:{x:2,y:2}});await expect(dismiss).toHaveCount(0);
 }
});
