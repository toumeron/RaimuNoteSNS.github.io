import {test,expect,type Page} from '@playwright/test';
const viewer={id:'11111111-1111-4111-8111-111111111111',username:'viewer',displayName:'地図ユーザー',avatarUrl:'',createdAt:'2026-10-01T00:00:00Z'};
const post={id:'22222222-2222-4222-8222-222222222222',userId:viewer.id,content:'地図に載せたポスト',createdAt:'2026-10-09T00:00:00Z',imageUrls:[],likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,visibility:'public',author:viewer,mapLocation:{latitude:36.2,longitude:138.25}};
async function setup(page:Page,own=true){
 const mapPost=own?post:{...post,userId:"other",author:{...viewer,id:"other"}};
 page.on('pageerror',e=>console.log('BROWSER ERROR',e.message));
 await page.addInitScript(()=>{(window as any).__locationCalls=0;Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:()=>{(window as any).__locationCalls++},watchPosition:()=>{(window as any).__locationCalls++}}});});
 await page.route('**/src/hooks/useAuth.tsx*',r=>r.fulfill({contentType:'application/javascript',body:`export const useAuth=()=>({user:${JSON.stringify(viewer)},loading:false,accounts:[],logout:async()=>{}});export const AuthProvider=({children})=>children;`}));
 await page.route('**/src/lib/currentUser.ts*',r=>r.fulfill({contentType:'application/javascript',body:`export const getCurrentUserId=async()=> '${viewer.id}';`}));
 await page.route('**/src/api/posts.ts*',r=>r.fulfill({contentType:'application/javascript',body:`const p=${JSON.stringify(mapPost)};export const getMapPosts=async()=>[p];export const setPostMapLocation=async(id,point)=>{window.__savedLocation={id,point};p.mapLocation=point;};export const getPostById=async()=>p;export const getFeed=async()=>[p],getFollowingFeed=getFeed,getPostsByUser=getFeed,getProfilePosts=getFeed,getLikedPostsByUser=getFeed,getHighlightedPosts=getFeed,searchPosts=getFeed;export const toggleLike=async()=>({liked:true}),toggleRepost=async()=>({reposted:true}),deletePost=async()=>{},getPostLikers=async()=>[],createPost=async input=>{window.__createdPost=input;return {...p,...input,id:'new-post'};};`}));
 await page.route('**/*.supabase.co/**',r=>r.fulfill({contentType:'application/json',body:r.request().method()==='HEAD'?'':'[]',headers:{'content-range':'0-0/0'}}));
 await page.route('**/public.api.bsky.app/**',r=>r.fulfill({contentType:'application/json',body:'{"posts":[],"feed":[]}'}));
 await page.route('https://tile.openstreetmap.org/**',r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK9sAAAAASUVORK5CYII=','base64')}));
}
test.beforeEach(async({page})=>setup(page));
test('map selection opens the existing composer and submits the chosen location without device location',async({page},info)=>{
 await page.goto('maps');await expect(page.locator('[data-lime-app-header]:visible')).toHaveCount(0);
 const map=page.locator('.lime-map').first();await expect(map.locator('.leaflet-tile-loaded').first()).toBeVisible();
 await map.click({position:{x:140,y:180}});
 await page.locator('.lime-map-pin-selected').click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByRole('heading',{name:'ポストする',exact:true})).toBeVisible();
 await dialog.locator('textarea').fill('ピンから投稿します');await dialog.getByRole('button',{name:'ポスト',exact:true}).click();await expect(dialog).toHaveCount(0);
 const submitted=await page.evaluate(()=>(window as any).__createdPost);expect(submitted.content).toBe('ピンから投稿します');expect(submitted.mapLocation.latitude).toBeGreaterThan(-90);expect(submitted.mapLocation.longitude).toBeGreaterThan(-180);
 expect(await page.evaluate(()=>(window as any).__locationCalls)).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
 await page.screenshot({path:info.outputPath('maps.png'),animations:'disabled'});
});
test('public marker shows author and post; own edit saves and removes location',async({page})=>{
 await page.goto('maps');await page.locator('.leaflet-marker-icon[title="地図ユーザーのポスト"]').click();await page.getByRole('button',{name:'ポストを見る',exact:true}).click();
 const card=page.locator('[data-lime-map-selected-post]');await expect(card).toContainText('地図に載せたポスト');await expect(card).toContainText('地図ユーザー');
 await card.getByRole('button',{name:'ポストのメニュー',exact:true}).click();await page.getByRole('button',{name:'編集',exact:true}).click();
 let dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'ポストを編集'})});await expect(dialog.getByRole('heading',{name:'ポストを編集'})).toBeVisible();await dialog.locator('.lime-map').click({position:{x:150,y:180}});await dialog.getByRole('button',{name:'保存する',exact:true}).click();await expect(page.getByRole('heading',{name:'ポストを編集'})).toHaveCount(0);
 expect((await page.evaluate(()=>(window as any).__savedLocation)).id).toBe(post.id);
 await card.getByRole('button',{name:'ポストのメニュー',exact:true}).click();await page.getByRole('button',{name:'編集',exact:true}).click();dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'ポストを編集'})});await dialog.getByRole('button',{name:'場所を削除',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect((await page.evaluate(()=>(window as any).__savedLocation)).point).toBeNull();
});
test('desktop More and mobile sidebar link to LimeMaps',async({page})=>{
 await page.goto('search');
 if(page.viewportSize()!.width>=768) await page.getByRole('button',{name:'もっと見る',exact:true}).click();
 else await page.getByRole('button',{name:'メニューを開く',exact:true}).click();
 await page.getByText('LimeMaps',{exact:true}).click();await expect(page).toHaveURL(/\/maps$/);await expect(page.locator('.lime-map')).toBeVisible();
});

test('another user cannot open the location editor',async({page})=>{
 await setup(page,false);await page.goto('maps');await page.locator('.leaflet-marker-icon[title="地図ユーザーのポスト"]').click();await page.getByRole('button',{name:'ポストを見る',exact:true}).click();
 await page.locator('[data-lime-map-selected-post]').getByRole('button',{name:'ポストのメニュー',exact:true}).click();
 await expect(page.getByRole('button',{name:'編集',exact:true})).toHaveCount(0);
});

test('map fills the area outside navigation and keeps reference metadata on tiles',async({page})=>{
 await page.goto('maps');const map=page.locator('[data-lime-maps]');await expect(map).toBeVisible();
 await expect(page.locator('[data-lime-app-header]:visible')).toHaveCount(0);
 const bounds=(await map.boundingBox())!;expect(bounds.y).toBe(0);
 if(page.viewportSize()!.width<768){const nav=(await page.locator('[data-lime-bottom-nav-root]').boundingBox())!;expect(bounds.x).toBe(0);expect(bounds.width).toBe(page.viewportSize()!.width);expect(bounds.height).toBeCloseTo(nav.y,0);await page.getByRole('button',{name:'メニューを開く',exact:true}).click();await expect(page.locator('[data-lime-mobile-sidebar]')).toBeVisible();}
 else {expect(bounds.x+bounds.width).toBeCloseTo(page.viewportSize()!.width,0);expect(bounds.height).toBe(page.viewportSize()!.height);}
 await expect(page.locator('.leaflet-tile').first()).toHaveAttribute('referrerpolicy','strict-origin-when-cross-origin');
});

test('live map tiles load with an origin referrer @live',async({page},info)=>{
 test.skip(process.env.LIME_MAP_LIVE!=='1','Explicit live tile verification only');
 await page.unroute('https://tile.openstreetmap.org/**');
 const statuses:number[]=[];let referer='';
 page.on('response',r=>{if(r.url().startsWith('https://tile.openstreetmap.org/'))statuses.push(r.status());});
 page.on('request',async r=>{if(r.url().startsWith('https://tile.openstreetmap.org/'))referer=(await r.allHeaders()).referer??'';});
 await page.goto('maps');
 await expect.poll(()=>statuses.filter(status=>status===200).length,{timeout:20000}).toBeGreaterThan(0);
 expect(statuses.filter(status=>status===403)).toHaveLength(0);expect(referer).toBe('http://127.0.0.1:8080/');
 await expect.poll(()=>page.locator('.leaflet-tile-loaded').first().evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBe(256);
 await page.screenshot({path:info.outputPath('live-map.png'),animations:'disabled'});
});

test('light and dark maps follow the theme and omit the guide and count',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('theme','light'));await page.goto('maps');
 await expect(page.locator('html')).toHaveClass(/light/);await expect(page.locator('.leaflet-tile-pane')).toHaveCSS('filter','none');
 await expect(page.getByText('場所を押してピンを置き、ピンを押してポスト',{exact:true})).toHaveCount(0);await expect(page.getByText(/件の公開ポスト/)).toHaveCount(0);
 await expect(page.locator('.lime-maps-search input')).toHaveCSS('color','rgb(27, 37, 43)');
 await page.addInitScript(()=>localStorage.setItem('theme','dark'));await page.reload();await expect(page.locator('html')).toHaveClass(/dark/);await expect(page.locator('.leaflet-tile-pane')).not.toHaveCSS('filter','none');
});
test('sidebar can collapse only on desktop and restores outside maps without map errors',async({page},info)=>{
 await page.goto('maps');const close=page.getByRole('button',{name:'サイドバーを閉じる',exact:true});
 if(info.project.name!=='desktop'){await expect(close).not.toBeVisible();return;}
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await close.click();await expect(page.locator('[data-lime-desktop-sidebar]')).not.toBeVisible();
 let box=(await page.locator('[data-lime-maps]').boundingBox())!;expect(box.x).toBe(0);expect(box.width).toBe(page.viewportSize()!.width);
 await page.getByRole('button',{name:'サイドバーを開く',exact:true}).click();await expect(page.locator('[data-lime-desktop-sidebar]')).toBeVisible();
 for(let i=0;i<3;i++){await page.locator('.lime-map').click({position:{x:160,y:200}});await page.locator('.lime-map-pin-selected').click();await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();}
 await close.click();await page.goto('search');await expect(page.locator('[data-lime-desktop-sidebar]')).toBeVisible();expect(errors).toEqual([]);
});


test('post menus retain mobile styling and use readable desktop sizing',async({page},info)=>{
 const phone=page.viewportSize()!.width<640;
 await page.goto('maps');await page.locator('.leaflet-marker-icon[title="地図ユーザーのポスト"]').press('Enter');await page.getByRole('button',{name:'ポストを見る',exact:true}).click();
 const card=page.locator('[data-lime-map-selected-post]');
 await card.getByRole('button',{name:'ポストのメニュー',exact:true}).click();
 const menu=page.locator('.lime-post-options');await expect(menu).toBeVisible();
 const row=menu.getByRole('button',{name:'編集',exact:true});
 await expect(row).toHaveCSS('font-size','14px');await expect(row).toHaveCSS('min-height',phone?'44px':'40px');
 expect(await menu.evaluate(el=>el.getBoundingClientRect().width)).toBeLessThanOrEqual(phone?240:280);
 if(phone)await expect(page.locator('.lime-post-options-backdrop')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 await expect(page.getByRole('combobox',{name:'ポストのメニュー',exact:true})).toHaveCount(0);
 await page.screenshot({path:info.outputPath('post-menu.png')});
 await row.click();await expect(page.getByRole('heading',{name:'ポストを編集',exact:true})).toBeVisible();
});
