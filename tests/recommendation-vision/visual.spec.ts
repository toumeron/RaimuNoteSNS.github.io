import {test,expect} from '@playwright/test';
import {readFileSync,existsSync,createReadStream,statSync} from 'node:fs';
import {createServer,type Server} from 'node:http';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const images=JSON.parse(readFileSync(new URL('./images.json',import.meta.url),'utf8')) as {name:string;url:string;kind:string}[];
let transport:Server|undefined,transportUrl='';
test.beforeAll(async()=>{
 const directory=process.env.LIME_CLIP_CACHE;if(!directory)return;
 transport=createServer((request,response)=>{
  const suffix=decodeURIComponent((request.url??'/').slice(1));const file=path.resolve(directory,suffix);
  if(!file.startsWith(path.resolve(directory)+path.sep)||!existsSync(file)){response.writeHead(404);response.end();return;}
  response.writeHead(200,{'access-control-allow-origin':'*','content-type':suffix.endsWith('.json')?'application/json':'application/octet-stream','content-length':statSync(file).size});createReadStream(file).pipe(response);
 });
 await new Promise<void>(resolve=>transport!.listen(0,'127.0.0.1',resolve));const address=transport.address();if(address&&typeof address==='object')transportUrl=`http://127.0.0.1:${address.port}/`;
});
test.afterAll(async()=>{if(transport)await new Promise<void>(resolve=>transport!.close(()=>resolve()));});
test('real image pixels classify without captions, reuse cache on reload and never call a LimeNote inference server',async({page,browser},info)=>{
 // Reuse the byte-identical pinned model downloaded during evaluation. This
 // only replaces model transport, never model inference or image pixels.
 const directory=process.env.LIME_CLIP_CACHE;
 if(directory)await page.route('https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/**',async route=>{
  const url=new URL(route.request().url());const suffix=url.pathname.split('/resolve/')[1].split('/').slice(1).join('/');
  const file=path.join(directory,suffix);
  if(!existsSync(file))return route.continue();
  if(info.project.name==='WebKit-iPhone')return route.fulfill({path:file,headers:{'access-control-allow-origin':'*'}});
  return route.fulfill({status:307,headers:{'location':transportUrl+suffix,'access-control-allow-origin':'*'},body:''});
 });
 const blobs:string[]=[],analysisUploads:string[]=[];
 page.on('request',request=>{if(request.url().includes('com.atproto.sync.getBlob'))blobs.push(request.url());if(request.url().includes('/functions/v1/')&&request.method()==='POST')analysisUploads.push(request.url());});
 // Keep unrelated page APIs from writing or loading feeds during the test.
 await page.route('**/*.supabase.co/**',route=>route.fulfill({contentType:'application/json',body:'[]'}));
 await page.goto('terms');
 const result=await page.evaluate(async images=>{
  localStorage.removeItem('lime_recommendation_visual_cache_v1');
  const api=await import('/RaimuNoteSNS.github.io/src/lib/recommendationVisualInference.ts');
  const {recommendationIsEligible}=await import('/RaimuNoteSNS.github.io/src/lib/recommendationEligibility.ts');
  const rows=images.map(row=>({id:row.name,userId:row.name,content:'',imageAltTexts:[],imageUrls:[row.url],languages:['ja'],recommendationTopics:['digital-illustration'],author:{id:row.name,username:row.name}}));
  const start=performance.now();const enriched=await api.enrichRecommendationVisuals(rows,['digital-illustration','pets','sports','games']);
  return {ms:performance.now()-start,rows:enriched.map(row=>({name:row.id,status:row.recommendationVisualStatus,kind:row.recommendationVisual?.kind,digital:recommendationIsEligible(row,['digital-illustration'])}))};
 },images);
 console.log(`${info.project.name}: real image inference ${Math.round(result.ms)} ms`);
 for(const [index,row] of result.rows.entries()){
  expect(row.status).toBe('checked');
  if(images[index].kind==='not-moe')expect(row.kind).not.toBe('moe');else expect(row.kind).toBe(images[index].kind);
  expect(row.digital).toBe(index===0);
 }
 expect(blobs.length).toBeGreaterThanOrEqual(2);expect(analysisUploads).toEqual([]);
 if(info.project.name==='Chrome'){
  const cdp=await browser.newBrowserCDPSession();
  const rss=async()=>{const processes=await cdp.send('SystemInfo.getProcessInfo');const ids=processes.processInfo.filter(row=>row.type==='renderer').map(row=>row.id);return ids.length?execFileSync('ps',['-o','rss=','-p',ids.join(',')],{encoding:'utf8'}).trim().split(/\s+/).reduce((sum,value)=>sum+Number(value),0)/1024:0;};
  const active=await rss();
  await page.evaluate(async()=>{const api=await import('/RaimuNoteSNS.github.io/src/lib/recommendationVisualInference.ts');api.releaseRecommendationVisualWorker();});
  await page.waitForTimeout(1500);const released=await rss();
  console.log(`Chrome renderer RSS: active ${Math.round(active)} MiB, after worker release ${Math.round(released)} MiB`);
  expect(released).toBeLessThan(active);expect(released).toBeLessThan(700);
  await cdp.detach();
 }

 await page.reload();const requests=blobs.length;
 const cached=await page.evaluate(async images=>{
  const api=await import('/RaimuNoteSNS.github.io/src/lib/recommendationVisualInference.ts');const start=performance.now();
  const rows=await api.enrichRecommendationVisuals(images.map(row=>({id:row.name,userId:row.name,content:'猫 ゲーム スポーツ イラスト',imageUrls:[row.url]})),['digital-illustration']);
  return {ms:performance.now()-start,kinds:rows.map(row=>row.recommendationVisual?.kind)};
 },images);
 expect(cached.kinds).toEqual(result.rows.map(row=>row.kind));expect(cached.ms).toBeLessThan(1000);expect(blobs.length).toBe(requests);
});
