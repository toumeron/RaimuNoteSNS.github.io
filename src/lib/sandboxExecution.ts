// sandboxExecution
/** Arbitrary model-generated code must never run in the app's origin. */
function sandboxDocument(html: string): string {
  const escape = (value: string) => value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Preview</title></head><body style="margin:0"><iframe sandbox="allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock" referrerpolicy="no-referrer" style="position:fixed;inset:0;width:100%;height:100%;border:0" srcdoc="${escape(html)}"></iframe></body></html>`;
}
type SandboxWorker = {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: {message: string}) => void) | null;
  postMessage: (data: unknown) => void;
  terminate: () => void;
};

/** Run the Worker inside an opaque-origin sandbox. A regular blob Worker
 * inherits the app origin and could read IndexedDB exports/private bookmarks.
 * The parent only relays code and bounded console output, never credentials.
 */
function createSandboxWorker(source: string): SandboxWorker {
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.setAttribute('sandbox','allow-scripts');
  let ready = false, closed = false;
  const pending: unknown[] = [];
  const worker: SandboxWorker = {
    onmessage: null, onerror: null,
    postMessage(data) {
      if (closed) return;
      if (ready) frame.contentWindow?.postMessage(data,'*');
      else pending.push(data);
    },
    terminate() { closed = true; window.removeEventListener('message',receive);frame.remove();pending.length=0; },
  };
  const receive = (event: MessageEvent) => {
    if (closed || event.source !== frame.contentWindow) return;
    if (event.data?.sandboxReady === true && !ready) {
      ready = true;
      for (const item of pending.splice(0)) frame.contentWindow?.postMessage(item,'*');
    } else if (event.data?.sandboxError) worker.onerror?.({message: String(event.data.sandboxError).slice(0,2000)});
    else if (event.data?.type === 'done') worker.onmessage?.(event);
    else if (event.data?.type === 'line' && ['log','error','result','info'].includes(event.data.level) && typeof event.data.text === 'string') {
      worker.onmessage?.(new MessageEvent('message',{data: {...event.data,text:event.data.text.slice(0,50000)}}));
    }
  };
  const encoded = JSON.stringify(source).replace(/</g,'\\u003c');
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: https://cdn.jsdelivr.net; worker-src blob:; connect-src https://cdn.jsdelivr.net"><script>
  try {
    const worker = new Worker(URL.createObjectURL(new Blob([${encoded}],{type:'text/javascript'})));
    worker.onmessage = event => parent.postMessage(event.data,'*');
    worker.onerror = event => parent.postMessage({sandboxError:event.message},'*');
    addEventListener('message',event => { if(event.source===parent) worker.postMessage(event.data); });
    parent.postMessage({sandboxReady:true},'*');
  } catch(error) {parent.postMessage({sandboxError:String(error)},'*');}
  </script>`;
  window.addEventListener('message',receive);
  document.body.append(frame);
  return worker;
}

// documentText
/** Keep untrusted document parsers off the UI thread and kill stalled jobs. */
async function extractDocumentText(file:File,kind:'pdf'|'docx'):Promise<string>{
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

export { sandboxDocument };
export { createSandboxWorker };
export type { SandboxWorker };
export { extractDocumentText };
