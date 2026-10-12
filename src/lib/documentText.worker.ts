import {validateDocxArchive} from './docxArchive';
self.onmessage=async(event:MessageEvent<{bytes:ArrayBuffer;kind:'pdf'|'docx';maxChars:number}>)=>{
  try {
    const {bytes,kind,maxChars}=event.data;
    if(bytes.byteLength>25*1024*1024||maxChars!==80000)throw Error('文書のサイズが上限を超えています');
    let text='';
    if(kind==='docx'){
      validateDocxArchive(new Uint8Array(bytes));
      const mammoth=await import('mammoth');
      const lib=(mammoth as unknown as {default?:typeof mammoth}).default??mammoth;
      text=(await lib.extractRawText({arrayBuffer:bytes})).value.slice(0,maxChars);
    }else if(kind==='pdf'){
      const {getDocumentProxy}=await import('unpdf');
      // unpdf forwards these PDF.js options; its bundled declarations expose
      // only a subset, so pass a structurally typed options object.
      const options={data:new Uint8Array(bytes),isEvalSupported:false};
      const pdf=await getDocumentProxy(options.data,options);
      try {
        if(pdf.numPages>2000)throw Error('PDFは2000ページ以内にしてください');
        for(let page=1;page<=pdf.numPages&&text.length<maxChars;page++){
          const content=await(await pdf.getPage(page)).getTextContent();
          for(const item of content.items){if('str' in item)text+=(text?' ':'')+item.str.slice(0,maxChars-text.length);if(text.length>=maxChars)break;}
          text+='\n';
        }
      }finally{
        await pdf.loadingTask.destroy();
      }
    }else throw Error('文書形式が無効です');
    self.postMessage({documentResult:true,text:text.slice(0,maxChars)});
  }catch(error){self.postMessage({documentResult:true,error:error instanceof Error?error.message:'文書を解析できませんでした'});}
};
