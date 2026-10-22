import {expect,it} from 'vitest';
import {zipSync,strToU8} from 'fflate';
import {validateDocxArchive} from "@/lib/documentText.worker";
const zip=(body:string)=>zipSync({'[Content_Types].xml':strToU8('<Types/>'),'word/document.xml':strToU8(body)});
it('accepts a normal DOCX archive',()=>expect(()=>validateDocxArchive(zip('<document>hello</document>'))).not.toThrow());
it('rejects a highly compressed archive before the document parser runs',()=>{
 const bytes=zip('a'.repeat(100000));expect(bytes.length).toBeLessThan(1024);
 expect(()=>validateDocxArchive(bytes,1024)).toThrow();
});
it('counts actual decompressed bytes even when ZIP metadata understates them',()=>{
 const bytes=zip('a'.repeat(100000)),view=new DataView(bytes.buffer);
 for(let i=0;i+46<bytes.length;i++){
  if(view.getUint32(i,true)===0x04034b50)view.setUint32(i+22,1,true);
  if(view.getUint32(i,true)===0x02014b50)view.setUint32(i+24,1,true);
 }
 expect(()=>validateDocxArchive(bytes,1024)).toThrow();
});
it('rejects excessive entries and archives without a Word document',()=>{
 expect(()=>validateDocxArchive(zip('<document/>'),1024,1)).toThrow();
 expect(()=>validateDocxArchive(zipSync({'file.txt':strToU8('plain')}))).toThrow();
});
