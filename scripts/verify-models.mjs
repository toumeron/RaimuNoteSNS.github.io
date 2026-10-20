// Each command runs one original verification in its own process.
// Dependencies are loaded only after selecting that verification.
const suites = {
  // local-gemma-chat-browser-test.mjs
  "local-gemma-chat": async () => {
const { createServer } = await import('vite');
const { chromium, expect } = await import('@playwright/test');
const { default: assert } = await import('node:assert/strict');
const base='/RaimuNoteSNS.github.io',port=8206,owner='11111111-1111-4111-8111-111111111111';
const fakeModel=`let state={status:'missing',downloaded:false,progress:0};const listeners=new Set();const emit=patch=>{state={...state,...patch};listeners.forEach(listener=>listener());};export const getLocalGemmaState=()=>state;export const subscribeLocalGemma=listener=>{listeners.add(listener);return()=>listeners.delete(listener)};export async function checkLocalGemmaDownload(){if(localStorage.fixture_gemma_cached==='1')emit({status:'ready',downloaded:true,progress:100})}export async function downloadLocalGemma(){emit({status:'downloading',progress:42});await new Promise(resolve=>setTimeout(resolve,200));localStorage.fixture_gemma_cached='1';emit({status:'ready',downloaded:true,progress:100})}export async function loadLocalGemma(){if(!state.downloaded)await downloadLocalGemma();}export function releaseLocalGemma(){}export async function deleteLocalGemma(){delete localStorage.fixture_gemma_cached;emit({status:'missing',downloaded:false,progress:0})}export async function generateLocalGemma(messages,instructions,signal,onText){window.fixture_gemma_request={messages,instructions};onText('端末内の回答');return '端末内の回答';}`;
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import '/src/index.css';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {MemoryRouter} from 'react-router-dom';import {CallSessionProvider} from '/src/components/chat/CallSessionProvider';import ChatPage from '/src/pages/ChatPage';createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><CallSessionProvider><ChatPage embedded/></CallSessionProvider></MemoryRouter></QueryClientProvider>);`;
const server=await createServer({cacheDir:'/private/tmp/lime-gemma-chat-cache',server:{host:'127.0.0.1',port,strictPort:true},plugins:[{name:'gemma-chat-fixture',resolveId(id){if(id.endsWith('/__gemma_chat.tsx'))return '\0/__gemma_chat.tsx';},load(id){if(id==='\0/__gemma_chat.tsx')return source;if(id.endsWith('/src/hooks/useAuth.tsx'))return `const user={id:'${owner}',username:'fixture',displayName:'Fixture'};export const useAuth=()=>({user,loading:false,accounts:[],session:null});export const AuthProvider=({children})=>children;`;if(id.endsWith('/src/lib/localGemma.ts'))return fakeModel;},configureServer(s){s.middlewares.use(base+'/__gemma_chat',async(_,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(base+'/__gemma_chat',`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root" style="height:100dvh"></div><script type="module" src="${base}/__gemma_chat.tsx"></script></body></html>`));});}}]});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(!new URL(request.url()).hostname.startsWith('127.'))requests.push({url:request.url(),body:request.postData()??'',method:request.method()});});
 await page.addInitScript(owner=>{
  localStorage.setItem(`limeai:${owner}:settings`,JSON.stringify({userName:'引継ぎ名',customInstructions:'INSTRUCTION_KEEP 丁寧な日本語で回答',memoryEnabled:true}));
  localStorage.setItem(`limeai:${owner}:memories`,JSON.stringify([{id:'m',content:'MEMORY_KEEP 好きな色は青'}]));
 },owner);
 await page.route('**/*.supabase.co/**',route=>{
  const request=route.request(),url=new URL(request.url()),headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','access-control-allow-headers':request.headers()['access-control-request-headers']??'*'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(url.pathname.endsWith('/chat-gemma'))return route.fulfill({headers,contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:'クラウド回答'}}]})+'\n\ndata: [DONE]\n\n'});
  let data=[];
  if(url.pathname.endsWith('/chat_sessions')&&request.method()==='GET')data=[{id:'22222222-2222-4222-8222-222222222222',title:'既存クラウド会話',messages:[{id:'old',role:'user',content:'OLD_CLOUD_HISTORY'}],updated_at:1}];
  if(url.pathname.endsWith('/user_entitlements'))data={feature:'limepro'};
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(`http://127.0.0.1:${port}${base}/__gemma_chat`);
 await expect(page.getByText('OLD_CLOUD_HISTORY',{exact:true})).toBeVisible({timeout:20000});
 await page.getByRole('button',{name:'LimeAIのメニュー',exact:true}).click();
 await page.getByRole('button').filter({has:page.getByText('Gemma 3 270M',{exact:true})}).click();
 await expect(page.locator('[data-local-gemma-status]')).toBeVisible();
 await expect(page.locator('[data-local-gemma-status]').getByRole('button',{name:'Gemma 3 270Mを端末から削除'})).toBeEnabled();
 await expect(page.getByText('OLD_CLOUD_HISTORY',{exact:true})).toHaveCount(0);
 const afterSelection=requests.length;
 const secret='LOCAL_SECRET_987 https://twitter.com/Google/status/2110766445940572599';
 await page.getByRole('textbox',{name:'メッセージ',exact:true}).fill(secret);
 await page.getByRole('button',{name:'送信',exact:true}).click();
 await expect(page.getByText('端末内の回答',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'停止',exact:true})).toHaveCount(0);
 const generated=await page.evaluate(()=>window.fixture_gemma_request);
 assert.ok(generated.instructions.includes('INSTRUCTION_KEEP'));assert.ok(generated.instructions.includes('MEMORY_KEEP'));assert.ok(generated.instructions.includes('引継ぎ名'));
 assert.equal(generated.messages.length,1);assert.equal(generated.messages[0].content,secret);
 assert.ok(!generated.instructions.includes('OLD_CLOUD_HISTORY'));
 assert.ok(!requests.slice(afterSelection).some(request=>request.url.includes('LOCAL_SECRET_987')||request.body.includes('LOCAL_SECRET_987')));
 assert.equal(requests.slice(afterSelection).filter(request=>request.url.includes('/chat_sessions')||request.url.includes('/chat-gemma')||request.url.includes('/link-preview')).length,0);
 const stored=await page.evaluate(async({base,owner})=>{const api=await import(base+'/src/lib/localGemmaConfig.ts');return api.listLocalGemmaSessions(owner);},{base,owner});
 await page.screenshot({path:'/private/tmp/lime-gemma-chat-local.png'});
 assert.equal(stored.length,1);assert.equal(stored[0].messages.length,2);assert.ok(stored[0].id.startsWith('local-gemma:'));
 await page.getByRole('button',{name:'LimeAIのメニュー',exact:true}).click();
 await expect(page.getByRole('menuitem',{name:/LimeAI 6 Fast/})).toHaveAttribute('aria-disabled','true');
 await expect(page.getByRole('menuitem',{name:/LimeAI 6 Thinking/})).toHaveAttribute('aria-disabled','true');
 await page.keyboard.press('Escape');
 await page.reload();await expect(page.getByText('端末内の回答',{exact:true})).toBeVisible();
 await page.locator('[data-local-gemma-status]').getByRole('button',{name:'Gemma 3 270Mを端末から削除'}).click();
 await expect(page.locator('[data-local-gemma-status]').getByRole('button',{name:'Gemma 3 270Mをダウンロード'})).toBeVisible();
 await expect(page.getByText('端末内の回答',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'送信',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'LimeAIのメニュー',exact:true}).click();await page.getByRole('menuitem',{name:'新しいチャット',exact:true}).click();
 await expect(page.getByText(secret,{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'LimeAIのメニュー',exact:true}).click();await page.getByRole('menuitem',{name:/LimeAI 6 Fast/}).click();
 await expect(page.locator('[data-local-gemma-status]')).toHaveCount(0);
 await page.getByRole('textbox',{name:'メッセージ',exact:true}).fill('新しいクラウド会話');await page.getByRole('button',{name:'送信',exact:true}).click();
 await expect(page.getByText('クラウド回答',{exact:true})).toBeVisible();
 const remote=requests.filter(request=>request.url.includes('/chat-gemma')).at(-1);
 assert.ok(remote?.body.includes('INSTRUCTION_KEEP'));assert.ok(!remote?.body.includes('LOCAL_SECRET_987'));
 assert.deepEqual(errors,[]);await page.screenshot({path:'/private/tmp/lime-gemma-chat-ui.png'});
 console.log(JSON.stringify({localHistoryOnly:true,localSessionRestored:true,noMessageRequests:true,instructionsCarried:true,oldHistoryNotCarried:true,lockedLocalChat:true,deletingModelKeepsHistory:true,newCloudChatSeparated:true}));
}finally{await browser?.close();await server.close();}
  },

  // local-gemma-inference-browser-test.mjs
  "local-gemma-inference": async () => {
const { createServer } = await import('vite');
const { chromium } = await import('@playwright/test');
const { createReadStream, existsSync, statSync } = await import('node:fs');
const { default: assert } = await import('node:assert/strict');
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
  },
};

const command = process.argv[2];
if (command === '--list' || !Object.hasOwn(suites, command)) {
  console.log('Usage: node scripts/verify-models.mjs <command> [arguments]\n\n' + Object.keys(suites).join('\n'));
  if (command !== '--list') process.exitCode = 2;
} else {
  // Preserve the original positional arguments consumed by individual checks.
  process.argv.splice(2, 1);
  await suites[command]();
}
