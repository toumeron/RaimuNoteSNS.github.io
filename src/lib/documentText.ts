/** Keep untrusted document parsers off the UI thread and kill stalled jobs. */
export async function extractDocumentText(file:File,kind:'pdf'|'docx'):Promise<string>{
  if(file.size>25*1024*1024)throw Error('文書は25MB以内にしてください');
  const bytes=await file.arrayBuffer();
  const worker=new Worker(new URL('./documentText.worker.ts',import.meta.url),{type:'module'});
  try {
    return await new Promise<string>((resolve,reject)=>{
      const timer=setTimeout(()=>{worker.terminate();reject(Error('文書の解析が時間制限を超えました'));},30000);
      const fail=(message:string)=>{clearTimeout(timer);reject(Error(message));};
      worker.onerror=()=>fail('文書を解析できませんでした');
      worker.onmessage=event=>{
        // PDF.js can emit its own worker protocol messages while importing.
        if(event.data?.documentResult!==true)return;
        clearTimeout(timer);
        if(typeof event.data?.text==='string')resolve(event.data.text.slice(0,80000));
        else fail(typeof event.data?.error==='string'?event.data.error:'文書を解析できませんでした');
      };
      worker.postMessage({bytes,kind,maxChars:80000},[bytes]);
    });
  }finally{worker.terminate();}
}
