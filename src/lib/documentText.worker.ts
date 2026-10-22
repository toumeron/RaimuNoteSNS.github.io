import { Unzip, UnzipInflate } from "fflate";

// documentText.worker
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


// docxArchive
/** Count streamed, actually inflated bytes before handing a DOCX to Mammoth.
 * Never trust ZIP size fields: a small attachment can expand into a zip bomb.
 */
export function validateDocxArchive(bytes:Uint8Array,maxBytes=64*1024*1024,maxEntries=512):void {
  let total=0,entries=0,finished=0,failure:Error|undefined;
  const names=new Set<string>();
  const unzip=new Unzip(file=>{
    if(++entries>maxEntries||file.name.length>2048||(file.originalSize??0)>maxBytes||names.has(file.name))throw Error('DOCXの展開量またはファイル数が上限を超えています');
    names.add(file.name);
    file.ondata=(error,data,final)=>{
      if(error){failure=error;return;}
      total+=data.byteLength;
      if(total>maxBytes){failure=Error('DOCXの展開量が64MBの上限を超えています');file.terminate();return;}
      if(final)finished++;
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // Small input chunks bound the output allocation before each callback.
  for(let offset=0;offset<bytes.length;offset+=4096){
    unzip.push(bytes.subarray(offset,offset+4096),offset+4096>=bytes.length);
    if(failure)throw failure;
  }
  if(!entries||finished!==entries||!names.has('[Content_Types].xml')||!names.has('word/document.xml'))throw Error('DOCXファイルが無効です');
}
