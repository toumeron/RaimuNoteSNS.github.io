import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const base='/RaimuNoteSNS.github.io';
const post={id:'x:2110000000000000001',source:'x',userId:'x-user:123',content:'引用した投稿',imageUrls:[],createdAt:'2026-10-16',likesCount:12,commentsCount:12,repostsCount:0,repostedByMe:false,author:{id:'x-user:123',username:'artist@twitter.com',displayName:'作者',avatarUrl:''},isQuote:true};
post.parentPost={...post,id:'x:2110000000000000002',content:'引用元の本文',isQuote:false,externalVideo:{playlist:'https://video.example.test/clip.mp4',format:'mp4',thumbnail:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280"><path fill="#467b91" d="M0 0h720v1280H0z"/><path fill="#edbc70" d="M0 0h720v160H0zM0 1120h720v160H0z"/><text x="190" y="650" fill="white" font-size="60" font-family="sans-serif">PORTRAIT</text></svg>'),duration:27,width:360,height:640}};
const reply={...post,id:'x:2110000000000000003',content:'@artist @another 返信本文 @intentional',isQuote:false,parentPost:undefined,externalReplyToId:post.id,externalReplyToUsername:'artist@twitter.com'};
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import '/src/index.css';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {MemoryRouter} from 'react-router-dom';import {PostCard} from '/src/components/feed/PostCard';import {ReplyChain} from '/src/components/post/ReplyChain';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><ReplyChain><PostCard thread post={${JSON.stringify(post)}}/><PostCard thread post={${JSON.stringify(reply)}}/></ReplyChain></MemoryRouter></QueryClientProvider>);`;
const server=await createServer({cacheDir:'/private/tmp/lime-quote-layout-cache',server:{host:'127.0.0.1',port:8204,strictPort:true},plugins:[{name:'quote-layout',resolveId(id){if(id.endsWith('/__quote_layout.tsx'))return '\0/__quote_layout.tsx';},load(id){if(id==='\0/__quote_layout.tsx')return source;if(id.endsWith('/src/lib/currentUser.ts'))return 'export async function getCurrentUserId(){return null;}';},configureServer(s){s.middlewares.use(base+'/__quote_layout',async(_,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__quote_layout',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root" style="max-width:1100px;margin:auto"></div><script type="module" src="${base}/__quote_layout.tsx"></script></body></html>`));});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});
 const generator=await browser.newPage();
 await generator.goto('http://127.0.0.1:8204'+base+'/');
 const clip=Buffer.from(await generator.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=360;canvas.height=640;
  const context=canvas.getContext('2d');context.fillStyle='#467b91';context.fillRect(0,0,720,1280);
  context.fillStyle='#edbc70';context.fillRect(0,0,720,160);context.fillRect(0,1120,720,160);
  context.fillStyle='white';context.font='60px sans-serif';context.fillText('PORTRAIT',190,650);
  const redraw=setInterval(()=>{context.fillStyle='#467b91';context.fillRect(0,700,720,10);},80);
  context.scale(.5,.5);context.fillStyle='#467b91';context.fillRect(0,0,720,1280);context.fillStyle='#edbc70';context.fillRect(0,0,720,160);context.fillRect(0,1120,720,160);context.fillStyle='white';context.fillText('PORTRAIT',190,650);
  const stream=canvas.captureStream(10),recorder=new MediaRecorder(stream,{mimeType:'video/webm'}),chunks=[];
  const finished=new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=async()=>resolve(Array.from(new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer())));});
  recorder.start();await new Promise(resolve=>setTimeout(resolve,1500));recorder.stop();clearInterval(redraw);const result=await finished;stream.getTracks().forEach(track=>track.stop());return result;
 }));await generator.close();
 for(const width of [1400,1000,390]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/rest/v1/**',r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await page.route('**/functions/v1/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
  await page.route('https://video.example.test/**',r=>r.fulfill({contentType:'video/webm',headers:{'access-control-allow-origin':'*'},body:clip}));
  await page.addInitScript(()=>{window.quoteOverlayOpened=false;window.addEventListener('lime-open-media-viewer',()=>window.quoteOverlayOpened=true);});
  await page.goto('http://127.0.0.1:8204'+base+'/__quote_layout');
  const quote=page.locator('[data-lime-quoted-post]'),frame=quote.locator('.post-video-player');await expect(frame).toBeVisible();await expect(frame.locator('img')).toHaveCSS('object-fit','cover');
  const quoteBox=await quote.boundingBox(),videoBox=await frame.boundingBox();
  assert.ok(videoBox.width>=quoteBox.width-4&&videoBox.width<=quoteBox.width,JSON.stringify({quoteBox,videoBox}));


  assert.ok(Math.abs(videoBox.height/videoBox.width-9/16)<.01);
  await expect(quote.locator('[data-lime-thread-avatar]')).toHaveCount(0);
  await expect(quote.locator('[data-lime-thread-item]')).toHaveCount(0);
  const lines=page.locator('[data-lime-reply-chain] > [data-lime-thread-lines] > line');await expect(lines).toHaveCount(1);
  const line=await lines.boundingBox();assert.ok(line.x<quoteBox.x,JSON.stringify({line,quoteBox}));
  const text=page.locator('[data-lime-comment-card] [data-lime-post-body] p').filter({hasText:'返信本文'});
  await expect(text).toHaveText('返信本文 @intentional');
  await expect(page.getByText('返信先:',{exact:false}).first()).toContainText('@artist');
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`/private/tmp/lime-twitter-quote-${width}.png`});
  await frame.getByRole('button',{name:'動画を再生',exact:true}).click();
  const media=frame.locator('video');
  await media.evaluate(video=>{video.loop=true;});
  await expect.poll(()=>media.evaluate(video=>!video.paused&&video.currentTime>0&&video.videoHeight>video.videoWidth)).toBe(true);
  await expect(media).toHaveCSS('object-fit','contain');await expect(frame).toHaveCSS('background-color','rgb(0, 0, 0)');
  const playingBox=await frame.boundingBox();assert.equal(playingBox.width,videoBox.width);assert.equal(playingBox.height,videoBox.height);
  assert.equal(await page.evaluate(()=>window.quoteOverlayOpened),false);
  await page.mouse.move(0,0);await expect(frame.locator('.post-video-controls')).toHaveCSS('opacity','0');await page.screenshot({path:`/private/tmp/lime-twitter-quote-playing-${width}.png`});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,quotedVideoWidth:videoBox.width,quotedVideoHeight:videoBox.height,inlinePlayback:true,playingFit:'contain',unchangedFrame:true,connectionLines:1,recipientsHidden:true}));
  await page.close();
 }
}finally{await browser?.close();await server.close();}
