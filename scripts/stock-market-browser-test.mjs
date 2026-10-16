import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.stack??error.message));
 // Test the actual app with an isolated fake account, never a personal session.
 await page.route('**/src/hooks/useAuth.tsx*',route=>route.fulfill({contentType:'application/javascript',body:`export const useAuth=()=>({user:{id:'11111111-1111-4111-8111-111111111111',username:'fixture',displayName:'Fixture',avatarUrl:''},loading:false,accounts:[],switching:false,session:null});export const AuthProvider=({children})=>children;`}));
 await page.route('**/*.supabase.co/**',route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname.endsWith('/market-data'))return route.continue();
  const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','access-control-allow-headers':request.headers()['access-control-request-headers']??'*'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  return route.fulfill({headers,contentType:'application/json',body:'[]'});
 });
 for(const width of [390,1280]){
  await page.setViewportSize({width,height:1000});
  await page.goto('http://127.0.0.1:8080/RaimuNoteSNS.github.io/search?q=%24AAPL');
  const card=page.locator('[data-lime-stock-card]');
  try{await expect(card.locator('.lime-stock-price')).toContainText('$',{timeout:15000});}catch(error){console.log(JSON.stringify({errors,url:page.url(),body:(await page.locator('body').innerText()).slice(0,1000)}));throw error;}
  await expect(card.getByRole('img',{name:/株価チャート/})).toBeVisible();
  await card.getByRole('button',{name:'1W',exact:true}).click();
  await expect(card.getByRole('img',{name:/1W/})).toBeVisible({timeout:15000});
  const bounds=await card.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1);
  const input=page.getByPlaceholder('検索').filter({visible:true});
  await input.fill('$AAP');await input.focus();
  const suggestion=page.getByRole('button').filter({has:page.locator('.lime-stock-suggestion-name')}).filter({hasText:'Apple Inc.'});
  await expect(suggestion).toBeVisible();await expect(suggestion.locator('.lime-stock-suggestion-price')).toContainText('$');
  await suggestion.click();await expect(input).toHaveValue('$AAPL');await expect(card).toBeVisible();
  await expect(card.locator('.lime-stock-mark,img')).toHaveCount(0);
  await page.goto('http://127.0.0.1:8080/RaimuNoteSNS.github.io/search?q='+encodeURIComponent('キオクシア'));
  await expect(card.locator('.lime-stock-price')).toContainText('￥',{timeout:15000});
  await input.focus();
  const domestic=page.getByRole('button').filter({has:page.locator('.lime-stock-suggestion-name')}).filter({hasText:'キオクシアホールディングス'});
  await expect(domestic).toBeVisible();
  await input.press('Escape');
  await expect(card.getByRole('heading',{name:'キオクシアホールディングス'})).toBeVisible();
  await expect(card.locator('.lime-stock-price')).toContainText('￥',{timeout:15000});
  await expect(card.locator('.lime-stock-mark,img')).toHaveCount(0);
  await page.evaluate(()=>document.documentElement.classList.add('dark'));
  await card.screenshot({path:`/tmp/lime-stock-card-${width}.png`});
  console.log(JSON.stringify({width,price:await card.locator('.lime-stock-price').innerText(),cardWidth:bounds.width,suggestion:true,periodSwitch:true}));
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
