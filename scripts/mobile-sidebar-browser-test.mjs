import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const base='/RaimuNoteSNS.github.io',fixture='/__sidebar_test.tsx';
const source=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import {useMobileDrawerMotion,useMobileFeedTabSwipe} from '/src/components/layout/Header';import '/src/index.css';function Harness(){const [open,setOpen]=useState(false);const [tab,setTab]=useState('all');useMobileDrawerMotion(open,setOpen,true,true);useMobileFeedTabSwipe(true,open,tab,setTab,[{value:'all'},{value:'following'}]);return <main id="surface" style={{height:'100vh'}}><output id="state">{open?'open':'closed'}</output><output id="tab">{tab}</output><aside data-lime-mobile-sidebar="true">sidebar</aside></main>};createRoot(document.getElementById('root')).render(<MemoryRouter><Harness/></MemoryRouter>);`;
const server=await createServer({server:{host:'127.0.0.1',port:8195,strictPort:true},plugins:[{name:'sidebar-test',transform(code,id){if(id.includes('/src/components/layout/Header.tsx'))return code+'\nexport {useMobileDrawerMotion,useMobileFeedTabSwipe};';},resolveId(id){if(id===fixture||id===base+fixture||id==='\0'+fixture)return '\0'+fixture;},load(id){if(id==='\0'+fixture)return source;},configureServer(s){s.middlewares.use(base+'/__sidebar_test',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__sidebar_test',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="${base}${fixture}"></script></body></html>`));});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:8195${base}/__sidebar_test`);await expect(page.locator('#state')).toHaveText('closed');
 const touch=async(type,x,y,count=1)=>page.evaluate(({type,x,y,count})=>{const target=document.getElementById('surface');const points=Array.from({length:count},(_,i)=>new Touch({identifier:i,target,clientX:x+i*10,clientY:y}));target.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'||type==='touchcancel'?[]:points,changedTouches:points}));},{type,x,y,count});
 const swipe=async(x,y,dx,dy)=>{await touch('touchstart',x,y);await touch('touchmove',x+dx/2,y+dy/2);await touch('touchmove',x+dx,y+dy);await touch('touchend',x+dx,y+dy);};
 for(const [x,y,dx,dy] of [[160,100,100,0],[20,100,8,100],[20,100,70,65],[20,100,25,1]]){await swipe(x,y,dx,dy);await expect(page.locator('#state')).toHaveText('closed');}
 // A slight vertical wobble before a deliberate edge drag must not cancel opening.
 await touch('touchstart',34,100);await touch('touchmove',36,106);await touch('touchmove',70,107);await touch('touchmove',124,108);await touch('touchend',124,108);await expect(page.locator('#state')).toHaveText('open');await expect(page.locator('#tab')).toHaveText('all');
 await swipe(220,100,-90,3);await expect(page.locator('#state')).toHaveText('closed');
 await touch('touchstart',20,100);await touch('touchmove',90,100,2);await touch('touchend',100,100);await expect(page.locator('#state')).toHaveText('closed');
 for(const attributes of [{'data-lime-maps':''},{class:'lime-map-dialog'},{class:'lime-media-lightbox'}]){
  await page.evaluate(attrs=>{const el=document.createElement('div');el.id='blocker';for(const [key,value]of Object.entries(attrs))el.setAttribute(key,value);el.style.cssText='position:fixed;inset:0';document.body.append(el);},attributes);
  await swipe(20,100,120,0);await expect(page.locator('#state')).toHaveText('closed');await page.locator('#blocker').evaluate(el=>el.remove());
 }
 await swipe(72,100,68,4);await expect(page.locator('#state')).toHaveText('open');
 await swipe(220,100,-90,3);await expect(page.locator('#state')).toHaveText('closed');
 await swipe(150,100,135,5);await expect(page.locator('#state')).toHaveText('open');
 assert.deepEqual(errors,[]);console.log('PASS: edge opening, initial wobble, closing; no body/vertical/diagonal/short/multitouch opening; Maps and media viewer block drawer');
}finally{await browser?.close();await server.close();}
