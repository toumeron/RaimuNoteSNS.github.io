import { test, expect, type Page } from '@playwright/test';
const user={id:'11111111-1111-1111-1111-111111111111',username:'lime',displayName:'Lime',avatarUrl:'',createdAt:'2026-10-01T00:00:00Z'};
const base={userId:user.id,createdAt:user.createdAt,imageUrls:[],visibility:'public',likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,author:user};
const original={...base,id:'original',content:'最初の投稿'};
const middle={...base,id:'middle',content:'二番目のコメント',isQuote:true,parentId:'original'};
const outer={...base,id:'outer',content:'三番目のコメント',isQuote:true,parentId:'middle',parentPost:middle};
async function setup(page:Page, deep=false){
 const post={...original,content:deep?'本文 [[stamp:cat]]':'[[stamp:cat]]'};
 await page.route('**/src/hooks/useAuth.tsx*',route=>route.fulfill({contentType:'application/javascript',body:`export const useAuth=()=>({user:${JSON.stringify(user)},session:null,loading:false,logout:async()=>{},accounts:[],switching:false});export const AuthProvider=({children})=>children;`}));
 await page.route('**/src/lib/currentUser.ts*',route=>route.fulfill({contentType:'application/javascript',body:`export const getCurrentUserId=async()=> '${user.id}';`}));
 await page.route('**/src/api/posts.ts*',route=>route.fulfill({contentType:'application/javascript',body:`const post=${JSON.stringify(post)};export const getFeed=async()=>[post],getFollowingFeed=getFeed,getPostsByUser=getFeed,getProfilePosts=getFeed,getLikedPostsByUser=getFeed,searchPosts=getFeed;export const getPostById=async()=>post,createPost=async input=>{window.__stickerPosted=input;return post;},toggleLike=async()=>({liked:true}),toggleRepost=async()=>({reposted:true}),deletePost=async()=>{},getPostLikers=async()=>[];`}));
 await page.route('**/*.supabase.co/**',route=>{
  const req=route.request(),url=new URL(req.url());
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'*','access-control-allow-headers':req.headers()['access-control-request-headers']??'*'}});
  let data:unknown=[];
  if(url.pathname.endsWith('/custom_emojis'))data=[{id:'sticker',name:'cat',public_id:'cat',format:'png'}];
  if(url.pathname.endsWith('/post_reactions'))data=[{id:'reaction',post_id:'outer',emoji:'😮',user_id:user.id}];
  if(url.pathname.endsWith('/profiles'))data=[{id:user.id,username:user.username,display_name:user.displayName,avatar_url:''}];
  return route.fulfill({contentType:'application/json',headers:{'content-range':'0-0/0'},body:JSON.stringify(data)});
 });

await page.route('**/res.cloudinary.com/dveiikhhw/image/upload/custom_emojis/cat.png',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><circle cx="72" cy="72" r="60" fill="pink"/></svg>'}));
 await page.route('**/public.api.bsky.app/**',route=>route.fulfill({contentType:'application/json',body:'{"feed":[],"posts":[]}'}));
}

test('post stamps render large and a sticker-only post can be selected, removed and sent',async({page},info)=>{
 await setup(page);await page.goto('./');
 const stamp=page.locator('[data-lime-post-card] [data-lime-sticker]');await expect(stamp).toBeVisible();await expect(stamp).toHaveCSS('height','144px');
 const picker=page.getByRole('button',{name:'スタンプを選ぶ'}).first();await picker.click();
 await page.getByRole('button',{name:'catを選ぶ'}).click();await expect(page.locator('[data-lime-sticker-draft]')).toHaveCount(1);
 await page.getByRole('button',{name:'スタンプを外す'}).click();await expect(page.locator('[data-lime-sticker-draft]')).toHaveCount(0);
 await picker.click();await page.getByRole('button',{name:'catを選ぶ'}).click();
 const submit=page.getByRole('button',{name:'ポスト',exact:true}).last();await expect(submit).toBeEnabled();await submit.click();
 await expect.poll(()=>page.evaluate(()=>window.__stickerPosted?.content)).toBe('[[stamp:cat]]');
 await expect(page.locator('[data-lime-sticker-draft]')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('sticker-post.png')});
});
test('replies can send text plus a sticker and keep the text input usable',async({page})=>{
 await setup(page);
 await page.route('**/src/hooks/useComments.ts*',r=>r.fulfill({contentType:'application/javascript',body:`export const useComments=()=>({data:[],isLoading:false});export const useCreateComment=()=>({mutateAsync:async input=>{window.__replyPosted=input;},isPending:false});export const useToggleCommentLike=()=>({mutateAsync:async()=>{}});export const useDeleteComment=()=>({mutateAsync:async()=>{}});`}));
 await page.goto('./post/original');
 const form=page.locator('[data-lime-reply-composer]:visible').first();await expect(form).toBeVisible();
 await form.getByPlaceholder('返信をポスト').fill('ありがとう');
 await form.getByRole('button',{name:'スタンプを選ぶ'}).click();await page.getByRole('button',{name:'catを選ぶ'}).click();
 await form.getByRole('button',{name:'スタンプを選ぶ'}).click();await page.getByRole('button',{name:'catを選ぶ'}).click();
 await expect(form.locator('[data-lime-draft-emoji]')).toHaveCount(2);await form.getByRole('button',{name:'コメントを送信'}).click();
 await expect.poll(()=>page.evaluate(()=>window.__replyPosted?.content)).toBe('ありがとう[[emoji:cat]][[emoji:cat]]');
 await expect(form.locator('[data-lime-sticker-draft]')).toHaveCount(0);
});

test('the mobile fullscreen and desktop overlay composers can select and send a stamp',async({page},info)=>{
 await setup(page);await page.goto('./');
 if(info.project.name === 'WebKit-iPhone') {await page.getByRole('button',{name:'リポスト',exact:true}).click();await page.getByRole('menuitem',{name:'引用リポスト',exact:true}).click();}
 else if(await page.locator('[data-lime-sidebar-compose]:visible').count()) await page.locator('[data-lime-sidebar-compose]').click();
 else if(await page.getByRole('button',{name:'新規投稿',exact:true}).isVisible()) await page.getByRole('button',{name:'新規投稿',exact:true}).click();
 else {await page.getByRole('button',{name:'リポスト',exact:true}).click();await page.getByRole('menuitem',{name:'引用リポスト',exact:true}).click();}
 const dialog=page.getByRole('dialog',{name:/^(新規ポスト|引用リポスト)$/});await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:'スタンプを選ぶ'}).click();
 await page.getByRole('button',{name:'catを選ぶ'}).click();await expect(dialog.locator('[data-lime-sticker-draft]')).toHaveCount(1);
 await dialog.getByRole('button',{name:/^(ポスト(する)?|引用ポスト)$/}).click();
 await expect.poll(()=>page.evaluate(()=>window.__stickerPosted?.content)).toBe('[[stamp:cat]]');
});

test('text uses inline emoji size and reply tools do not move when typing',async({page},info)=>{
 await setup(page,true);
 await page.goto('./');
 if(info.project.name==='desktop'){const tool=page.getByRole('button',{name:'スタンプを選ぶ'}).first();await expect(tool).toHaveText('スタンプ');const image=page.getByRole('button',{name:'画像',exact:true}).first();expect((await tool.boundingBox())!.x).toBeGreaterThan((await image.boundingBox())!.x);}
 await page.goto('./post/original');
 const stamp=page.locator('[data-lime-sticker-inline="true"]').first();await expect(stamp).toHaveCSS('height','24px');
 const form=page.locator('[data-lime-reply-composer]:visible').first();
 const image=form.getByRole('button',{name:'返信に画像を添付'}),sticker=form.getByRole('button',{name:'スタンプを選ぶ'});
 await expect(image).toBeHidden();await form.getByPlaceholder('返信をポスト').focus();await expect(image).toBeVisible();const imageBefore=(await image.boundingBox())!,stickerBefore=(await sticker.boundingBox())!;
 const input=form.getByPlaceholder('返信をポスト'),inputBefore=(await input.boundingBox())!;
 await input.fill('文字を入力中です');
 expect((await input.boundingBox())!.y).toBeCloseTo(inputBefore.y,0);expect((await input.boundingBox())!.height).toBeCloseTo(inputBefore.height,0);
 expect((await image.boundingBox())!.x).toBeCloseTo(imageBefore.x,0);expect((await image.boundingBox())!.y).toBeCloseTo(imageBefore.y,0);
 expect((await sticker.boundingBox())!.x).toBeCloseTo(stickerBefore.x,0);expect((await sticker.boundingBox())!.y).toBeCloseTo(stickerBefore.y,0);
 await sticker.click();
 const mobile=await page.evaluate(()=>window.innerWidth<768);
 await expect(page.locator(`[data-lime-sticker-picker="${mobile?'mobile':'desktop'}"]`)).toBeVisible();
 await page.screenshot({path:info.outputPath('sticker-picker.png')});
 await page.getByRole('button',{name:'catを選ぶ'}).click();
 await expect(form.locator('[data-lime-draft-emoji]')).toHaveCount(1);
 await expect(form.locator('[data-lime-sticker-draft]')).toHaveCount(0);
 expect(await image.evaluate(el=>getComputedStyle(el).color)).not.toBe(await sticker.evaluate(el=>getComputedStyle(el).color));
 await expect.poll(()=>input.evaluate((el:HTMLTextAreaElement)=>el.selectionStart===el.value.length)).toBe(true);
 await expect(input).toBeFocused();
 await page.screenshot({path:info.outputPath('reply-inline-emoji.png')});
 await input.press('Backspace');await expect(form.locator('[data-lime-draft-emoji]')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('reply-after-delete.png')});
});

test('inline composer inserts multiple emoji at the selection without an attachment preview',async({page},info)=>{
 await setup(page);await page.goto('./');
 const input=page.locator('textarea').first();await input.fill('abcd');
 await input.evaluate((el:HTMLTextAreaElement)=>el.setSelectionRange(1,3));
 const picker=page.getByRole('button',{name:'スタンプを選ぶ'}).first();
 await picker.click();await page.getByRole('button',{name:'catを選ぶ'}).click();
 await expect(page.locator('[data-lime-draft-emoji]')).toHaveCount(1);
 await picker.click();await page.getByRole('button',{name:'catを選ぶ'}).click();
 await expect(page.locator('[data-lime-draft-emoji]')).toHaveCount(2);
 await expect(page.locator('[data-lime-sticker-draft]')).toHaveCount(0);
 await expect(page.locator('[data-lime-sticker-picker]')).toBeHidden();
 await expect(input).toBeFocused();
 await page.screenshot({path:info.outputPath('inline-emojis.png')});
 await page.getByRole('button',{name:'ポスト',exact:true}).last().click();
 await expect.poll(()=>page.evaluate(()=>window.__stickerPosted?.content)).toBe('a[[emoji:cat]][[emoji:cat]]d');
});
