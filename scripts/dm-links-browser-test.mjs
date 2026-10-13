import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const base='/RaimuNoteSNS.github.io',fixture='/__dm_links.tsx';
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {DirectMessageContent,DirectMessageMedia,directMessageText} from '/src/components/chat/DirectMessageContent';import {DirectChatMessage} from '/src/components/chat/DirectChatMessage';import '/src/index.css';import '/src/pages/direct-messages.css';document.documentElement.classList.toggle('dark',new URLSearchParams(location.search).get('dark')==='1');createRoot(document.getElementById('root')).render(<div className="dm-workspace" data-dm-detail="true" style={{display:'block',height:'auto'}}><div className="dm-thread" style={{padding:14}}>{[false,true].map(own=><React.Fragment key={String(own)}>{['https://abema.tv/video/title/87-2101','見てね https://youtu.be/dQw4w9WgXcQ','https://youtu.be/dQw4w9WgXcQ?si=example'].map((content,i)=><DirectChatMessage key={content} userId="viewer" message={{id:String(own)+i,sender_id:own?'viewer':'peer',content,mediaUrls:[],created_at:'2026-10-13T06:04:00Z',reactions:{}}} enabled={false} onChanged={async()=>{}} onReply={()=>{}} media={<DirectMessageMedia content={content}/>} content={directMessageText(content)?<DirectMessageContent content={content}/>:null}/>)}</React.Fragment>)}</div></div>);`;
const server=await createServer({server:{host:'127.0.0.1',port:8193,strictPort:true},plugins:[{name:'dm-links-fixture',resolveId(id){if(id===fixture||id===base+fixture||id==='\0'+fixture)return '\0'+fixture;},load(id){if(id==='\0'+fixture)return source;},configureServer(s){s.middlewares.use(base+'/__dm_links',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__dm_links',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="${base}${fixture}"></script></body></html>`));});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://www.youtube.com/embed/**',route=>route.fulfill({contentType:'text/html',body:'<body style="background:#111;color:white">YouTube player fixture</body>'}));
 for(const width of [390,1280])for(const dark of [0,1]){
  await page.setViewportSize({width,height:900});await page.goto(`http://127.0.0.1:8193${base}/__dm_links?dark=${dark}`);
  await expect(page.locator('.dm-video-embed')).toHaveCount(4);
  for(const frame of await page.locator('iframe').all()){
   await expect(frame).toBeVisible();assert.equal(new URL(await frame.getAttribute('src')).searchParams.get('autoplay'),'0');const rect=await frame.boundingBox();assert.ok(rect.width>150&&rect.height>80);assert.ok(rect.x>=0&&rect.x+rect.width<=width);
  }
  await expect(page.locator('.dm-bubble .dm-video-embed')).toHaveCount(0);
  await expect(page.locator('.dm-media-time')).toHaveCount(2);
  for(const media of await page.locator('.dm-youtube-media').all()){
   const style=await media.locator('.dm-video-embed').evaluate(el=>({border:getComputedStyle(el).borderWidth,radius:getComputedStyle(el).borderRadius,padding:getComputedStyle(el).padding}));
   assert.equal(style.border,'1px');assert.equal(style.radius,'20px');assert.equal(style.padding,'0px');
  }
  const colors=await page.locator('.is-own .dm-link-card').first().evaluate(el=>[getComputedStyle(el).color,getComputedStyle(el.querySelector('.dm-link-domain')).color,getComputedStyle(el.querySelector('.dm-link-icon')).color]);assert.equal(colors[0],colors[1]);assert.equal(colors[0],colors[2]);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('.is-own .dm-message-content:has(.dm-media-time)').screenshot({path:`/private/tmp/lime-dm-video-only-${width}-${dark}.png`});
  await page.screenshot({path:`/private/tmp/lime-dm-links-${width}-${dark}.png`,fullPage:true});
 }
 assert.deepEqual(errors,[]);console.log('PASS: DM links and real YouTube iframe layout in light/dark, mobile/desktop; no overflow or autoplay');
}finally{await browser?.close();await server.close();}
