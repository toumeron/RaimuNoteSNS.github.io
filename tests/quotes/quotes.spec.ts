import { test, expect, type Page } from '@playwright/test';
const user={id:'11111111-1111-1111-1111-111111111111',username:'lime',displayName:'Lime',avatarUrl:'',createdAt:'2026-10-01T00:00:00Z'};
const base={userId:user.id,createdAt:user.createdAt,imageUrls:[],visibility:'public',likesCount:0,commentsCount:0,repostsCount:0,likedByMe:false,repostedByMe:false,author:user};
const original={...base,id:'original',content:'最初の投稿'};
const middle={...base,id:'middle',content:'二番目のコメント',isQuote:true,parentId:'original'};
const outer={...base,id:'outer',content:'三番目のコメント',isQuote:true,parentId:'middle',parentPost:middle};
async function setup(page:Page, deep=false){
 const post=deep?{...outer,parentPost:{...middle,parentPost:original}}:outer;
 await page.route('**/src/hooks/useAuth.tsx*',route=>route.fulfill({contentType:'application/javascript',body:`export const useAuth=()=>({user:${JSON.stringify(user)},session:null,loading:false,logout:async()=>{},accounts:[],switching:false});export const AuthProvider=({children})=>children;`}));
 await page.route('**/src/lib/currentUser.ts*',route=>route.fulfill({contentType:'application/javascript',body:`export const getCurrentUserId=async()=> '${user.id}';`}));
 await page.route('**/src/api/posts.ts*',route=>route.fulfill({contentType:'application/javascript',body:`const post=${JSON.stringify(post)};export const getFeed=async()=>[post],getFollowingFeed=getFeed,getPostsByUser=getFeed,getProfilePosts=getFeed,getLikedPostsByUser=getFeed,searchPosts=getFeed;export const getPostById=async()=>post,createPost=async()=>post,toggleLike=async()=>({liked:true}),toggleRepost=async()=>({reposted:true}),deletePost=async()=>{},getPostLikers=async()=>[];`}));
 await page.route('**/*.supabase.co/**',route=>{
  const req=route.request(),url=new URL(req.url());
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'*','access-control-allow-headers':req.headers()['access-control-request-headers']??'*'}});
  let data:unknown=[];
  if(url.pathname.endsWith('/post_reactions'))data=[{id:'reaction',post_id:'outer',emoji:'😮',user_id:user.id}];
  if(url.pathname.endsWith('/profiles'))data=[{id:user.id,username:user.username,display_name:user.displayName,avatar_url:''}];
  return route.fulfill({contentType:'application/json',headers:{'content-range':'0-0/0'},body:JSON.stringify(data)});
 });
 await page.route('**/public.api.bsky.app/**',route=>route.fulfill({contentType:'application/json',body:'{"feed":[],"posts":[]}'}));
}
for(const detail of [false,true])test(`quote of quote is flattened; reactions immediately precede actions in ${detail?'detail':'timeline'}`,async({page},info)=>{
 await setup(page);await page.goto(detail?'./post/outer':'./');
 const quote=page.locator('[data-lime-quoted-post]');
 await expect(quote).toHaveCount(1);
 await expect(quote).toContainText('二番目のコメント');
 await expect(quote.locator('a[href$="/post/original"]')).toHaveCount(1);
 await expect(page.getByText('引用元の投稿は削除されたか、閲覧できません。')).toHaveCount(0);
 const header=await quote.locator('[data-lime-post-header]').boundingBox();
 const body=await quote.locator('[data-lime-post-body] p').first().boundingBox();
 expect(body!.y-(header!.y+header!.height)).toBeGreaterThanOrEqual(0);
 expect(body!.y-(header!.y+header!.height)).toBeLessThanOrEqual(6);
 expect(body!.height).toBeLessThanOrEqual(49);
 const reactions=page.locator('[data-lime-post-reactions]').first();await expect(reactions).toBeVisible();
 const reactionBox=(await reactions.boundingBox())!,quoteBox=(await quote.boundingBox())!,actions=(await page.locator('[data-lime-post-actions]').first().boundingBox())!;
 expect(reactionBox.y).toBeGreaterThanOrEqual(quoteBox.y+quoteBox.height);
 expect(actions.y-(reactionBox.y+reactionBox.height)).toBeGreaterThanOrEqual(0);
 expect(actions.y-(reactionBox.y+reactionBox.height)).toBeLessThanOrEqual(16);
 await page.screenshot({path:info.outputPath(detail?'quote-detail.png':'quote-timeline.png')});
});
test('a fully loaded nested quote also produces only one embedded card',async({page})=>{
 await setup(page,true);await page.goto('./');
 await expect(page.locator('[data-lime-quoted-post]')).toHaveCount(1);
 await expect(page.getByText('最初の投稿',{exact:true})).toHaveCount(0);
});
