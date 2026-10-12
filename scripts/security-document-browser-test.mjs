import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {zipSync,strToU8} from 'fflate';
import assert from 'node:assert/strict';
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
  const {extractDocumentText}=await import('/RaimuNoteSNS.github.io/src/lib/documentText.ts');
  return extractDocumentText(new File([new Uint8Array(bytes)],`fixture.${kind}`),kind);
 },{kind,bytes:[...bytes]});
 assert.match(await run('docx',docx),/Safe document text/);
 assert.match(await run('pdf',Buffer.from(pdf)),/Safe PDF text/);
 const invalid=zipSync({'file.txt':strToU8('not a Word document')});
 await assert.rejects(run('docx',invalid),/DOCX/);
 console.log('PASS: real Chrome module Workers extract DOCX/PDF and reject invalid archives');
}finally{await browser?.close();await server.close();}
