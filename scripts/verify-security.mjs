// Each command runs one original verification in its own process.
// Dependencies are loaded only after selecting that verification.
const suites = {
  // security-browser-test.mjs
  "security": async () => {
const { chromium } = await import('playwright-core');
const { default: ts } = await import('typescript');
const { readFile } = await import('node:fs/promises');
const { default: assert } = await import('node:assert/strict');
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
  },

  // security-document-browser-test.mjs
  "security-document": async () => {
const { createServer } = await import('vite');
const { chromium } = await import('@playwright/test');
const { zipSync, strToU8 } = await import('fflate');
const { default: assert } = await import('node:assert/strict');
const path='/RaimuNoteSNS.github.io/__security_documents';
const server=await createServer({server:{host:'127.0.0.1',port:8186,strictPort:true},plugins:[{
 name:'security-document-fixture',configureServer(s){s.middlewares.use(path,(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><title>Document security fixture</title>');});}
}]});
let browser;
try {
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage();page.on('console',message=>{if(message.type()==='error')console.error(message.text());});await page.goto(`http://127.0.0.1:8186${path}`);
 const docx=zipSync({
  '[Content_Types].xml':strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
  '_rels/.rels':strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
  'word/document.xml':strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Safe document text</w:t></w:r></w:p></w:body></w:document>')
 });
 const objects=[
  '<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  '<< /Length 56 >>\nstream\nBT /F1 12 Tf 50 700 Td (Safe PDF text) Tj ET\nendstream',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
 ];
 let pdf='%PDF-1.4\n',offsets=[0];
 for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
 const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 const run=async(kind,bytes)=>page.evaluate(async({kind,bytes})=>{
  const {extractDocumentText}=await import('/RaimuNoteSNS.github.io/src/lib/sandboxExecution.ts');
  return extractDocumentText(new File([new Uint8Array(bytes)],`fixture.${kind}`),kind);
 },{kind,bytes:[...bytes]});
 assert.match(await run('docx',docx),/Safe document text/);
 assert.match(await run('pdf',Buffer.from(pdf)),/Safe PDF text/);
 const invalid=zipSync({'file.txt':strToU8('not a Word document')});
 await assert.rejects(run('docx',invalid),/DOCX/);
 console.log('PASS: real Chrome module Workers extract DOCX/PDF and reject invalid archives');
}finally{await browser?.close();await server.close();}
  },
};

const command = process.argv[2];
if (command === '--list' || !Object.hasOwn(suites, command)) {
  console.log('Usage: node scripts/verify-security.mjs <command> [arguments]\n\n' + Object.keys(suites).join('\n'));
  if (command !== '--list') process.exitCode = 2;
} else {
  // Preserve the original positional arguments consumed by individual checks.
  process.argv.splice(2, 1);
  await suites[command]();
}
