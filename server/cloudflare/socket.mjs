// Cloudflare's outgoing sockets use an HTTP Upgrade rather than new WebSocket(url).
export function cloudflareSocketClass(fetcher=fetch){
 return class CloudflareSocket extends EventTarget {
  static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
  readyState=0;binaryType='arraybuffer';bufferedAmount=0;extensions='';protocol='';
  onopen=null;onmessage=null;onclose=null;onerror=null;
  constructor(address,protocols){
   super();this.url=String(address);this.socket=null;this.closed=false;
   void this.connect(protocols);
  }
  emit(type,details={}){const event=Object.assign(new Event(type),details);this.dispatchEvent(event);this[`on${type}`]?.(event);}
  async connect(protocols){
   try{
    const url=new URL(this.url);url.protocol=url.protocol==='wss:'?'https:':'http:';
    const headers={Upgrade:'websocket'};if(protocols?.length)headers['Sec-WebSocket-Protocol']=Array.isArray(protocols)?protocols.join(','):protocols;
    const response=await fetcher(url.href,{headers});const socket=response.webSocket;
    if(!socket)throw new Error('WebSocket upgrade failed');this.socket=socket;
    socket.addEventListener('message',event=>this.emit('message',{data:event.data}));
    socket.addEventListener('error',()=>this.emit('error'));
    socket.addEventListener('close',event=>{this.closed=true;this.readyState=3;this.emit('close',{code:event.code,reason:event.reason,wasClean:event.wasClean});});
    socket.accept();if(this.closed){socket.close(1000,'Listener stopped');return;}
    this.readyState=1;this.emit('open');
   }catch{this.readyState=3;this.emit('error');if(!this.closed){this.closed=true;this.emit('close',{code:1006,reason:'Connection failed',wasClean:false});}}
  }
  send(data){if(this.readyState!==1)throw new Error('WebSocket is not open');this.socket.send(data);}
  close(code=1000,reason=''){
   if(this.closed)return;this.closed=true;this.readyState=2;
   if(this.socket)this.socket.close(code,reason);
   else{this.readyState=3;this.emit('close',{code,reason,wasClean:true});}
  }
 };
}
