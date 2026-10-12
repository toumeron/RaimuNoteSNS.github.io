import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='/RaimuNoteSNS.github.io',fixture='/__suspension_fixture.tsx';
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import {AccountSuspensionFeedback,SuspensionNotice} from '/src/components/account/AccountSuspension';import {notifySuspendedAction} from '/src/lib/accountSuspension';import {ListArt} from '/src/components/lists/ListDialogs';import SearchPage from '/src/pages/SearchPage';import '/src/index.css';const mode=new URLSearchParams(location.search).get('mode');document.documentElement.classList.add('dark');createRoot(document.getElementById('root')).render(<MemoryRouter><div style={{maxWidth:640,margin:'auto'}}><AccountSuspensionFeedback/>{mode==='search'?<SearchPage/>:<SuspensionNotice profile={mode==='profile'}/> }<button onClick={()=>notifySuspendedAction()}>操作を試す</button><ListArt/></div></MemoryRouter>);`;
const server=await createServer({server:{host:'127.0.0.1',port:8190,strictPort:true},plugins:[{name:'suspension-fixture',resolveId(id){if(id===fixture||id===base+fixture||id==='\0'+fixture)return '\0'+fixture;},load(id){if(id==='\0'+fixture)return source;},configureServer(s){s.middlewares.use(base+'/__suspension',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__suspension',`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="${base}${fixture}"></script></body></html>`));});}}]});
await server.listen();let browser;
try{
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/src/hooks/useAuth.tsx*',route=>route.fulfill({contentType:'application/javascript',body:'export const useAuth=()=>({user:{id:"fixture",isSuspended:true}});'}));
 await mkdir('/private/tmp/lime-suspension-preview',{recursive:true});
 for(const width of [390,1280]){
  await page.setViewportSize({width,height:850});await page.goto(`http://127.0.0.1:8190${base}/__suspension`);
  await expect(page.getByRole('heading',{name:'ご利用のアカウントは停止されています'})).toBeVisible();
  await page.getByRole('button',{name:'操作を試す'}).click();await expect(page.getByRole('alert')).toBeVisible();
  const box=await page.getByRole('alert').boundingBox();assert(box.x>=0&&box.x+box.width<=width);
  await page.screenshot({path:`/private/tmp/lime-suspension-preview/notice-${width}.png`});
  await expect(page.getByRole('button',{name:'詳細はこちら'})).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const colors=await page.getByRole('alert').evaluate(element=>({actual:getComputedStyle(element).backgroundColor,theme:getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()}));
  const themeColor=await page.evaluate(theme=>{const element=document.createElement('span');element.style.backgroundColor=`hsl(${theme})`;document.body.append(element);const color=getComputedStyle(element).backgroundColor;element.remove();return color;},colors.theme);
  assert.equal(colors.actual,themeColor);
  await page.goto(`http://127.0.0.1:8190${base}/__suspension?mode=profile`);await expect(page.getByRole('heading',{name:'アカウントは停止されています'})).toBeVisible();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`/private/tmp/lime-suspension-preview/profile-${width}.png`});
  await page.goto(`http://127.0.0.1:8190${base}/__suspension?mode=search`);
  await expect(page.getByRole('heading',{name:'検索は利用できません'})).toBeVisible();
  await expect(page.getByPlaceholder('検索',{exact:true})).toHaveCount(0);
 }
 assert.deepEqual(errors,[]);console.log('PASS: mobile/desktop frozen-account notices, themed action feedback without a details overlay, themed star cover and no horizontal overflow');
}finally{await browser?.close();await server.close();}
