import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {createReadStream,existsSync,statSync} from 'node:fs';
import assert from 'node:assert/strict';
const base='/RaimuNoteSNS.github.io',port=8207,root='/private/tmp/lime-gemma-model';
const source=`import * as api from '/src/lib/localGemma';window.gemma=api;window.gemmaReady=true;`;
const server=await createServer({cacheDir:'/private/tmp/lime-gemma-inference-cache',server:{host:'127.0.0.1',port,strictPort:true},plugins:[{name:'real-gemma-fixture',configureServer(s){s.middlewares.use(async(req,res,next)=>{
 if(req.url?.startsWith(base+'/__gemma_file/')){
  const name=decodeURIComponent(req.url.slice((base+'/__gemma_file/').length));
  if(name.includes('..')){res.statusCode=400;res.end();return;}
  let file=root+'/'+name;
  if(name==='onnx/model_q4.onnx_data'&&existsSync(root+'/onnx/model_q4.complete'))file=root+'/onnx/model_q4.complete';
  if(!existsSync(file)){res.statusCode=404;res.end();return;}
  res.setHeader('Content-Length',statSync(file).size);res.setHeader('Content-Type',name.endsWith('.mjs')?'application/javascript':name.endsWith('.wasm')?'application/wasm':name.endsWith('.json')?'application/json':'application/octet-stream');
  createReadStream(file).pipe(res);return;
 }
 if(req.url===base+'/__gemma_inference'){
  res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__gemma_inference',`<html><head></head><body><p>Local Gemma inference fixture</p><script type="module">${source}</script></body></html>`));return;
 }
 next();
 });}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),errors=[],outbound=[],resources=[],logs=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{const url=new URL(request.url());if(url.protocol.startsWith('http')&&url.hostname!=='127.0.0.1')outbound.push(request.url());if(url.pathname.includes('/__gemma_file/'))resources.push(request.url());});
 page.on('console',message=>logs.push(message.text()));
 await page.addInitScript(base=>{
  const native=window.fetch.bind(window);
  window.fetch=(input,init)=>{
   const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
   const model='https://huggingface.co/onnx-community/gemma-3-270m-it-ONNX/resolve/2dbbfdb1b59bd034eb959428c6a7da9dd7ea27f0/';
   const runtime='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';
   if(url.startsWith(model))return native(base+'/__gemma_file/'+url.slice(model.length),init);
   if(url.startsWith(runtime))return native(base+'/__gemma_file/runtime/'+url.slice(runtime.length),init);
   return native(input,init);
  };
 },base);
 await page.goto(`http://127.0.0.1:${port}${base}/__gemma_inference`);await page.waitForFunction(()=>window.gemmaReady);
 try{await page.evaluate(()=>window.gemma.downloadLocalGemma());}catch(error){console.log(JSON.stringify(await page.evaluate(async()=>({state:window.gemma.getLocalGemmaState(),storage:await navigator.storage.estimate(),keys:await (await caches.open('lime-gemma-270m-v1')).keys().then(rows=>rows.map(row=>row.url))}))));throw error;}

 const state=await page.evaluate(()=>window.gemma.getLocalGemmaState());assert.equal(state.downloaded,true);assert.equal(resources.length,9);
 console.log(JSON.stringify({downloaded:true,resourceCount:resources.length}));
 await page.reload();await page.waitForFunction(()=>window.gemmaReady);const before=resources.length;
 await page.evaluate(()=>window.gemma.checkLocalGemmaDownload());try{await page.evaluate(()=>window.gemma.loadLocalGemma());}catch(error){console.log(JSON.stringify({lastLogs:logs.slice(-12)}));throw error;}
 assert.equal(resources.length,before);console.log(JSON.stringify({loadedFromCache:true,modelResourceRequestsAfterReload:0}));
 await page.context().setOffline(true);
 const started=Date.now();
 const result=await page.evaluate(async()=>{
  const chunks=[];const text=await window.gemma.generateLocalGemma([{role:'user',content:'こんにちは。短く挨拶してください。'}],'日本語で短く答えてください。',new AbortController().signal,text=>chunks.push(text),12);
  return {text,chunks:chunks.length};
 });
 assert.ok(result.text.trim());assert.ok(result.chunks>0);assert.equal(resources.length,before);assert.deepEqual(outbound,[]);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({realGemmaWasmInference:true,offline:true,generatedCharacters:result.text.length,streamUpdates:result.chunks,inferenceMs:Date.now()-started,outboundRequests:0,text:result.text}));
 const followup=await page.evaluate(async previous=>window.gemma.generateLocalGemma([{role:'user',content:'こんにちは。短く挨拶してください。'},{role:'assistant',content:previous},{role:'user',content:'ありがとう。'}],'日本語で短く答えてください。',new AbortController().signal,()=>{},8),result.text);
 assert.ok(followup.trim());assert.deepEqual(outbound,[]);assert.deepEqual(errors,[]);console.log(JSON.stringify({secondTurnOffline:true,generatedCharacters:followup.length,outboundRequests:0}));
 const retry=await page.evaluate(async()=>window.gemma.generateLocalGemma([{role:'user',content:'こんにちは。'},{role:'assistant',content:''},{role:'user',content:'短く挨拶してください。'}],'日本語で短く答えてください。',new AbortController().signal,()=>{},8));
 assert.ok(retry.trim());assert.deepEqual(outbound,[]);assert.deepEqual(errors,[]);console.log(JSON.stringify({consecutiveUserRetryOffline:true,generatedCharacters:retry.length,outboundRequests:0}));
 await page.evaluate(()=>window.gemma.deleteLocalGemma());assert.equal(await page.evaluate(()=>window.gemma.getLocalGemmaState().downloaded),false);
 console.log(JSON.stringify({modelCacheDeleted:true}));
}finally{await browser?.close();await server.close();}
