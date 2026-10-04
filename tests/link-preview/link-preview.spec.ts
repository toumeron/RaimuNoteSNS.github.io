import { test, expect, type Page, type Locator } from '@playwright/test';
const user={id:'11111111-1111-1111-1111-111111111111',username:'lime',displayName:'Lime Note',avatarUrl:'',createdAt:'2026-10-01T00:00:00Z'};
const profile={id:user.id,username:user.username,display_name:user.displayName,avatar_url:'',created_at:user.createdAt};
const base={userId:user.id,createdAt:user.createdAt,imageUrls:[],visibility:'public',likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,author:user};
const posts=[{...base,id:'native',content:'9月の日記を更新しました https://preview.example/diary'},{...base,id:'private',visibility:'following',content:'二つのリンク https://preview.example/a https://preview.example/b'},{...base,id:'bsky:at://did:plc:test/app.bsky.feed.post/demo',source:'bluesky',content:'プレビューなし https://preview.example/none'}];
const reply={...base,id:'reply:child',replyId:'child',replyPostId:'native',replyToUsername:'lime',content:'返信のリンク https://preview.example/reply'};
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
test('one-link cards are flush and responsive; multiple links and unavailable cards stay text',async({page},info)=>{
  await setup(page,false);
  await page.route('https://preview.example/cover.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="628"><rect width="1200" height="628" fill="#d8ecc1"/><circle cx="600" cy="314" r="180" fill="#ed87b1"/></svg>'}));
  await page.goto('./');
  const card=page.locator('[data-lime-post-card]').filter({hasText:'9月の日記を更新しました'}).first();
  const preview=card.locator('[data-link-preview]');await expect(preview).toBeVisible();await expect(preview.locator('img')).toBeVisible();
  await expect(card.getByText('https://preview.example/diary',{exact:true})).toHaveCount(0);
  const bounds=await preview.boundingBox(),image=await preview.locator('img').boundingBox();expect(Math.abs(bounds!.width-image!.width)).toBeLessThanOrEqual(3);expect(Math.abs(image!.y-bounds!.y)).toBeLessThanOrEqual(2);
  expect(bounds!.x+bounds!.width).toBeLessThanOrEqual((page.viewportSize()?.width??0));
  const multiple=page.locator('[data-lime-post-card]').filter({hasText:'二つのリンク'}).first();await expect(multiple.locator('[data-link-preview]')).toHaveCount(0);await expect(multiple.locator('a[href="https://preview.example/a"]')).toBeVisible();
  const none=page.locator('[data-lime-post-card]').filter({hasText:'プレビューなし'}).first();await expect(none.locator('[data-link-preview]')).toHaveCount(0);await expect(none.locator('a[href="https://preview.example/none"]')).toBeVisible();
  await preview.evaluate(element=>element.scrollIntoView({block:'center',behavior:'instant'}));
  await page.waitForTimeout(150);
  await preview.screenshot({path:info.outputPath('link-preview.png'),animations:'disabled'});
  await page.goto('post/native');await expect(page.locator('[data-lime-post-detail-card] [data-link-preview]')).toBeVisible();await expect(page.locator('[data-lime-comment-card="child"] [data-link-preview]')).toBeVisible();
});
