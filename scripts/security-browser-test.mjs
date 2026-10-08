import {chromium} from 'playwright-core';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
 const page=await browser.newPage();
 await page.route('http://127.0.0.1:9876/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body>Security fixture</body>'}));
 await page.goto('http://127.0.0.1:9876/');
 const source=await readFile(new URL('../src/lib/sandboxExecution.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 await page.addScriptTag({content:'const sandbox={}; (function(exports){'+code+'})(sandbox);'});
 await page.evaluate(()=>localStorage.setItem('private-session','must-not-leak'));
 const run=async userCode=>page.evaluate(code=>new Promise((resolve,reject)=>{
  const worker=sandbox.createSandboxWorker(`onmessage=async e=>{try {const result=await new (Object.getPrototypeOf(async function(){}).constructor)(e.data.code)();postMessage({type:'line',level:'result',text:JSON.stringify(result)});}catch(e){postMessage({type:'line',level:'error',text:String(e)});}postMessage({type:'done'});}`);
  let output;const timer=setTimeout(()=>{worker.terminate();reject(Error('Timeout'));},10000);
  worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(Error(e.message));};
  worker.onmessage=e=>{if(e.data.type==='line')output=e.data;else if(e.data.type==='done'){clearTimeout(timer);worker.terminate();resolve(output);}};
  worker.postMessage({code});
 }),userCode);
 assert.equal((await run('return 6 * 7')).text,'42');
 const result=await run(`let blocked=false;try{indexedDB.open('private-exports');}catch(e){blocked=true;}return {origin:self.origin,blocked};`);
 assert.deepEqual(JSON.parse(result.text),{origin:'null',blocked:true});
 const network=await run(`try {await fetch('http://127.0.0.1:9876/credentials');return 'allowed';}catch(e){return 'blocked';}`);
 assert.equal(JSON.parse(network.text),'blocked');
 // Model HTML still renders but cannot access its parent application's session.
 const html=await page.evaluate(()=>sandbox.sandboxDocument(`<body><p id="visible">Preview works</p><script>let denied=false;try{localStorage.getItem('private-session');}catch(e){denied=true;}parent.postMessage({denied,origin:self.origin},'*');<\/script>`));
 const preview=await browser.newPage();
 await preview.route('http://127.0.0.1:9876/preview',route=>route.fulfill({contentType:'text/html',body:html}));
 await preview.addInitScript(()=>{window.resultPromise=new Promise(resolve=>addEventListener('message',e=>resolve(e.data),{once:true}));});
 await preview.goto('http://127.0.0.1:9876/preview');
 assert.deepEqual(await preview.evaluate(()=>window.resultPromise),{denied:true,origin:'null'});
 assert.equal(await preview.locator('iframe').contentFrame().locator('#visible').textContent(),'Preview works');
 console.log('PASS: Chrome sandbox runs code and renders previews; origin storage and app network access are denied');
} finally {await browser.close();}
