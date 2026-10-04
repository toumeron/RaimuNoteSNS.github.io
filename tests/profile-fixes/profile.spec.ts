import {test,expect} from '@playwright/test';
const user={id:'11111111-1111-1111-1111-111111111111',username:'lime',displayName:'Lime',avatarUrl:'',createdAt:'2026-10-01T00:00:00Z'};
const original={id:'original',userId:user.id,content:'元の投稿も残る',createdAt:user.createdAt,imageUrls:[],visibility:'public',likesCount:0,commentsCount:0,repostsCount:1,likedByMe:false,repostedByMe:true,author:user};
const parent={...original,id:'parent',content:'スペースのお知らせ https://toumeron.github.io/RaimuNoteSNS.github.io/spaces/space-test'};
const profiles={id:user.id,username:'lime',display_name:'Lime',avatar_url:'',created_at:user.createdAt};
test('self repost remains alongside original and profile replies show space cards',async({page},info)=>{
 const errors:string[]=[];page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
 await page.route('**/src/hooks/useAuth.tsx*',r=>r.fulfill({contentType:'application/javascript',body:`const user=${JSON.stringify(user)};export const useAuth=()=>({user,loading:false,accounts:[],logout:async()=>{}});export const AuthProvider=({children})=>children;`}));
 await page.route('**/src/lib/currentUser.ts*',r=>r.fulfill({contentType:'application/javascript',body:`export const getCurrentUserId=async()=> '${user.id}';`}));
 await page.route('**/src/hooks/useProfile.ts*',r=>r.fulfill({contentType:'application/javascript',body:`const user=${JSON.stringify(user)},post=${JSON.stringify(original)};const result={data:{pages:[[ {...post,profileRepostedBy:user.id,profileRepostedAt:'2026-10-04T05:00:00Z'},post,{...post,profileRepostedBy:user.id,profileRepostedAt:'2026-10-04T05:00:00Z'} ]]},isLoading:false,isError:false,hasNextPage:false,isFetchingNextPage:false,fetchNextPage:async()=>{},refetch:async()=>{}};export const useProfile=()=>({data:user,isLoading:false,isError:false});export const useUserPostsInfinite=()=>result;export const useUserLikesInfinite=useUserPostsInfinite,useUserMediaInfinite=useUserPostsInfinite,useUserReactionsInfinite=useUserPostsInfinite;export const useFollowStats=()=>({data:{followers:0,following:0}});export const useToggleFollow=()=>({mutate:()=>{}});export const useUpdateProfile=()=>({mutate:()=>{}});`}));
 await page.route('**/*.supabase.co/**',r=>{
  const req=r.request(),url=new URL(req.url());let data:unknown=[];
  if(url.pathname.endsWith('/profiles'))data=req.headers().accept?.includes('vnd.pgrst.object')?profiles:[profiles];
  if(url.pathname.endsWith('/comments'))data=[{id:'reply',post_id:'parent',user_id:user.id,content:'返信のスペース https://toumeron.github.io/RaimuNoteSNS.github.io/spaces/space-test',created_at:'2026-10-03T00:00:00Z',parent_comment_id:null,image_urls:[],profiles}];
  if(url.pathname.endsWith('/posts'))data=[{...parent,user_id:user.id,created_at:parent.createdAt,profiles}];
  if(url.pathname.endsWith('/get_space_card'))data={id:'space-test',title:'テストのスペース',is_active:true,profiles};
  if(url.pathname.endsWith('/get_space_state'))data=null;
  return r.fulfill({contentType:'application/json',body:req.method()==='HEAD'?'':JSON.stringify(data),headers:{'content-range':'0-0/0'}});
 });
 await page.route('**/public.api.bsky.app/**',r=>r.fulfill({contentType:'application/json',body:'{"posts":[],"feed":[]}'}));
 await page.goto('./u/lime');
 await expect(page.locator('[data-lime-post-card]').filter({hasText:'元の投稿も残る'})).toHaveCount(2);
 await expect(page.getByText('あなたがリポストしました',{exact:true})).toHaveCount(1);
 await expect(page.getByText('テストのスペース',{exact:true})).toHaveCount(2);
 await expect(page.getByText('返信のスペース',{exact:true})).toBeVisible();
 expect(errors.filter(e=>e.includes('same key'))).toEqual([]);
 await page.screenshot({path:info.outputPath('profile.png'),fullPage:true});
});
