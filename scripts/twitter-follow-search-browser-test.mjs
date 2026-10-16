import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
const viewer='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222';
const external={id:'x-user:123',username:'Google@twitter.com',displayName:'Google',avatarUrl:'',bio:'Verified account',providerVerification:{provider:'twitter',type:'organization'}};
try{
 const page=await browser.newPage(),errors=[],saves=[];let followed=true;
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/src/hooks/useAuth.tsx*',route=>route.fulfill({contentType:'application/javascript',body:`export const useAuth=()=>({user:{id:'${viewer}',username:'fixture',displayName:'Fixture',avatarUrl:''},loading:false,accounts:[],session:null});export const AuthProvider=({children})=>children;`}));
 await page.route('**/*.supabase.co/**',route=>{
  const request=route.request(),url=new URL(request.url()),headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':request.headers()['access-control-request-headers']??'*'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(url.pathname.endsWith('/market-data'))return route.continue();
  let data=[];
  if(url.pathname.endsWith('/profiles')&&url.searchParams.get('username')==='eq.owner')data={id:owner,username:'owner',display_name:'Owner'};
  if(url.pathname.endsWith('/follows')&&url.searchParams.get('select')?.includes('profile:profiles'))data=[{profile:null,external_provider:'x',external_handle:'google',external_profile:external}];
  if(url.pathname.endsWith('/external_account_users'))data=followed?[{provider:'x',handle:'google'}]:[];
  if(url.pathname.endsWith('/rpc/set_external_follow')){const body=JSON.parse(request.postData());saves.push(body);followed=body.enabled;data=null;}
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.route('https://public.api.bsky.app/**',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:'{"actors":[],"posts":[]}'}));
 await page.route('https://misskey.io/**',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:'[]'}));
 await page.route('https://api.fxtwitter.com/**',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'application/json',body:JSON.stringify({code:200,users:[{id:'123',screen_name:'Google',name:'Google',verification:{verified:true,type:'organization'}}]})}));
 for(const width of [390,1280]){
  followed=true;await page.setViewportSize({width,height:900});
  await page.goto('http://127.0.0.1:8080/RaimuNoteSNS.github.io/u/owner/followers_following?tab=following');
  const row=page.getByRole('article',{name:'Google'});
  await expect(row.getByAltText('twitter認証済み')).toBeVisible();
  await row.getByRole('button',{name:/フォロー中|フォロー解除/}).click();
  await expect(row.getByRole('button',{name:'フォロー',exact:true})).toBeEnabled();
  assert.equal(saves.at(-1).provider,'x');assert.equal(saves.at(-1).enabled,false);
  await row.getByRole('button',{name:'フォロー',exact:true}).click();
  await expect(row.getByRole('button',{name:/フォロー中|フォロー解除/})).toBeEnabled();assert.equal(saves.at(-1).enabled,true);
  await page.goto('http://127.0.0.1:8080/RaimuNoteSNS.github.io/search');
  const input=page.getByPlaceholder('検索').filter({visible:true});await input.fill('Google');
  const suggestion=page.getByRole('button').filter({has:page.getByAltText('twitter認証済み')}).filter({hasText:'Google'});
  await expect(suggestion).toBeVisible({timeout:20000});
  console.log(JSON.stringify({width,followToggle:true,followBadge:true,suggestionBadge:true}));
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
