import {createServer} from 'vite';import {chromium,expect} from '@playwright/test';import assert from 'node:assert/strict';import {inspectVideo} from '../server/video/worker.mjs';
const base='/RaimuNoteSNS.github.io',fixture='/__video_fixture.tsx';
const source=`import '/src/index.css';import React from'react';import{createRoot}from'react-dom/client';import{PostVideoPlayer}from'/src/components/video/PostVideoPlayer';import{preparePostVideo}from'/src/lib/postVideo';import{Input,BlobSource,ALL_FORMATS,Output,Mp4OutputFormat,BufferTarget,CanvasSource,AudioBufferSource}from'mediabunny';window.makeVideo=async()=>{const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const context=canvas.getContext('2d');const output=new Output({format:new Mp4OutputFormat(),target:new BufferTarget()});const source=new CanvasSource(canvas,{codec:'avc',bitrate:4_000_000});output.addVideoTrack(source);const audio=new AudioBufferSource({codec:'aac',bitrate:96_000});output.addAudioTrack(audio);await output.start();const sound=new AudioBuffer({length:96000,sampleRate:48000,numberOfChannels:1});const samples=sound.getChannelData(0);for(let j=0;j<samples.length;j++)samples[j]=Math.sin(j/48000*440*Math.PI*2)*.1;await audio.add(sound);await audio.close();for(let i=0;i<60;i++){context.fillStyle='#173d83';context.fillRect(0,0,1920,1080);context.fillStyle='#fff';context.font='80px sans-serif';context.fillText('LimeNote Video '+i,160+i*5,540);await source.add(i/30,1/30);}await source.close();await output.finalize();const inputFile=new File([output.target.buffer],'source.mp4',{type:'video/mp4'});const progress=[];const prepared=await preparePostVideo(inputFile,p=>progress.push(p));const checked=new Input({source:new BlobSource(prepared.file),formats:ALL_FORMATS});window.hasAudio=!!await checked.getPrimaryAudioTrack();checked.dispose();window.prepared=prepared;window.progress=progress;window.originalSize=inputFile.size;(window.videoTestRoot??=createRoot(document.getElementById('root'))).render(<PostVideoPlayer video={prepared} previewUrl={prepared.url}/>);return {width:prepared.width,height:prepared.height,duration:prepared.duration,size:prepared.file.size,posterSize:prepared.poster?.size};};window.rejectLong=async(duration=91)=>{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const output=new Output({format:new Mp4OutputFormat(),target:new BufferTarget()});const source=new CanvasSource(canvas,{codec:'avc',bitrate:100_000});output.addVideoTrack(source);await output.start();await source.add(0,duration);await source.close();await output.finalize();try{const result=await preparePostVideo(new File([output.target.buffer],'long.mp4'),()=>{});const duration=result.duration;URL.revokeObjectURL(result.url);return duration;}catch(error){return error.message;}};
window.showRemote=()=>window.videoTestRoot.render(<PostVideoPlayer postId="first-click" video={window.prepared}/>);
window.renderMobileApp=async()=>{
 const {QueryClient,QueryClientProvider}=await import('@tanstack/react-query');const {BrowserRouter}=await import('react-router-dom');const {MediaLightboxRoot}=await import('/src/components/media/MediaLightbox');
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity,refetchOnWindowFocus:false}}});
 const post=(id,name,content)=>({id,userId:'author-'+id,content,video:window.prepared,imageUrls:[],createdAt:new Date().toISOString(),likesCount:3,commentsCount:2,repostsCount:1,likedByMe:false,repostedByMe:false,author:{id:'author-'+id,username:id,displayName:name,avatarUrl:'',bio:'',coverUrl:'',createdAt:new Date().toISOString()}});
 const first=post('first-click','投稿者A','最初の動画'),second=post('second-click','投稿者B','次の動画');window.fixtureFirstPost=first;
 client.setQueryData(['post',first.id],first);client.setQueryData(['post',second.id],second);client.setQueryData(['media-video-feed',undefined],{pages:[{posts:[first,second,first],nextCursor:null}],pageParams:[undefined]});
 window.videoTestRoot.render(<QueryClientProvider client={client}><BrowserRouter><PostVideoPlayer postId={first.id} post={first} video={first.video}/><MediaLightboxRoot/></BrowserRouter></QueryClientProvider>);
};
window.showMediaGrid=async()=>{
 const {PostVideoThumbnail}=await import('/src/components/video/PostVideoThumbnail');const profileSource=(await import('/src/pages/Profile.tsx?raw')).default;
 const className=profileSource.match(/data-lime-profile-media-grid className="([^"]+)"/)[1];
 window.videoTestRoot.render(<div data-lime-profile-media-grid className={className}>{[45,83,90].map((duration,index)=><div key={index} className="relative aspect-square overflow-hidden"><PostVideoThumbnail postId={index===1?'second-click':'first-click'} duration={duration}/></div>)}</div>);
};
window.makeComplexVideo=async()=>{
 const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const ctx=canvas.getContext('2d');
 const noise=document.createElement('canvas');noise.width=480;noise.height=270;const noiseCtx=noise.getContext('2d'),pixels=noiseCtx.createImageData(480,270),words=new Uint32Array(pixels.data.buffer);let seed=12345;
 const output=new Output({format:new Mp4OutputFormat(),target:new BufferTarget()}),source=new CanvasSource(canvas,{codec:'avc',bitrate:8_000_000});
 output.addVideoTrack(source);const audio=new AudioBufferSource({codec:'aac',bitrate:96_000});output.addAudioTrack(audio);await output.start();
 const sound=new AudioBuffer({length:48000*16,sampleRate:48000,numberOfChannels:1});const samples=sound.getChannelData(0);for(let i=0;i<samples.length;i++)samples[i]=Math.sin(i/48000*440*Math.PI*2)*.1;await audio.add(sound);await audio.close();
 for(let frame=0;frame<480;frame++){
  for(let i=0;i<words.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;words[i]=0xff000000|(seed&0xffffff);}
  noiseCtx.putImageData(pixels,0,0);ctx.imageSmoothingEnabled=false;ctx.drawImage(noise,0,0,1920,1080);await source.add(frame/30,1/30);
 }
 await source.close();await output.finalize();const file=new File([output.target.buffer],'16-second-detail.mp4',{type:'video/mp4'});
 const prepared=await preparePostVideo(file,()=>{});const result={duration:prepared.duration,width:prepared.width,height:prepared.height,size:prepared.file.size,sourceSize:file.size};URL.revokeObjectURL(prepared.url);return result;
};`;
const server=await createServer({cacheDir:'/private/tmp/lime-video-vite-cache',server:{host:'127.0.0.1',port:8197,strictPort:true},plugins:[{name:'video-fixture',resolveId(id){if(id==='@/lib/currentUser')return '\0video-fixture-user';if([fixture,base+fixture,'\0'+fixture].includes(id))return '\0'+fixture;},load(id){if(id.endsWith('/src/lib/currentUser.ts'))return "export async function getCurrentUserId(){return 'fixture-viewer'}";if(id==='\0video-fixture-user')return "export async function getCurrentUserId(){return 'fixture-viewer'}";if(id==='\0'+fixture)return source;},configureServer(s){s.middlewares.use(base+'/__video_test',async(req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__video_test',`<html><head><style>body{margin:0;background:#000}#root{max-width:840px;margin:16px auto}</style></head><body><div id="root"></div><script type="module" src="${fixture}"></script></body></html>`));});}}]});let browser;
try{await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:900,height:620},deviceScaleFactor:2,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.stack||e.message));await page.goto(`http://127.0.0.1:8197${base}/__video_test`);await page.waitForFunction(()=>window.makeVideo);const result=await page.evaluate(()=>window.makeVideo());console.log('Encoded video metadata',result);assert.equal(await page.evaluate(()=>window.hasAudio),true);assert.equal(result.width,1920);assert.equal(result.height,1080);assert.ok(result.duration<=2.25&&result.duration>=1.9);assert.ok(result.posterSize>0);const movieBytes=new Uint8Array(await page.evaluate(async()=>Array.from(new Uint8Array(await window.prepared.file.arrayBuffer()))));const actual=await inspectVideo(movieBytes);assert.equal(actual.width,1920);assert.equal(actual.height,1080);assert.match(await page.evaluate(()=>window.rejectLong()),/90秒/);const boundary=await page.evaluate(()=>window.rejectLong(90));assert.ok(typeof boundary==='number'&&boundary<=90&&boundary>89.5);await expect(page.getByRole('button',{name:'動画を再生'})).toBeVisible();await page.screenshot({path:'/private/tmp/lime-video-desktop.png'});await page.getByRole('button',{name:'動画を再生'}).click();await expect(page.getByLabel('再生位置')).toBeVisible();await page.getByRole('button',{name:'一時停止',exact:true}).click();const seekBox=await page.getByLabel('再生位置').boundingBox();assert.equal(seekBox.height,24);
await page.mouse.move(seekBox.x+seekBox.width*.25,seekBox.y+3);await page.mouse.down();await page.mouse.move(seekBox.x+seekBox.width*.65,seekBox.y+3,{steps:5});await page.mouse.up();
assert.ok(await page.locator('video').evaluate(video=>video.currentTime>1&&video.currentTime<1.8),'Seek dragging must work above the visible track');
await page.getByRole('button',{name:'再生設定'}).click();await page.getByLabel('再生速度').selectOption('1.5');assert.equal(await page.locator('video').evaluate(n=>n.playbackRate),1.5);await page.getByRole('button',{name:'音声をオン'}).click();assert.equal(await page.locator('video').evaluate(n=>n.muted),false);await page.screenshot({path:'/private/tmp/lime-video-controls.png'});await page.getByRole('button',{name:'音声をオフ'}).click();const iconBounds=await page.locator('.post-video-toolbar').boundingBox();await page.screenshot({path:'/private/tmp/lime-video-icons.png',clip:{x:iconBounds.x+iconBounds.width-152,y:iconBounds.y,width:152,height:iconBounds.height}});await page.setViewportSize({width:390,height:740});await expect(page.getByLabel('再生位置')).toHaveCount(0);await expect(page.getByRole('button',{name:'動画を再生'})).toBeVisible();await page.screenshot({path:'/private/tmp/lime-video-mobile.png'});await page.setViewportSize({width:900,height:620});let accessRequests=0;await page.route('**/access/first-click',async route=>{accessRequests++;await new Promise(resolve=>setTimeout(resolve,150));await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({public:true})});});await page.route('**/media/first-click',route=>route.fulfill({status:200,contentType:'video/mp4',headers:{'Access-Control-Allow-Origin':'*'},body:Buffer.from(movieBytes)}));await page.evaluate(()=>window.showRemote());await page.getByRole('button',{name:'動画を再生'}).click();await page.waitForFunction(()=>{const video=document.querySelector('video');return video&&!video.paused&&video.currentTime>0;});assert.equal(accessRequests,1);
await page.locator('video').evaluate(video=>{video.playbackRate=.25;video.currentTime=0;});
await page.mouse.move(895,610);
await expect(page.getByLabel('再生位置')).toBeHidden();
await expect(page.locator('.post-video-duration')).toBeVisible();assert.equal(await page.locator('.post-video-duration').evaluate(node=>getComputedStyle(node).fontSize),'14px');
await expect(page.locator('.post-video-mute')).toBeVisible();
const compactSizes=async()=>page.locator('.post-video-player').evaluate(node=>({duration:node.querySelector('.post-video-duration').getBoundingClientRect().height,sound:node.querySelector('.post-video-mute').getBoundingClientRect().height}));
assert.deepEqual(await compactSizes(),{duration:28,sound:28});

await page.setViewportSize({width:900,height:620});
assert.deepEqual(await compactSizes(),{duration:28,sound:28});assert.equal(await page.locator('.post-video-duration').evaluate(node=>getComputedStyle(node).fontSize),'14px');
await page.screenshot({path:'/private/tmp/lime-video-compact.png'});
const frame=await page.locator('.post-video-player').evaluate(node=>{const css=getComputedStyle(node);return {radius:css.borderRadius,border:css.borderTopWidth,font:css.fontFamily,shadow:css.boxShadow};});
assert.equal(frame.radius,'16px');assert.equal(frame.border,'1px');assert.equal(frame.shadow,'none');assert.match(frame.font,/system-ui/);
const frameChecks=await page.locator('.post-video-player').evaluate(node=>{
 const sample=document.createElement('div');sample.className='rounded-2xl border border-border/60';document.body.append(sample);
 const matches=[];for(const dark of [false,true]){document.documentElement.classList.toggle('dark',dark);const video=getComputedStyle(node),image=getComputedStyle(sample);matches.push(video.borderColor===image.borderColor&&video.borderRadius===image.borderRadius);}
 document.documentElement.classList.remove('dark');sample.remove();
 const media=node.querySelector('video'),ratio=media.style.aspectRatio;media.style.aspectRatio='9 / 16';const rect=media.getBoundingClientRect(),css=getComputedStyle(node);media.style.aspectRatio=ratio;
 return {matches,portraitRatio:rect.width/rect.height,maxHeight:css.maxHeight,transition:getComputedStyle(node.querySelector('.post-video-controls')).transitionDuration};
});
const edgeChecks=await page.locator('.post-video-player').evaluate(node=>{
 const media=node.querySelector('video'),originalRatio=media.style.aspectRatio,originalWidth=node.style.width;
 const checks=[];for(const width of ['333.333px','100%'])for(const ratio of ['16 / 9','9 / 16','1 / 1']){
  node.style.width=width;media.style.aspectRatio=ratio;
  const outer=node.getBoundingClientRect(),inner=media.getBoundingClientRect(),css=getComputedStyle(node);
  checks.push(Math.abs(inner.left-outer.left-parseFloat(css.borderLeftWidth))<.05&&Math.abs(outer.right-inner.right-parseFloat(css.borderRightWidth))<.05&&Math.abs(outer.bottom-inner.bottom-parseFloat(css.borderBottomWidth))<.05);
 }
 node.style.width=originalWidth;media.style.aspectRatio=originalRatio;return checks;
});
assert.ok(edgeChecks.every(Boolean),'Video must fill the media frame without inner gutters at every aspect ratio');
assert.deepEqual(frameChecks.matches,[true,true]);assert.ok(Math.abs(frameChecks.portraitRatio-9/16)<.001);assert.equal(frameChecks.maxHeight,'none');assert.match(frameChecks.transition,/0.18s/);

const playerBounds=await page.locator('.post-video-player').boundingBox();
await page.mouse.move(playerBounds.x+playerBounds.width/2,playerBounds.y+playerBounds.height/2);
await expect(page.getByLabel('再生位置')).toBeVisible();
const buttonStyle=await page.getByRole('button',{name:'一時停止'}).evaluate(node=>{const css=getComputedStyle(node);return {shadow:css.boxShadow,filter:css.filter,width:node.querySelector('svg').getBoundingClientRect().width};});
assert.equal(await page.locator('.post-video-toolbar button').first().evaluate(node=>node.getBoundingClientRect().height),32);assert.equal(buttonStyle.shadow,'none');assert.equal(buttonStyle.filter,'none');assert.equal(buttonStyle.width,20);assert.equal((await page.locator('.post-video-controls').boundingBox()).height,82);
await page.getByRole('button',{name:'一時停止'}).click();await page.setViewportSize({width:900,height:620});await page.screenshot({path:'/private/tmp/lime-video-1080-controls.png'});
await page.route('**/access/second-click',async route=>{await new Promise(resolve=>setTimeout(resolve,600));await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({public:true})});});
await page.route('**/media/second-click',route=>route.fulfill({status:200,contentType:'video/mp4',headers:{'Access-Control-Allow-Origin':'*'},body:Buffer.from(movieBytes)}));
const posterBytes=await page.evaluate(async()=>Array.from(new Uint8Array(await window.prepared.poster.arrayBuffer())));
await page.route('**/poster/*',route=>route.fulfill({status:200,contentType:'image/jpeg',headers:{'Access-Control-Allow-Origin':'*'},body:Buffer.from(posterBytes)}));
await page.route('**/rest/v1/**',route=>route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:'[]'}));await page.setViewportSize({width:390,height:740});await page.evaluate(()=>window.renderMobileApp());
await expect(page.locator('.post-video-player .post-video-start')).toBeVisible();await expect(page.locator('.post-video-player .post-video-duration')).toHaveCount(0);
await page.locator('.post-video-player .post-video-start').tap();
const dialog=page.getByRole('dialog',{name:'動画を拡大表示'});await expect(dialog).toBeVisible();
await page.waitForFunction(()=>{const video=document.querySelector('.lime-video-frame video');return video&&!video.paused&&video.currentTime>0;});
await expect(dialog.getByText('投稿者A',{exact:true})).toBeVisible();await expect(dialog.locator('[data-lime-post-actions]')).toBeVisible();
const stageRect=await dialog.locator('.lime-media-stage').boundingBox();assert.equal(stageRect.y,0);assert.equal(stageRect.height,740);
const footerBackground=await dialog.locator('.lime-media-bottom').evaluate(node=>({color:getComputedStyle(node).backgroundColor,image:getComputedStyle(node).backgroundImage}));assert.equal(footerBackground.color,'rgba(0, 0, 0, 0)');assert.match(footerBackground.image,/linear-gradient/);
const actionStyle=()=>page.locator('.lime-media-bottom .lime-media-actions [data-lime-post-actions]').evaluate(node=>{const button=node.firstElementChild,css=getComputedStyle(button);return {background:css.backgroundColor,blur:css.backdropFilter,radius:css.borderRadius};});const videoActionStyle=await actionStyle();await page.screenshot({path:'/private/tmp/lime-video-mobile-viewer.png'});
const cdp=await page.context().newCDPSession(page);
const swipe=async(dx,dy)=>{const x=190,y=240;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx,y:y+dy,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};
await page.evaluate(()=>{window.previousVideo=document.querySelector('.lime-video-frame video');});
await swipe(5,110);await expect(dialog.getByText('投稿者B',{exact:true})).toBeVisible();
const spinner=dialog.getByRole('status',{name:'動画を読み込み中'});await expect(spinner).toBeVisible();const spinnerBefore=await spinner.boundingBox();await page.waitForTimeout(200);const spinnerAfter=await spinner.boundingBox();assert.ok(Math.abs(spinnerBefore.x-spinnerAfter.x)<1&&Math.abs(spinnerBefore.y-spinnerAfter.y)<1,'Loading indicator must stay centered while spinning');
await page.waitForFunction(()=>{const video=document.querySelector('.lime-video-frame video');return video&&!video.paused&&video.currentTime>0;});
assert.equal(await page.evaluate(()=>window.previousVideo.paused&&window.previousVideo.getAttribute('src')===null),true);
assert.equal(await page.evaluate(()=>[...document.querySelectorAll('video')].filter(video=>!video.paused).length),1);
await swipe(110,5);await expect(dialog.getByText('投稿者B',{exact:true})).toBeVisible();
await page.waitForTimeout(400);
await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:150,y:300,id:1},{x:230,y:300,id:2}]});
await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:80,y:300,id:1},{x:300,y:300,id:2}]});
await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
await expect(dialog).toHaveClass(/lime-media-zoomed/);await expect(dialog.getByText('投稿者B',{exact:true})).toBeVisible();
const zoomTransform=await dialog.locator('.lime-video-frame video').evaluate(node=>getComputedStyle(node).transform);assert.notEqual(zoomTransform,'matrix(1, 0, 0, 1, 0, 0)');
await swipe(0,110);await expect(dialog.getByText('投稿者B',{exact:true})).toBeVisible();
await page.screenshot({path:'/private/tmp/lime-video-mobile-zoom.png'});
await dialog.locator('.lime-media-stage').dblclick({position:{x:195,y:300}});await expect(dialog).not.toHaveClass(/lime-media-zoomed/);
await swipe(0,-110);await expect(dialog.getByText('投稿者A',{exact:true})).toBeVisible();
await dialog.getByRole('button',{name:'動画を閉じる'}).click();await expect(dialog).toHaveCount(0);assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
await page.evaluate(async()=>{const {openMediaViewer}=await import('/RaimuNoteSNS.github.io/src/components/media/openMediaViewer.ts');const url=URL.createObjectURL(window.prepared.poster);openMediaViewer({url,post:window.fixtureFirstPost});});
const imageDialog=page.getByRole('dialog',{name:'メディアを拡大表示'});await expect(imageDialog).toBeVisible();assert.deepEqual(await actionStyle(),videoActionStyle,'Image and video actions must use the same background and blur');await imageDialog.getByRole('button',{name:'画像を閉じる'}).click();await expect(imageDialog).toHaveCount(0);
await page.setViewportSize({width:900,height:620});await page.evaluate(()=>window.showMediaGrid());
await expect(page.getByText('0:45',{exact:true})).toBeVisible();await expect(page.getByText('1:23',{exact:true})).toBeVisible();
const grid=page.locator('[data-lime-profile-media-grid]');assert.equal(await grid.locator('svg').count(),0);assert.equal(await grid.evaluate(node=>getComputedStyle(node).paddingLeft),'16px');assert.equal(await grid.evaluate(node=>getComputedStyle(node).paddingRight),'16px');
await expect(grid.locator('img')).toHaveCount(3);await page.screenshot({path:'/private/tmp/lime-profile-media-desktop.png'});
await page.setViewportSize({width:390,height:740});assert.equal(await grid.evaluate(node=>getComputedStyle(node).paddingLeft),'0px');await page.screenshot({path:'/private/tmp/lime-profile-media-mobile.png'});
console.log('PASS: shared mobile viewer, downward next/upward previous, deduplication, one active video, fixed loading indicator, pinch/pan, and transparent overlay footer');
if(!process.env.LIME_VIDEO_UI_ONLY){const complex=await page.evaluate(()=>window.makeComplexVideo());console.log('16-second detailed video',complex);assert.ok(complex.width<=1920);assert.ok(complex.height<=1080);assert.ok(complex.duration>=15.9&&complex.duration<16.3);assert.ok(complex.size<36*1024*1024);assert.ok(complex.size<complex.sourceSize*.65);}assert.deepEqual(errors,[]);console.log('PASS: actual 1080p H.264 conversion, one-click delayed remote playback, JPEG poster, server metadata validation, 91-second rejection, desktop/mobile controls');}finally{await browser?.close();await server.close();}
