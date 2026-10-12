import {Unzip,UnzipInflate} from 'fflate';

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
